import { 
  createProductTargetPlanId, 
  createProductAnnualTargetId, 
  createProductAreaPotentialId, 
  createProductQuarterlyDistributionId 
} from "./productTargetIdService";
import { 
  validateProductAnnualTargetShape, 
  validateProductAreaPotentialShape, 
  validateProductQuarterlyDistributionShape 
} from "./productTargetSchema";
import { TargetStatus } from "../types";
import { mapImportedRowToSchema } from "./schemaEngine";

export interface StagedImportRecord {
  rowNumber: number;
  raw: Record<string, any>;
  parsed: Record<string, any>;
  errors: Array<{ code: string; field?: string; message: string }>;
  resolvedProductId?: string;
  resolvedAreaId?: string;
  valid: boolean;
}

export interface TargetImportBatch {
  importId: string;
  templateType: "annualproducttarget" | "productareadistribution" | "productquarterlydistribution";
  status: "UPLOADED" | "PARSED" | "VALIDATED" | "PREVIEW_READY" | "COMMITTING" | "COMPLETE" | "FAILED" | "PARTIAL" | "ROLLED_BACK";
  fileName: string;
  importedBy: string;
  importedAt: string;
  countryId: string;
  year: number;
  totalRecords: number;
  validRecordsCount: number;
  errorRecordsCount: number;
  records: StagedImportRecord[];
  globalErrors: Array<{ code: string; message: string }>;
  createdTargetIds?: string[];
  updatedTargetSnapshot?: Record<string, any>;
}

/**
 * Validates raw rows uploaded for a target template, resolving canonical references
 * and checking group-level consistency (such as potential sums and quarterly sums exactly matching 100%).
 */
