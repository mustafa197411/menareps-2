import { describe, expect, it } from "vitest";
import {
  buildKeyMessagePersistenceFields,
  changeDetailingProductState,
  duplicateProductIds,
  evaluateDetailingKeyMessageCompletion,
  filterKeyMessagesForProduct,
  filterMaterialsForProduct,
  getEligibleProductsForDetailingBlock,
  resolveDetailingEligibility,
  retainEligibleIds,
  validateDetailingCompletion
} from "./lib/physicianVisitDetailingIntegrity";

const products = [
  { id: "PROD-P1", name: "Shared", promotionGroupId: "PG-PRIMARY", isActive: true },
  { id: "PROD-P2", name: "Shared", promotionGroupId: "PG-PRIMARY", isActive: true },
  { id: "PROD-T1", name: "Target", promotionGroupId: "PG-TARGET", isActive: true },
  { id: "PROD-OFF", name: "Inactive", promotionGroupId: "PG-PRIMARY", isActive: false },
  { id: "PROD-NO", name: "Unauthorized", promotionGroupId: "PG-PRIMARY", isActive: true }
];

const eligibility = (selections: { productId: string }[], blockIndex: number, aligned = ["PROD-P1", "PROD-P2", "PROD-T1", "PROD-OFF"]) =>
  getEligibleProductsForDetailingBlock({
    products,
    physicianAlignedProductIds: aligned,
    representativeActiveProductIds: ["PROD-P1", "PROD-P2", "PROD-T1", "PROD-OFF"],
    primaryPromotionGroupId: "PG-PRIMARY",
    targetPromotionGroupIds: ["PG-TARGET"],
    selections,
    blockIndex
  }).map(product => product.id);

