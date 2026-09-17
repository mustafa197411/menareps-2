import { Product } from "../../../types";
import {
  AiOrderParsedLine,
  AiOrderParseResult,
  ProductResolutionCandidate
} from "../types/domain";

/**
 * Calculates string similarity score between 0 and 1 (using normalized Levenshtein / Token Jaccard).
 */
export function calculateStringSimilarity(str1: string, str2: string): number {
  const s1 = (str1 || "").toLowerCase().trim();
  const s2 = (str2 || "").toLowerCase().trim();

  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;

  // Exact substring check bonus
  if (s1.includes(s2) || s2.includes(s1)) {
    const minLen = Math.min(s1.length, s2.length);
    const maxLen = Math.max(s1.length, s2.length);
    return Math.max(0.7, minLen / maxLen);
  }

  // Token Jaccard similarity
  const tokens1 = new Set(s1.split(/[\s,_\-\/\:\.]+/).filter((t) => t.length > 0));
  const tokens2 = new Set(s2.split(/[\s,_\-\/\:\.]+/).filter((t) => t.length > 0));

  let intersection = 0;
  tokens1.forEach((t) => {
    if (tokens2.has(t)) intersection++;
  });

  const union = new Set([...tokens1, ...tokens2]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Splits raw freeform text into individual order lines cleanly.
 */
export function splitQuickAddLines(rawText: string): string[] {
  if (!rawText || !rawText.trim()) return [];

  // Replace semicolons with newlines
  let normalized = rawText.replace(/;/g, "\n");

  // Handle commas: split on commas IF both sides look like independent order expressions (e.g., "70-20, 83-10" or "Cornex 20, Product B 10")
  // Do NOT split if comma is just "Cornex Gel, 20"
  const rawLines = normalized.split(/\r?\n/);
  const resultLines: string[] = [];

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.includes(",")) {
      // Check if comma separates distinct items (e.g., code-qty or product-qty on both sides)
      const parts = trimmed.split(",");
      let shouldSplit = true;

      // If parts[1] is just a number (e.g. "Cornex Gel", "20"), do not split
      if (parts.length === 2 && /^\s*\d+\s*$/.test(parts[1])) {
        shouldSplit = false;
      }

      if (shouldSplit) {
        parts.forEach((p) => {
          if (p.trim()) resultLines.push(p.trim());
        });
        continue;
      }
    }

    resultLines.push(trimmed);
  }

  return resultLines;
}

/**
 * Parses a single line string to extract product identifier, pack size, and requested quantity.
 */
export interface SingleLineParsedPayload {
  rawLine: string;
  detectedCode?: string;
  detectedName?: string;
  detectedPack?: string;
  detectedQuantity: number;
}