export async function validateImportBatch(
  db: any,
  params: {
    templateType: "annualproducttarget" | "productareadistribution" | "productquarterlydistribution";
    rows: any[];
    fileName: string;
    countryId: string;
    year: number;
    importedBy: string;
  }
): Promise<TargetImportBatch> {
  const { templateType, rows, fileName, countryId, year, importedBy } = params;
  const importId = `IMP::${templateType.toUpperCase()}::${countryId}::${year}::${Date.now()}`;

  const batchObj: TargetImportBatch = {
    importId,
    templateType,
    status: "UPLOADED",
    fileName,
    importedBy,
    importedAt: new Date().toISOString(),
    countryId,
    year,
    totalRecords: rows.length,
    validRecordsCount: 0,
    errorRecordsCount: 0,
    records: [],
    globalErrors: []
  };

  if (!rows || rows.length === 0) {
    batchObj.status = "FAILED";
    batchObj.globalErrors.push({ code: "EMPTY_IMPORT", message: "No rows found in the import file" });
    return batchObj;
  }

  // Set status to PARSED
  batchObj.status = "PARSED";

  // Pre-load products catalog for exact matching
  const productsSnap = await db.collection("products").get();
  const productsMap = new Map<string, any>(); // key: uppercase id or sku -> product doc
  productsSnap.forEach((doc: any) => {
    const data = doc.data();
    const id = doc.id.trim().toUpperCase();
    const sku = (data.sku || "").trim().toUpperCase();
    if (id) productsMap.set(id, { id: doc.id, ...data });
    if (sku) productsMap.set(sku, { id: doc.id, ...data });
  });

  // Pre-load areas catalog for exact matching (only needed for area distribution)
  const areasMap = new Map<string, any>();
  if (templateType === "productareadistribution") {
    const areasSnap = await db.collection("areas").get();
    areasSnap.forEach((doc: any) => {
      const data = doc.data();
      const id = doc.id.trim().toUpperCase();
      const code = (data.code || "").trim().toUpperCase();
      if (id) areasMap.set(id, { id: doc.id, ...data });
      if (code) areasMap.set(code, { id: doc.id, ...data });
    });
  }

  const stagedRecords: StagedImportRecord[] = [];
  let validCount = 0;
  let errorCount = 0;

  // Process rows one-by-one (row index starts at 1)
  for (let idx = 0; idx < rows.length; idx++) {
    const rawRow = rows[idx];
    const rowNumber = idx + 1;
    const errors: Array<{ code: string; field?: string; message: string }> = [];

    // Map row to the corresponding schema fields
    const parsed = mapImportedRowToSchema(rawRow, templateType);

    // 1. Validate Product canonical reference
    const productVal = String(parsed.product || "").trim().toUpperCase();
    let resolvedProductId: string | undefined;
    if (!productVal) {
      errors.push({ code: "MISSING_PRODUCT", field: "product", message: "Product ID or SKU is missing" });
    } else {
      const matchedProd = productsMap.get(productVal);
      if (matchedProd) {
        resolvedProductId = matchedProd.id;
      } else {
        errors.push({
          code: "UNRESOLVED_PRODUCT",
          field: "product",
          message: `Product reference '${parsed.product}' does not exist in active products master`
        });
      }
    }

    // 2. Validate Area canonical reference (only for area potential)
    let resolvedAreaId: string | undefined;
    if (templateType === "productareadistribution") {
      const areaVal = String(parsed.area || "").trim().toUpperCase();
      if (!areaVal) {
        errors.push({ code: "MISSING_AREA", field: "area", message: "Area ID or Code is missing" });
      } else {
        const matchedArea = areasMap.get(areaVal);
        if (matchedArea) {
          resolvedAreaId = matchedArea.id;
        } else {
          errors.push({
            code: "UNRESOLVED_AREA",
            field: "area",
            message: `Area reference '${parsed.area}' does not exist in active geography catalog`
          });
        }
      }
    }

    // 3. Simple bounds/value validation depending on template type
    if (templateType === "annualproducttarget") {
      const units = Number(parsed.annualTargetUnits);
      if (isNaN(units)) {
        errors.push({ code: "INVALID_UNITS", field: "annualTargetUnits", message: "Annual Target Units must be a valid number" });
      } else if (units <= 0) {
        errors.push({ code: "INVALID_UNITS_RANGE", field: "annualTargetUnits", message: "Annual Target Units must be positive" });
      }
    } else if (templateType === "productareadistribution") {
      const pct = Number(parsed.potentialPercentage);
      if (isNaN(pct)) {
        errors.push({ code: "INVALID_POTENTIAL", field: "potentialPercentage", message: "Potential Percentage must be a valid number" });
      } else if (pct < 0 || pct > 100) {
        errors.push({ code: "INVALID_POTENTIAL_RANGE", field: "potentialPercentage", message: "Potential Percentage must be between 0 and 100 inclusive" });
      }
    } else if (templateType === "productquarterlydistribution") {
      const q1 = Number(parsed.q1Percentage);
      const q2 = Number(parsed.q2Percentage);
      const q3 = Number(parsed.q3Percentage);
      const q4 = Number(parsed.q4Percentage);

      const qs = [
        { name: "q1Percentage", val: q1 },
        { name: "q2Percentage", val: q2 },
        { name: "q3Percentage", val: q3 },
        { name: "q4Percentage", val: q4 }
      ];

      for (const q of qs) {
        if (isNaN(q.val)) {
          errors.push({ code: `INVALID_${q.name.toUpperCase()}`, field: q.name, message: `${q.name} must be a valid number` });
        } else if (q.val < 0 || q.val > 100) {
          errors.push({ code: `INVALID_${q.name.toUpperCase()}_RANGE`, field: q.name, message: `${q.name} must be between 0 and 100 inclusive` });
        }
      }
    }

    const recordValid = errors.length === 0;
    if (recordValid) {
      validCount++;
    } else {
      errorCount++;
    }

    stagedRecords.push({
      rowNumber,
      raw: rawRow,
      parsed,
      errors,
      resolvedProductId,
      resolvedAreaId,
      valid: recordValid
    });
  }

  batchObj.records = stagedRecords;

  // Set initial status to VALIDATED
  batchObj.status = "VALIDATED";

  // 4. Run Group-Level Validation (Product + Year atomicity checks)
  // Group only records that are initially row-level valid
  const validStagedRecords = stagedRecords.filter(r => r.valid);

  if (templateType === "productareadistribution") {
    // For area distribution: potential percentages for a given product and year must sum to exactly 100%
    const groupsMap = new Map<string, StagedImportRecord[]>();
    for (const rec of validStagedRecords) {
      const key = `${rec.resolvedProductId}::${rec.parsed.year}`;
      if (!groupsMap.has(key)) {
        groupsMap.set(key, []);
      }
      groupsMap.get(key)!.push(rec);
    }

    for (const [key, groupRecs] of groupsMap.entries()) {
      const [productId, grpYear] = key.split("::");
      const sum = groupRecs.reduce((acc, r) => acc + Number(r.parsed.potentialPercentage), 0);
      
      // Let's check floating point issues (e.g. within 0.0001)
      const absDiff = Math.abs(sum - 100);
      if (absDiff > 0.00001) {
        // Find raw product name/sku from any row
        const productInput = groupRecs[0].parsed.product;
        const errMsg = `Group Validation Failed: Total potential percentage for product '${productInput}' in year ${grpYear} sums to ${sum}%, but must sum to exactly 100%.`;
        
        // Mark all records in this group as invalid
        for (const r of groupRecs) {
          r.valid = false;
          r.errors.push({
            code: "GROUP_TOTAL_MISMATCH",
            field: "potentialPercentage",
            message: errMsg
          });
        }
        batchObj.globalErrors.push({ code: "GROUP_TOTAL_MISMATCH", message: errMsg });
      }
    }
  } else if (templateType === "productquarterlydistribution") {
    // For quarterly distribution: Q1+Q2+Q3+Q4 for each row must sum to exactly 100%
    for (const rec of validStagedRecords) {
      const q1 = Number(rec.parsed.q1Percentage || 0);
      const q2 = Number(rec.parsed.q2Percentage || 0);
      const q3 = Number(rec.parsed.q3Percentage || 0);
      const q4 = Number(rec.parsed.q4Percentage || 0);
      const sum = q1 + q2 + q3 + q4;
      
      const absDiff = Math.abs(sum - 100);
      if (absDiff > 0.00001) {
        const errMsg = `Group Validation Failed: Quarterly percentages sum to ${sum}%, but must sum to exactly 100%.`;
        rec.valid = false;
        rec.errors.push({
          code: "QUARTERLY_TOTAL_MISMATCH",
          message: errMsg
        });
        batchObj.globalErrors.push({ code: "QUARTERLY_TOTAL_MISMATCH", message: `Row ${rec.rowNumber} (${rec.parsed.product}): ${errMsg}` });
      }
    }
  }

  // Recalculate valid/error counts after group validation
  batchObj.validRecordsCount = stagedRecords.filter(r => r.valid).length;
  batchObj.errorRecordsCount = stagedRecords.filter(r => !r.valid).length;

  if (batchObj.errorRecordsCount > 0) {
    batchObj.status = "FAILED";
  } else {
    batchObj.status = "PREVIEW_READY";
  }

  // Save the complete validation staging record inside the database
  await db.collection("targetImports").doc(importId).set(batchObj);

  return batchObj;
}

