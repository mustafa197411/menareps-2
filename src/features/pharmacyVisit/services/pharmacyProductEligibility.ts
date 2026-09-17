import { Product, UserProductAssignment } from "../../../types";

export interface ExcludedProductReason {
  productId: string;
  reason: string;
}

export interface ProductEligibilityReport {
  actorUid: string;
  assignmentDocumentCount: number;
  assignedProductIds: string[];
  resolvedProductCount: number;
  eligibleProductCount: number;
  excluded: ExcludedProductReason[];
  eligibleProducts: Product[];
}

/**
  * Pure service for resolving authorized canonical Products for a Sales/Medical Representative.
  */
export function getEligibleProductsForRep(
  actorUid: string,
  userProductAssignments: UserProductAssignment[] = [],
  products: Product[] = []
): ProductEligibilityReport {
  const userAssignments = (userProductAssignments || []).filter(
    (a) => a.userId === actorUid && a.status === "Active" && a.active !== false
  );

  const assignedProductIdsSet = new Set<string>();
  userAssignments.forEach((a) => {
    if (a.productId && a.productId.trim() !== "") {
      assignedProductIdsSet.add(a.productId.trim());
    }
  });

  const assignedProductIds = Array.from(assignedProductIdsSet).sort();
  const excluded: ExcludedProductReason[] = [];
  const eligibleProducts: Product[] = [];

  assignedProductIds.forEach((pId) => {
    const product = products.find((p) => p.id === pId);

    if (!product) {
      excluded.push({
        productId: pId,
        reason: "Product ID not found in global Product catalog"
      });
      return;
    }

    const isProdActive =
      product.isActive !== false &&
      (product as any).active !== false &&
      !(product as any).isDeleted;

    if (!isProdActive) {
      excluded.push({
        productId: pId,
        reason: "Product status is marked inactive or deleted"
      });
      return;
    }

    if ((product as any).isSellable === false) {
      excluded.push({
        productId: pId,
        reason: "Product is explicitly marked non-sellable"
      });
      return;
    }

    eligibleProducts.push(product);
  });

  // Sort eligible products by name
  eligibleProducts.sort((a, b) => a.name.localeCompare(b.name));

  const report: ProductEligibilityReport = {
    actorUid,
    assignmentDocumentCount: userAssignments.length,
    assignedProductIds,
    resolvedProductCount: assignedProductIds.length - excluded.length,
    eligibleProductCount: eligibleProducts.length,
    excluded,
    eligibleProducts
  };

  // Build WP6.4 Assignment Integrity Audit JSON
  const orphanAssignments: Array<{ assignmentId: string; productId: string; reason: string }> = [];
  const inactiveAssignments: Array<{ assignmentId: string; productId: string; reason: string }> = [];

  userAssignments.forEach((assignment) => {
    const pId = assignment.productId?.trim();
    if (!pId) return;

    const matchedProduct = products.find((p) => p.id === pId);
    if (!matchedProduct) {
      orphanAssignments.push({
        assignmentId: (assignment as any).id || assignment.assignmentId || "N/A",
        productId: pId,
        reason: "Product ID not found in global Product catalog"
      });
    } else {
      const isProdActive =
        matchedProduct.isActive !== false &&
        (matchedProduct as any).active !== false &&
        !(matchedProduct as any).isDeleted;

      if (!isProdActive) {
        inactiveAssignments.push({
          assignmentId: (assignment as any).id || assignment.assignmentId || "N/A",
          productId: pId,
          reason: "Product status is marked inactive or deleted"
        });
      } else if ((matchedProduct as any).isSellable === false) {
        inactiveAssignments.push({
          assignmentId: (assignment as any).id || assignment.assignmentId || "N/A",
          productId: pId,
          reason: "Product is explicitly marked non-sellable"
        });
      }
    }
  });

  const assignmentIntegrityAudit = {
    actorUid,
    assignmentCount: userAssignments.length,
    validAssignments: eligibleProducts.map((p) => p.id),
    orphanAssignments,
    inactiveAssignments,
    repairApplied: false
  };

  console.info(
    "[REP_PRODUCT_ASSIGNMENT_INTEGRITY_JSON]",
    JSON.stringify(assignmentIntegrityAudit)
  );

  // Diagnostic log as required by Section 4 & 19
  console.info(
    "[PHARMACY_VISIT_PRODUCT_SOURCE_JSON]",
    JSON.stringify({
      actorUid: report.actorUid,
      assignmentDocumentCount: report.assignmentDocumentCount,
      assignedProductIds: report.assignedProductIds,
      resolvedProductCount: report.resolvedProductCount,
      eligibleProductCount: report.eligibleProductCount,
      excluded: report.excluded
    })
  );

  return report;
}

/**
 * Pure service for resolving authorized canonical Products for Stock Requests (Step 5).
 * Reuses exact same eligibility rules and source as Step 2.
 */
export function getEligibleStockProductsForRep(
  actorUid: string,
  userProductAssignments: UserProductAssignment[] = [],
  products: Product[] = []
): ProductEligibilityReport {
  const report = getEligibleProductsForRep(actorUid, userProductAssignments, products);

  console.info(
    "[PHARMACY_VISIT_STOCK_PRODUCT_SOURCE_JSON]",
    JSON.stringify({
      authenticatedUid: actorUid,
      source: "userProductAssignments + products",
      eligibleProductCount: report.eligibleProductCount,
      eligibleProductIds: report.eligibleProducts.map((p) => p.id),
      reusedStep2ProductSource: true,
      mockFallbackUsed: false,
      excluded: report.excluded
    })
  );

  return report;
}