export function parseSingleLineText(rawLine: string): SingleLineParsedPayload {
  let text = rawLine.trim();
  let detectedQuantity = 1;
  let detectedPack: string | undefined = undefined;
  let detectedCode: string | undefined = undefined;
  let detectedName: string | undefined = undefined;

  // 1. Detect and extract pack/strength units (e.g. 20gm, 500mg, 10ml, 10 tablets)
  const packRegex = /\b(\d+(?:\.\d+)?\s*(?:gm|g|mg|ml|mcg|%|tablets|capsules|sachets|packs|vials|ampoules))\b/i;
  const packMatch = text.match(packRegex);
  if (packMatch) {
    detectedPack = packMatch[1].trim();
    // Temporarily replace pack string to avoid confusing pack number with quantity
    text = text.replace(packMatch[0], " ").replace(/\s+/g, " ").trim();
  }

  // 2. Detect explicit quantity markers: x12, qty 12, quantity 12, pcs 12, units 12, *12
  const explicitQtyRegex = /(?:^|\s)(?:x|qty|quantity|pcs|units|\*)\s*[:=]?\s*(\d+)\b/i;
  const explicitQtyMatch = text.match(explicitQtyRegex);

  if (explicitQtyMatch) {
    detectedQuantity = parseInt(explicitQtyMatch[1], 10);
    text = text.replace(explicitQtyMatch[0], "").trim();
  } else {
    // 3. Detect leading quantity (e.g. "20 Cornex Gel" or "20 x Cornex Gel")
    const leadingQtyRegex = /^(\d+)\s*(?:x|qty|pcs|units)?\s+([A-Za-z\u0600-\u06FF].*)/i;
    const leadingMatch = text.match(leadingQtyRegex);

    if (leadingMatch) {
      detectedQuantity = parseInt(leadingMatch[1], 10);
      text = leadingMatch[2].trim();
    } else {
      // 4. Detect code-quantity delimiter patterns (e.g., "70-20", "70/20", "70//20", "70:20", "70 20")
      const delimiterCodeQtyRegex = /^([A-Za-z0-9_\-]+)[\s\/\-:]+(\d+)$/;
      const delimiterMatch = text.match(delimiterCodeQtyRegex);

      if (delimiterMatch) {
        detectedCode = delimiterMatch[1].trim();
        detectedQuantity = parseInt(delimiterMatch[2], 10);
        text = "";
      } else {
        // 5. Detect trailing quantity (e.g., "Cornex Gel 20" or "Cornex 20")
        const trailingQtyRegex = /^(.*?)\s*[\,:\-]?\s*(\d+)$/;
        const trailingMatch = text.match(trailingQtyRegex);

        if (trailingMatch && trailingMatch[1].trim().length > 0) {
          text = trailingMatch[1].trim();
          detectedQuantity = parseInt(trailingMatch[2], 10);
        }
      }
    }
  }

  if (text) {
    // If text looks purely like a code (e.g. numbers, short code, PRD-001)
    if (/^[A-Za-z0-9_\-]+$/.test(text) && (text.length <= 8 || text.startsWith("PRD") || text.startsWith("PRD_"))) {
      detectedCode = text;
    } else {
      detectedName = text;
    }
  }

  return {
    rawLine,
    detectedCode,
    detectedName,
    detectedPack,
    detectedQuantity: isNaN(detectedQuantity) || detectedQuantity < 1 ? 1 : detectedQuantity
  };
}

/**
 * Quick Add Deterministic Parser and Product Resolver.
 */