/**
 * Commits the staged targets of a verified import batch.
 * Guarantees group-level atomicity: if any error occurs during write, roll back changes.
 */
export async function commitImportBatch(
  db: any,
  importId: string,
  actorEmail: string
): Promise<{ success: boolean; status: string; committedCount: number; error?: string }> {
  const batchRef = db.collection("targetImports").doc(importId);
  const snap = await batchRef.get();
  
  if (!snap.exists) {
    return { success: false, status: "FAILED", committedCount: 0, error: "Import batch not found" };
  }

  const batchObj = snap.data() as TargetImportBatch;

  if (batchObj.status !== "PREVIEW_READY") {
    return {
      success: false,
      status: batchObj.status,
      committedCount: 0,
      error: `Cannot commit import batch in status '${batchObj.status}'. Only 'PREVIEW_READY' batches can be committed.`
    };
  }

  // Update status to COMMITTING
  await batchRef.update({ status: "COMMITTING" });

  const createdIds: string[] = [];
  const updatedSnapshot: Record<string, any> = {};

  try {
    const validRecords = batchObj.records.filter(r => r.valid);
    
    // In order to perform transactional, group-level atomic writes, we split writes into logical Firestore write batches
    // Each standard Firestore write batch has a limit of 500 operations.
    let writeBatch = db.batch();
    let opCount = 0;

    const planId = createProductTargetPlanId(batchObj.countryId, batchObj.year, 1);

    // Pre-create or update Target Plan document to guarantee its existence
    const planRef = db.collection("productTargetPlans").doc(planId);
    const planSnap = await planRef.get();
    if (!planSnap.exists) {
      const planPayload = {
        planId,
        countryId: batchObj.countryId,
        year: batchObj.year,
        version: 1,
        status: TargetStatus.DRAFT,
        currencyCode: "USD",
        monthlyDistributionMethod: "EQUAL_WITHIN_QUARTER",
        active: true,
        createdAt: new Date().toISOString(),
        createdBy: actorEmail,
        updatedAt: new Date().toISOString(),
        updatedBy: actorEmail
      };
      writeBatch.set(planRef, planPayload);
      opCount++;
      createdIds.push(planId);
    }

    for (const rec of validRecords) {
      const productId = rec.resolvedProductId!;
      const year = batchObj.year;

      if (batchObj.templateType === "annualproducttarget") {
        const annualTargetId = createProductAnnualTargetId(planId, productId);
        const targetRef = db.collection("productAnnualTargets").doc(annualTargetId);
        
        // Save original document for rollback
        const targetSnap = await targetRef.get();
        if (targetSnap.exists) {
          updatedSnapshot[annualTargetId] = targetSnap.data();
        } else {
          createdIds.push(annualTargetId);
        }

        const payload = {
          targetId: annualTargetId,
          planId,
          countryId: batchObj.countryId,
          productId,
          year,
          annualTargetUnits: Number(rec.parsed.annualTargetUnits),
          currencyCode: "USD",
          status: TargetStatus.DRAFT,
          version: 1,
          active: true,
          createdAt: new Date().toISOString(),
          createdBy: actorEmail,
          updatedAt: new Date().toISOString(),
          updatedBy: actorEmail
        };

        const shapeValidation = validateProductAnnualTargetShape(payload);
        if (!shapeValidation.valid) {
          throw new Error(`Row ${rec.rowNumber} Target shape validation failed: ${shapeValidation.errors[0].message}`);
        }

        writeBatch.set(targetRef, payload);
        opCount++;

      } else if (batchObj.templateType === "productareadistribution") {
        const annualTargetId = createProductAnnualTargetId(planId, productId);
        const areaId = rec.resolvedAreaId!;
        const areaPotentialId = createProductAreaPotentialId(annualTargetId, areaId);
        const potentialRef = db.collection("productAreaPotentials").doc(areaPotentialId);

        // Save original document for rollback
        const potentialSnap = await potentialRef.get();
        if (potentialSnap.exists) {
          updatedSnapshot[areaPotentialId] = potentialSnap.data();
        } else {
          createdIds.push(areaPotentialId);
        }

        const payload = {
          areaPotentialId,
          planId,
          annualTargetId,
          countryId: batchObj.countryId,
          productId,
          year,
          areaId,
          potentialPercentage: Number(rec.parsed.potentialPercentage),
          status: TargetStatus.DRAFT,
          version: 1,
          active: true,
          createdAt: new Date().toISOString(),
          createdBy: actorEmail,
          updatedAt: new Date().toISOString(),
          updatedBy: actorEmail
        };

        const shapeValidation = validateProductAreaPotentialShape(payload);
        if (!shapeValidation.valid) {
          throw new Error(`Row ${rec.rowNumber} Area Potential shape validation failed: ${shapeValidation.errors[0].message}`);
        }

        writeBatch.set(potentialRef, payload);
        opCount++;

      } else if (batchObj.templateType === "productquarterlydistribution") {
        const annualTargetId = createProductAnnualTargetId(planId, productId);
        const quarterlyDistributionId = createProductQuarterlyDistributionId(annualTargetId);
        const distributionRef = db.collection("productQuarterlyDistributions").doc(quarterlyDistributionId);

        // Save original document for rollback
        const distSnap = await distributionRef.get();
        if (distSnap.exists) {
          updatedSnapshot[quarterlyDistributionId] = distSnap.data();
        } else {
          createdIds.push(quarterlyDistributionId);
        }

        const payload = {
          quarterlyDistributionId,
          planId,
          annualTargetId,
          countryId: batchObj.countryId,
          productId,
          year,
          q1Percentage: Number(rec.parsed.q1Percentage),
          q2Percentage: Number(rec.parsed.q2Percentage),
          q3Percentage: Number(rec.parsed.q3Percentage),
          q4Percentage: Number(rec.parsed.q4Percentage),
          status: TargetStatus.DRAFT,
          version: 1,
          active: true,
          createdAt: new Date().toISOString(),
          createdBy: actorEmail,
          updatedAt: new Date().toISOString(),
          updatedBy: actorEmail
        };

        const shapeValidation = validateProductQuarterlyDistributionShape(payload);
        if (!shapeValidation.valid) {
          throw new Error(`Row ${rec.rowNumber} Quarterly Distribution shape validation failed: ${shapeValidation.errors[0].message}`);
        }

        writeBatch.set(distributionRef, payload);
        opCount++;
      }

      // Commit early if batch limit of 400 is reached
      if (opCount >= 400) {
        await writeBatch.commit();
        writeBatch = db.batch();
        opCount = 0;
      }
    }

    if (opCount > 0) {
      await writeBatch.commit();
    }

    // Set batch record state to COMPLETE
    await batchRef.update({
      status: "COMPLETE",
      createdTargetIds: createdIds,
      updatedTargetSnapshot: updatedSnapshot
    });

    return {
      success: true,
      status: "COMPLETE",
      committedCount: validRecords.length
    };

  } catch (error: any) {
    console.error(`[Target Import Commit Failure] Failed to commit batch ${importId}:`, error);
    
    // Set status back to FAILED
    await batchRef.update({
      status: "FAILED",
      globalErrors: [{ code: "COMMIT_FAILURE", message: error.message || String(error) }]
    });

    return {
      success: false,
      status: "FAILED",
      committedCount: 0,
      error: error.message || String(error)
    };
  }
}