describe("WP7.10I physician visit detailing integrity", () => {
  it("1. prevents the same canonical Product ID in two blocks", () => {
    expect(eligibility([{ productId: "PROD-P1" }, { productId: "" }], 1)).not.toContain("PROD-P1");
  });
  it("2. permits duplicate display names when canonical IDs differ", () => {
    expect(eligibility([{ productId: "PROD-P1" }, { productId: "" }], 1)).toContain("PROD-P2");
  });
  it("3. treats the same ID with different display names as a duplicate", () => {
    expect(duplicateProductIds(["PROD-P1", "PROD-P1"])).toEqual(["PROD-P1"]);
  });
  it("4. makes a removed selection eligible elsewhere again", () => {
    expect(eligibility([{ productId: "" }, { productId: "" }], 1)).toContain("PROD-P1");
  });
  it("5. requires the first product to belong to the primary group", () => {
    expect(eligibility([{ productId: "" }], 0)).toEqual(expect.arrayContaining(["PROD-P1", "PROD-P2"]));
  });
  it("6. rejects target-only products in block one when primary is eligible", () => {
    expect(eligibility([{ productId: "" }], 0)).not.toContain("PROD-T1");
  });
  it("7. allows target products in later blocks", () => {
    expect(eligibility([{ productId: "PROD-P1" }, { productId: "" }], 1)).toContain("PROD-T1");
  });
  it("8. excludes representative-unauthorized products", () => {
    expect(eligibility([{ productId: "" }], 0)).not.toContain("PROD-NO");
  });
  it("9. excludes physician-unaligned products", () => {
    expect(eligibility([{ productId: "" }], 0, ["PROD-P1"])).not.toContain("PROD-P2");
  });
  it("10. excludes inactive products", () => {
    expect(eligibility([{ productId: "" }], 0)).not.toContain("PROD-OFF");
  });
  it("11. filters key messages by exact Product ID", () => {
    expect(filterKeyMessagesForProduct([{ id: "KM-A", productId: "PROD-P1", isApproved: true }, { id: "KM-B", productId: "PROD-P2", isApproved: true }], "PROD-P1")).toEqual([{ id: "KM-A", productId: "PROD-P1", isApproved: true }]);
  });
  it("12. clears selected key messages that are ineligible after switching", () => {
    expect(retainEligibleIds(["KM-A"], ["KM-B"])).toEqual([]);
  });
  it("13. filters detailing materials by exact Product ID", () => {
    expect(filterMaterialsForProduct([{ id: "MAT-A", productIds: ["PROD-P1"], isApproved: true }, { id: "MAT-B", productId: "PROD-P2", isApproved: true }], "PROD-P1")).toEqual([{ id: "MAT-A", productIds: ["PROD-P1"], isApproved: true }]);
  });
  it("14. clears ineligible materials after switching", () => {
    expect(retainEligibleIds(["MAT-A"], ["MAT-B"])).toEqual([]);
  });
  it("15. completion rejects duplicate Product IDs", () => {
    expect(validateDetailingCompletion({ selectedProductIds: ["PROD-P1", "PROD-P1"], allowedVisitProductIds: ["PROD-P1"], products, primaryPromotionGroupId: "PG-PRIMARY" }).validationResult).toBe("FAIL");
  });
  it("16. completion rejects IDs outside allowedVisitProductIds", () => {
    expect(validateDetailingCompletion({ selectedProductIds: ["PROD-NO"], allowedVisitProductIds: ["PROD-P1"], products, primaryPromotionGroupId: "PG-PRIMARY" }).unauthorizedProductIds).toEqual(["PROD-NO"]);
  });
  it("17. accepts two different authorized Product IDs", () => {
    expect(validateDetailingCompletion({ selectedProductIds: ["PROD-P1", "PROD-T1"], allowedVisitProductIds: ["PROD-P1", "PROD-T1"], products, primaryPromotionGroupId: "PG-PRIMARY" }).validationResult).toBe("PASS");
  });

  const visitState = {
    samples: [{ productId: "PROD-P1", quantity: 2 }],
    additionalSampleRequests: [{ productName: "P1", quantityNeeded: 4 }],
    marketingRequests: [{ requestType: "Sponsorship" }],
    generalNotes: "general",
    followUpRequired: true,
    followUpDate: "2026-09-01",
    followUpNotes: "next objective",
    detailing: [{ productId: "PROD-P1" }]
  };
  const changedDetailing = { ...visitState, detailing: [{ productId: "PROD-P2" }] };
  it("18. preserves Samples Given while detailing changes", () => expect(changedDetailing.samples).toEqual(visitState.samples));
  it("19. preserves Sample Request while detailing changes", () => expect(changedDetailing.additionalSampleRequests).toEqual(visitState.additionalSampleRequests));
  it("20. preserves Marketing Request while detailing changes", () => expect(changedDetailing.marketingRequests).toEqual(visitState.marketingRequests));
  it("21. preserves general and follow-up notes while detailing changes", () => {
    expect(changedDetailing).toMatchObject({ generalNotes: "general", followUpRequired: true, followUpDate: "2026-09-01", followUpNotes: "next objective" });
  });

  it("22. resolves promotion2/Panadol by canonical promotionGroupId only", () => {
    const result = resolveDetailingEligibility({
      products: [{ id: "PANADOL-ID", name: "Panadol", promotionGroupId: "promotion2", isActive: true }],
      physicianAlignedProductIds: ["PANADOL-ID"], representativeActiveProductIds: ["PANADOL-ID"],
      primaryPromotionGroupId: "promotion2", targetPromotionGroupIds: [], selections: [{ productId: "" }],
      blockIndex: 0, selectedPromotionGroupId: "promotion2"
    });
    expect(result.eligibleProductIds).toEqual(["PANADOL-ID"]);
  });

  it("23. ignores group display-name, Product name, and brand text", () => {
    const unrelatedLabels = [{ id: "PANADOL-ID", name: "Entirely Different", brand: "Not promotion 2", promotionGroupId: "promotion2", isActive: true }];
    expect(getEligibleProductsForDetailingBlock({
      products: unrelatedLabels, physicianAlignedProductIds: ["PANADOL-ID"], representativeActiveProductIds: ["PANADOL-ID"],
      primaryPromotionGroupId: "promotion2", targetPromotionGroupIds: [], selections: [{ productId: "" }], blockIndex: 0,
      selectedPromotionGroupId: "promotion2"
    }).map(product => product.id)).toEqual(["PANADOL-ID"]);
  });

  it("24. later blocks allow remaining primary and target products without a forced group", () => {
    expect(eligibility([{ productId: "PROD-P1" }, { productId: "" }], 1)).toEqual(expect.arrayContaining(["PROD-P2", "PROD-T1"]));
    expect(eligibility([{ productId: "PROD-P1" }, { productId: "PROD-T1" }, { productId: "" }], 2)).toContain("PROD-P2");
  });

  it("25. continues until every unique eligible Product ID is exhausted", () => {
    expect(eligibility([{ productId: "PROD-P1" }, { productId: "PROD-T1" }, { productId: "PROD-P2" }, { productId: "" }], 3)).toEqual([]);
  });

  it("26. selecting another valid group prevents a false empty block", () => {
    const result = resolveDetailingEligibility({
      products, physicianAlignedProductIds: ["PROD-P1", "PROD-P2", "PROD-T1"],
      representativeActiveProductIds: ["PROD-P1", "PROD-P2", "PROD-T1"], primaryPromotionGroupId: "PG-PRIMARY",
      targetPromotionGroupIds: ["PG-TARGET"], selections: [{ productId: "PROD-P1" }, { productId: "" }], blockIndex: 1
    });
    expect(result.availableProductIdsForBlock).toEqual(expect.arrayContaining(["PROD-P2", "PROD-T1"]));
  });

  it("27. changing one block leaves unaffected reaction, intent, and notes intact", () => {
    const blocks = [
      { productId: "PROD-P1", reaction: "Positive", prescriptionIntent: 8, notes: "keep" },
      { productId: "PROD-T1", reaction: "Neutral", prescriptionIntent: 4, notes: "change" }
    ];
    const changed = blocks.map((block, index) => index === 1 ? { ...block, productId: "PROD-P2" } : block);
    expect(changed[0]).toEqual(blocks[0]);
  });

  it("28. filters later products by exact selected Promotion Group ID", () => {
    const result = resolveDetailingEligibility({
      products, physicianAlignedProductIds: ["PROD-P1", "PROD-P2", "PROD-T1"],
      representativeActiveProductIds: ["PROD-P1", "PROD-P2", "PROD-T1"], primaryPromotionGroupId: "PG-PRIMARY",
      targetPromotionGroupIds: ["PG-TARGET"], selections: [{ productId: "PROD-P1" }, { productId: "" }], blockIndex: 1,
      selectedPromotionGroupId: "PG-TARGET"
    });
    expect(result.availableProductIdsForBlock).toEqual(["PROD-T1"]);
  });

  it("29. changing Product resets messages/materials but preserves reaction and notes", () => {
    const original = {
      productId: "PROD-P1", selectedMessages: ["KM-A"], selectedMaterials: ["MAT-A"], hasPresented: true,
      reaction: "Positive", notes: "preserve", prescriptionIntent: 9
    };
    expect(changeDetailingProductState(original, "PROD-P2")).toEqual({
      ...original, productId: "PROD-P2", selectedMessages: [], presentedKeyMessageIds: [], selectedMaterials: [], hasPresented: false
    });
  });

  it("30. changing detailing preserves samples, marketing, and visit-level data", () => {
    const visit = {
      id: "VIS-1", samples: [{ productId: "PROD-P1", quantity: 1 }], marketingRequests: [{ requestType: "Flyers" }],
      gps: { lat: 1, lng: 2 }, visitStartedAt: "2026-08-08T00:00:00Z",
      detailing: [{ productId: "PROD-P1", selectedMessages: ["KM-A"], selectedMaterials: ["MAT-A"], reaction: "Positive", notes: "note" }]
    };
    const changed = { ...visit, detailing: [changeDetailingProductState(visit.detailing[0], "PROD-P2")] };
    expect(changed).toMatchObject({ id: visit.id, samples: visit.samples, marketingRequests: visit.marketingRequests, gps: visit.gps, visitStartedAt: visit.visitStartedAt });
  });

  it("31. Key Message eligibility requires the exact canonical Product ID", () => {
    const messages = [
      { id: "KM-ID", productId: "PROD-P1", productSku: "SHARED-SKU", isApproved: true },
      { id: "KM-SKU-ONLY", productSku: "SHARED-SKU", isApproved: true },
      { id: "KM-OTHER", productId: "PROD-P2", productSku: "SHARED-SKU", isApproved: true }
    ];
    expect(filterKeyMessagesForProduct(messages, "PROD-P1").map(message => message.id)).toEqual(["KM-ID"]);
  });

  it("32. Detailing Material eligibility ignores legacy display Product text", () => {
    const materials = [
      { id: "MAT-ID", productId: "PROD-P1", isApproved: true },
      { id: "MAT-IDS", productIds: ["PROD-P1"], isApproved: true },
      { id: "MAT-DISPLAY", product: "PROD-P1", isApproved: true }
    ];
    expect(filterMaterialsForProduct(materials, "PROD-P1").map(material => material.id)).toEqual(["MAT-ID", "MAT-IDS"]);
  });

  describe("WP710N optional key-message selection", () => {
    const completion = (available: string[], selected: string[], presented: string[] = []) =>
      evaluateDetailingKeyMessageCompletion({
        availableKeyMessageIds: available,
        selectedKeyMessageIds: selected,
        presentedKeyMessageIds: presented
      });

    it("allows progression with zero available messages", () => {
      expect(completion([], []).gatePass).toBe(true);
    });
    it("allows progression with three available messages and zero selected", () => {
      expect(completion(["PRIMARY", "SECONDARY", "TERTIARY"], []).gatePass).toBe(true);
    });
    it("allows progression with one of three selected", () => {
      expect(completion(["PRIMARY", "SECONDARY", "TERTIARY"], ["SECONDARY"]).gatePass).toBe(true);
    });
    it("allows progression with two of three selected", () => {
      expect(completion(["PRIMARY", "SECONDARY", "TERTIARY"], ["PRIMARY", "TERTIARY"]).gatePass).toBe(true);
    });
    it("allows progression with all messages selected", () => {
      expect(completion(["PRIMARY", "SECONDARY", "TERTIARY"], ["PRIMARY", "SECONDARY", "TERTIARY"]).gatePass).toBe(true);
    });
    it("persists selected canonical IDs and mirrors them to the legacy field", () => {
      expect(buildKeyMessagePersistenceFields(
        ["MSG-1", "MSG-2", "MSG-3"], ["MSG-2", "MSG-3"]
      )).toEqual({
        keyMessageIds: ["MSG-2", "MSG-3"],
        presentedKeyMessages: ["MSG-2", "MSG-3"]
      });
    });
    it("changing selected messages updates the persisted IDs", () => {
      expect(buildKeyMessagePersistenceFields(["MSG-1", "MSG-2", "MSG-3"], ["MSG-1"]).keyMessageIds).toEqual(["MSG-1"]);
      expect(buildKeyMessagePersistenceFields(["MSG-1", "MSG-2", "MSG-3"], ["MSG-2", "MSG-3"]).keyMessageIds).toEqual(["MSG-2", "MSG-3"]);
    });
    it("allows product discussion notes with zero selected messages", () => {
      const block = { productId: "PROD-P1", selectedMessages: [], notes: "Discussed an unlisted topic" };
      expect(completion(["MSG-1"], block.selectedMessages).gatePass).toBe(true);
      expect(block.notes).toBe("Discussed an unlisted topic");
    });
    it("maintains independent selections across multiple Product blocks", () => {
      expect(completion(["P1-A", "P1-B"], ["P1-B"]).presentedKeyMessageIds).toEqual(["P1-B"]);
      expect(completion(["P2-A", "P2-B"], []).presentedKeyMessageIds).toEqual([]);
    });
    it("preserves Primary/Secondary/Tertiary source ordering for display", () => {
      const ordered = filterKeyMessagesForProduct([
        { id: "PRIMARY", productId: "PROD-P1", isApproved: true },
        { id: "SECONDARY", productId: "PROD-P1", isApproved: true },
        { id: "TERTIARY", productId: "PROD-P1", isApproved: true }
      ], "PROD-P1");
      expect(ordered.map(message => message.id)).toEqual(["PRIMARY", "SECONDARY", "TERTIARY"]);
    });
    it("ignores stale or noncanonical selections", () => {
      expect(completion(["MSG-1"], ["STALE", "MSG-1"]).presentedKeyMessageIds).toEqual(["MSG-1"]);
    });
    it("does not use a second confirmation state", () => {
      const result = completion(["MSG-1", "MSG-2"], ["MSG-2"], []);
      expect(result.presentedKeyMessageIds).toEqual(["MSG-2"]);
      expect(result.gateFailureReason).toBeNull();
    });
  });
});