export function parseQuickAddInput(
  rawInput: string,
  eligibleProducts: Product[],
  allCatalogProducts: Product[] = []
): AiOrderParseResult {
  console.info(
    "[PHARMACY_VISIT_QUICK_ADD_INPUT_JSON]",
    JSON.stringify({
      rawInput,
      eligibleProductCount: eligibleProducts.length,
      timestamp: new Date().toISOString()
    })
  );

  const lineTexts = splitQuickAddLines(rawInput);
  const parsedLines: AiOrderParsedLine[] = [];

  lineTexts.forEach((lineText, idx) => {
    const single = parseSingleLineText(lineText);
    const lineId = `qline_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 6)}`;

    const candidates: ProductResolutionCandidate[] = [];

    // Search eligible products first
    eligibleProducts.forEach((p) => {
      let matchType: ProductResolutionCandidate["matchType"] = "FUZZY_NAME";
      let score = 0;

      const pCode = (p.code || p.sku || p.id || "").toLowerCase().trim();
      const pNameEn = (p.name || "").toLowerCase().trim();
      const pNameAr = (p.nameAr || "").toLowerCase().trim();
      const pBrand = (p.brand || "").toLowerCase().trim();
      const pPack = (p.packageSize || p.strength || "").toLowerCase().trim();

      // Check code match
      if (single.detectedCode) {
        const searchCode = single.detectedCode.toLowerCase().trim();
        if (pCode === searchCode || p.id.toLowerCase() === searchCode || p.sku?.toLowerCase() === searchCode) {
          matchType = "EXACT_CODE";
          score = 1.0;
        } else if (pCode.includes(searchCode) || searchCode.includes(pCode)) {
          matchType = "EXACT_CODE";
          score = 0.85;
        }
      }

      // Check name match if score is low
      if (score < 0.9 && (single.detectedName || single.detectedCode)) {
        const queryText = (single.detectedName || single.detectedCode || "").toLowerCase().trim();

        if (pNameEn === queryText || pNameAr === queryText) {
          matchType = "EXACT_NAME";
          score = 0.98;
        } else if (pBrand === queryText) {
          matchType = "ALIAS";
          score = 0.90;
        } else {
          const simEn = calculateStringSimilarity(queryText, pNameEn);
          const simAr = calculateStringSimilarity(queryText, pNameAr);
          const simBrand = calculateStringSimilarity(queryText, pBrand);
          const maxSim = Math.max(simEn, simAr, simBrand);

          if (maxSim > score) {
            score = maxSim;
            matchType = score > 0.8 ? "EXACT_NAME" : "FUZZY_NAME";
          }
        }
      }

      // Pack size alignment bonus
      if (single.detectedPack && pPack && score > 0.5) {
        if (pPack.toLowerCase().includes(single.detectedPack.toLowerCase())) {
          score = Math.min(1.0, score + 0.1);
        }
      }

      if (score >= 0.45 && typeof p.price === "number" && Number.isFinite(p.price) && p.price >= 0) {
        candidates.push({
          productId: p.id,
          skuId: p.sku || p.code || p.id,
          code: p.code || p.sku || p.id,
          nameEn: p.name,
          nameAr: p.nameAr,
          pack: p.packageSize || p.strength,
          strength: p.strength,
          unitPrice: p.price === 0 ? 0 : p.price,
          matchType,
          score
        });
      }
    });

    // Sort candidates descending by score
    candidates.sort((a, b) => b.score - a.score);

    let status: AiOrderParsedLine["status"] = "UNRESOLVED";
    let proposedProductId: string | undefined = undefined;
    let proposedSkuId: string | undefined = undefined;
    let proposedProductCode: string | undefined = undefined;
    let proposedProductName: string | undefined = undefined;
    let proposedPack: string | undefined = undefined;
    let unitPrice: number | undefined = undefined;
    let confidence = 0;

    if (candidates.length > 0) {
      const top = candidates[0];
      confidence = Math.round(top.score * 100) / 100;

      if (top.score >= 0.95) {
        status = "MATCHED";
        proposedProductId = top.productId;
        proposedSkuId = top.skuId;
        proposedProductCode = top.code;
        proposedProductName = top.nameEn;
        proposedPack = top.pack || single.detectedPack;
        unitPrice = top.unitPrice;
      } else if (candidates.length > 1 && candidates[1].score >= top.score - 0.1) {
        status = "AMBIGUOUS";
        proposedProductId = top.productId;
        proposedSkuId = top.skuId;
        proposedProductCode = top.code;
        proposedProductName = top.nameEn;
        proposedPack = top.pack || single.detectedPack;
        unitPrice = top.unitPrice;
      } else if (top.score >= 0.6) {
        status = "NEEDS_CONFIRMATION";
        proposedProductId = top.productId;
        proposedSkuId = top.skuId;
        proposedProductCode = top.code;
        proposedProductName = top.nameEn;
        proposedPack = top.pack || single.detectedPack;
        unitPrice = top.unitPrice;
      } else {
        status = "AMBIGUOUS";
      }
    } else {
      // Check if candidate exists in global catalog but was NOT in eligible products (unassigned or inactive)
      const queryStr = (single.detectedName || single.detectedCode || "").toLowerCase().trim();
      const inGlobalCatalog = allCatalogProducts.find(
        (p) =>
          (p.code && p.code.toLowerCase() === queryStr) ||
          p.id.toLowerCase() === queryStr ||
          p.name.toLowerCase() === queryStr ||
          (p.nameAr && p.nameAr.toLowerCase() === queryStr)
      );

      if (inGlobalCatalog) {
        const isProdActive = inGlobalCatalog.isActive !== false && (inGlobalCatalog as any).active !== false;
        if (!isProdActive) {
          status = "REJECTED_INACTIVE";
        } else {
          status = "REJECTED_UNASSIGNED";
        }
      } else {
        status = "UNRESOLVED";
      }
    }

    parsedLines.push({
      id: lineId,
      originalText: single.rawLine,
      detectedCode: single.detectedCode,
      detectedName: single.detectedName,
      detectedPack: single.detectedPack,
      detectedQuantity: single.detectedQuantity,
      proposedProductId,
      proposedSkuId,
      proposedProductCode,
      proposedProductName,
      proposedPack,
      unitPrice,
      confidence,
      status,
      candidates
    });
  });

  const overallConfidence =
    parsedLines.length === 0
      ? 0
      : Math.round(
          (parsedLines.reduce((acc, curr) => acc + curr.confidence, 0) / parsedLines.length) * 100
        ) / 100;

  const result: AiOrderParseResult = {
    rawInput,
    parsedLines,
    overallConfidence,
    parsedAt: new Date().toISOString()
  };

  console.info("[PHARMACY_VISIT_QUICK_ADD_RESULT_JSON]", JSON.stringify(result));

  return result;
}