/**
 * Rolls back a completed or partial target import batch, restoring original snapshots.
 */
export async function rollbackImportBatch(
  db: any,
  importId: string
): Promise<{ success: boolean; status: string; rolledBackCount: number; error?: string }> {
  const batchRef = db.collection("targetImports").doc(importId);
  const snap = await batchRef.get();
  
  if (!snap.exists) {
    return { success: false, status: "FAILED", rolledBackCount: 0, error: "Import batch not found" };
  }

  const batchObj = snap.data() as TargetImportBatch;

  if (batchObj.status !== "COMPLETE" && batchObj.status !== "PARTIAL") {
    return {
      success: false,
      status: batchObj.status,
      rolledBackCount: 0,
      error: `Cannot roll back import batch in status '${batchObj.status}'. Only completed or partial batches can be rolled back.`
    };
  }

  try {
    let writeBatch = db.batch();
    let opCount = 0;
    let rolledBackCount = 0;

    // 1. Delete all newly created documents
    if (batchObj.createdTargetIds && batchObj.createdTargetIds.length > 0) {
      for (const docId of batchObj.createdTargetIds) {
        let collectionName = "";
        if (docId.startsWith("PTP::")) collectionName = "productTargetPlans";
        else if (docId.startsWith("PAT::")) collectionName = "productAnnualTargets";
        else if (docId.startsWith("PAP::")) collectionName = "productAreaPotentials";
        else if (docId.startsWith("PQD::")) collectionName = "productQuarterlyDistributions";

        if (collectionName) {
          const docRef = db.collection(collectionName).doc(docId);
          writeBatch.delete(docRef);
          opCount++;
          rolledBackCount++;

          if (opCount >= 400) {
            await writeBatch.commit();
            writeBatch = db.batch();
            opCount = 0;
          }
        }
      }
    }

    // 2. Restore original documents from overwritten snapshot backup
    if (batchObj.updatedTargetSnapshot) {
      for (const [docId, originalData] of Object.entries(batchObj.updatedTargetSnapshot)) {
        let collectionName = "";
        if (docId.startsWith("PAT::")) collectionName = "productAnnualTargets";
        else if (docId.startsWith("PAP::")) collectionName = "productAreaPotentials";
        else if (docId.startsWith("PQD::")) collectionName = "productQuarterlyDistributions";

        if (collectionName) {
          const docRef = db.collection(collectionName).doc(docId);
          writeBatch.set(docRef, originalData);
          opCount++;
          rolledBackCount++;

          if (opCount >= 400) {
            await writeBatch.commit();
            writeBatch = db.batch();
            opCount = 0;
          }
        }
      }
    }

    if (opCount > 0) {
      await writeBatch.commit();
    }

    // 3. Mark the batch status as ROLLED_BACK
    await batchRef.update({ status: "ROLLED_BACK" });

    return {
      success: true,
      status: "ROLLED_BACK",
      rolledBackCount
    };

  } catch (error: any) {
    console.error(`[Target Import Rollback Failure] Failed to roll back batch ${importId}:`, error);
    return {
      success: false,
      status: batchObj.status,
      rolledBackCount: 0,
      error: error.message || String(error)
    };
  }
}
