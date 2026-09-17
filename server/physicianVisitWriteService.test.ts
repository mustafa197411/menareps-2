import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { canonicalizeVisitDetailing, PhysicianVisitWriteError, parsePhysicianVisitWriteRequest, resolveAuthoritativeVisitMarket, validateAuthoritativeDetailing, validateCanonicalDetailingMaterials } from "./physicianVisitWriteService";

const visitWriterSource = readFileSync(new URL("./physicianVisitWriteService.ts", import.meta.url), "utf8");

const physician = { id: "PHY-1", active: true, areaId: "AREA-1", specialtyId: "SPEC-1", primaryPromotionGroupId: "PG-1", targetPromotionGroupIds: ["PG-2"], alignedProductIds: ["PROD-1", "PROD-2"] };
const products = [
  { id: "PROD-1", brand: "Primary", promotionGroupId: "PG-1", active: true },
  { id: "PROD-2", brand: "Target", promotionGroupId: "PG-2", active: true },
  { id: "PROD-X", brand: "Other", promotionGroupId: "PG-X", active: true },
];
const messages = [{ id: "KM-1", productId: "PROD-1", isApproved: true, active: true, targetSpecialtyIds: ["SPEC-1"] }];
const material = {
  id: "RES-1", resourceId: "RES-1", active: true, uploadStatus: "COMPLETE", approvalStatus: "PUBLISHED",
  promotionGroupId: "PG-1", resourceScope: "SELECTED_PRODUCTS", productIds: ["PROD-1"], specialtyIds: ["SPEC-1"],
  effectiveDate: "2026-01-01", expiryDate: "2026-12-31", storagePath: "resources/PG-1/RES-1/v1/file.pdf",
};

function input(uid = "fresh-med-a") {
  return {
    actorUid: uid,
    actor: { id: uid, role: "Medical Representative", active: true, loginAllowed: true, areaIds: ["AREA-1"] },
    physician,
    assignments: [{ id: `PA-${uid}`, userId: uid, productId: "PROD-1", status: "Active", active: true }, { id: `PB-${uid}`, userId: uid, productId: "PROD-2", status: "Active", active: true }],
    products,
    keyMessages: messages,
    visit: { id: `VIS-${uid}`, physicianId: "PHY-1", physicianName: "Doctor", repId: uid, repName: "Rep", areaId: "AREA-1", visitDate: "2026-08-17", durationSeconds: 120, detailing: [{ productId: "PROD-1", brandName: "untrusted", reaction: "Positive" as const, prescriptionIntent: "Will Prescribe", notes: "", detailingOrder: 1, keyMessageIds: ["KM-1"], presentedKeyMessages: ["KM-1"] }, { productId: "PROD-2", brandName: "Target", reaction: "Neutral" as const, prescriptionIntent: "Considering", notes: "", detailingOrder: 2, keyMessageIds: [], presentedKeyMessages: [] }], samples: [], additionalSampleRequests: [], generalNotes: "", gpsVerified: true } as any,
  };
}

function rejected(fn: () => unknown, code: string) {
  try { fn(); throw new Error("EXPECTED_REJECTION"); } catch (error) { expect(error).toBeInstanceOf(PhysicianVisitWriteError); expect((error as PhysicianVisitWriteError).code).toBe(code); }
}

describe("backend-authoritative Physician Visit completion", () => {
  it("accepts two unrelated fresh Medical Representative UIDs through the same role/scope policy", () => {
    expect(validateAuthoritativeDetailing(input("fresh-med-a")).allowedProductIds).toEqual(["PROD-1", "PROD-2"]);
    expect(validateAuthoritativeDetailing(input("fresh-med-b")).allowedProductIds).toEqual(["PROD-1", "PROD-2"]);
  });
  it("rejects an actor UID mismatch", () => { const value = input(); value.visit.repId = "other"; rejected(() => validateAuthoritativeDetailing(value), "VISIT_ACTOR_MISMATCH"); });
  it("does not let Product Manager functional scope grant representative-only visit creation", () => { const value = input(); value.actor.role = "Product Manager"; rejected(() => validateAuthoritativeDetailing(value), "VISIT_ROLE_NOT_AUTHORIZED"); });
  it("rejects a physician outside canonical representative geography", () => { const value = input(); value.actor.areaIds = ["AREA-2"]; rejected(() => validateAuthoritativeDetailing(value), "PHYSICIAN_OUTSIDE_AUTHORIZED_AREA"); });
  it("rejects an unassigned or physician-unaligned detailing product", () => { const value = input(); value.visit.detailing[1].productId = "PROD-X"; rejected(() => validateAuthoritativeDetailing(value), "DETAILING_PRODUCT_NOT_AUTHORIZED"); });
  it("enforces the Primary Promotion Group first", () => { const value = input(); value.visit.detailing.reverse(); value.visit.detailing.forEach((d: any, i: number) => d.detailingOrder = i + 1); rejected(() => validateAuthoritativeDetailing(value), "DETAILING_PRODUCT_NOT_AUTHORIZED"); });
  it("fails closed when Physician Master lacks its mandatory Primary Promotion Group", () => { const value = input(); value.physician = { ...physician, primaryPromotionGroupId: "" }; rejected(() => validateAuthoritativeDetailing(value), "PHYSICIAN_PRIMARY_PROMOTION_GROUP_REQUIRED"); });
  it("rejects non-sequential detailing order", () => { const value = input(); value.visit.detailing[1].detailingOrder = 3; rejected(() => validateAuthoritativeDetailing(value), "INVALID_DETAILING_ORDER"); });
  it("rejects a Key Message not canonically approved for Product and Specialty", () => { const value = input(); value.visit.detailing[0].keyMessageIds = ["KM-X"]; value.visit.detailing[0].presentedKeyMessages = ["KM-X"]; rejected(() => validateAuthoritativeDetailing(value), "KEY_MESSAGE_NOT_AUTHORIZED"); });
  it("rejects forged presentation state", () => { const value = input(); value.visit.detailing[0].presentedKeyMessages = []; rejected(() => validateAuthoritativeDetailing(value), "INVALID_KEY_MESSAGE_PRESENTATION"); });
  it("accepts independent Product-level Reaction and Prescription Intent values", () => { const value = input(); expect(() => validateAuthoritativeDetailing(value)).not.toThrow(); expect(value.visit.detailing.map((detail: any) => [detail.reaction, detail.prescriptionIntent])).toEqual([["Positive", "Will Prescribe"], ["Neutral", "Considering"]]); });
  it("changing one Product intent does not alter another Product", () => { const value = input(); value.visit.detailing[0].prescriptionIntent = "Needs Info"; expect(value.visit.detailing[1].prescriptionIntent).toBe("Considering"); expect(() => validateAuthoritativeDetailing(value)).not.toThrow(); });
  it.each(["Will Prescribe", "Considering", "Needs Info", "Not Interested"])("accepts canonical intent %s", intent => { const value = input(); value.visit.detailing[0].prescriptionIntent = intent; expect(() => validateAuthoritativeDetailing(value)).not.toThrow(); });
  it("rejects missing, legacy and unknown intent values for new writes", () => { for (const intent of [undefined, "High", "Maybe"]) { const value = input(); value.visit.detailing[0].prescriptionIntent = intent; rejected(() => validateAuthoritativeDetailing(value), "INVALID_PRODUCT_PRESCRIPTION_INTENT"); } });
  it("preserves independent Product intent during canonical persistence mapping", () => { const value = input(); expect(canonicalizeVisitDetailing(value.visit.detailing, products).map(detail => detail.prescriptionIntent)).toEqual(["Will Prescribe", "Considering"]); });
  it("rejects missing or forged visit Area instead of substituting representative geography", () => { for (const areaId of [undefined, "AREA-2"]) { const value = input(); value.visit.areaId = areaId; rejected(() => validateAuthoritativeDetailing(value), "VISIT_CANONICAL_GEOGRAPHY_INVALID"); } });
  it("accepts the selected physician canonical Area", () => expect(() => validateAuthoritativeDetailing(input())).not.toThrow());
  it("rejects samples for a Product outside the visit authorization intersection", () => { const value = input(); value.visit.samples = [{ productId: "PROD-X", productName: "Other", brand: "Other", quantity: 1 }]; rejected(() => validateAuthoritativeDetailing(value), "SAMPLE_PRODUCT_NOT_AUTHORIZED"); });
  it("parses only complete authenticated endpoint payload shapes", () => { expect(parsePhysicianVisitWriteRequest({ visit: input().visit })?.id).toBe("VIS-fresh-med-a"); expect(parsePhysicianVisitWriteRequest({ visit: {} })).toBeNull(); });
  const geography = {
    physician,
    actorAreaIds: ["AREA-1"],
    area: { id: "AREA-1", countryId: "COUNTRY-X", districtId: "DISTRICT-X", cityId: "CITY-X", active: true },
    country: { id: "COUNTRY-X", active: true },
    district: { id: "DISTRICT-X", countryId: "COUNTRY-X", active: true },
    city: { id: "CITY-X", countryId: "COUNTRY-X", districtId: "DISTRICT-X", active: true },
  };
  it("resolves the visit market only through canonical Physician Area ancestry", () => {
    expect(resolveAuthoritativeVisitMarket({ ...geography, markets: [{ marketId: "MARKET-X", countryId: "COUNTRY-X", active: true, businessDocumentCode: "CX" } as any] })).toEqual({ countryId: "COUNTRY-X", marketId: "MARKET-X", businessDocumentCode: "CX" });
  });
  it("fails closed when the canonical country has no active market", () => rejected(() => resolveAuthoritativeVisitMarket({ ...geography, markets: [] }), "VISIT_MARKET_CONFIGURATION_REQUIRED"));
  it("fails closed when the physician canonical Area is inactive", () => rejected(() => resolveAuthoritativeVisitMarket({ ...geography, area: { ...geography.area, active: false }, markets: [{ marketId: "MARKET-X", countryId: "COUNTRY-X", active: true, businessDocumentCode: "CX" } as any] }), "VISIT_CANONICAL_GEOGRAPHY_INVALID"));
  it("fails closed when canonical country market resolution is ambiguous", () => rejected(() => resolveAuthoritativeVisitMarket({ ...geography, markets: [{ marketId: "M1", countryId: "COUNTRY-X", active: true, businessDocumentCode: "C1" } as any, { marketId: "M2", countryId: "COUNTRY-X", active: true, businessDocumentCode: "C2" } as any] }), "VISIT_MARKET_CONFIGURATION_AMBIGUOUS"));
  it("fails closed when the market lacks an explicit business document code", () => rejected(() => resolveAuthoritativeVisitMarket({ ...geography, markets: [{ marketId: "M1", countryId: "COUNTRY-X", active: true } as any] }), "VISIT_DOCUMENT_CODE_CONFIGURATION_REQUIRED"));
  it("fails closed when the market business document code is invalid", () => rejected(() => resolveAuthoritativeVisitMarket({ ...geography, markets: [{ marketId: "M1", countryId: "COUNTRY-X", active: true, businessDocumentCode: "X-" } as any] }), "VISIT_DOCUMENT_CODE_CONFIGURATION_REQUIRED"));
  it("resolves required market configuration before scheduling any transactional writes", () => {
    const transactionBody = visitWriterSource.slice(visitWriterSource.indexOf("return db.runTransaction"));
    expect(transactionBody.indexOf("resolveAuthoritativeVisitMarket({")).toBeGreaterThanOrEqual(0);
    expect(transactionBody.indexOf("resolveAuthoritativeVisitMarket({")).toBeLessThan(transactionBody.indexOf("tx.set("));
    expect(transactionBody.indexOf("resolveAuthoritativeVisitMarket({")).toBeLessThan(transactionBody.indexOf("tx.update("));
  });
  it("ignores payload/display country examples and denies a canonical Area mismatch", () => rejected(() => resolveAuthoritativeVisitMarket({ ...geography, physician: { ...physician, areaId: "OTHER", countryCode: "ZZ" }, markets: [{ marketId: "M1", countryId: "COUNTRY-X", active: true, businessDocumentCode: "CX" } as any] }), "VISIT_CANONICAL_GEOGRAPHY_INVALID"));
});

describe("backend-authoritative detailing material validation", () => {
  function withMaterial(resource: any = material) {
    const value = input();
    value.visit.detailing[0].materialIds = ["RES-1"];
    value.visit.detailing[0].presentedResources = ["RES-1"];
    return { ...value, resources: resource ? [resource] : [] };
  }

  it("accepts a valid canonical material for the detailed Product", () => {
    expect(() => validateAuthoritativeDetailing(withMaterial())).not.toThrow();
  });
  it("rejects an unknown material ID", () => {
    rejected(() => validateAuthoritativeDetailing(withMaterial(null)), "DETAILING_MATERIAL_NOT_FOUND");
  });
  it.each([
    [{ active: false }, "DETAILING_MATERIAL_NOT_ACTIVE"],
    [{ approvalStatus: "DRAFT" }, "DETAILING_MATERIAL_NOT_PUBLISHED"],
    [{ uploadStatus: "UPLOADING" }, "DETAILING_MATERIAL_UPLOAD_INCOMPLETE"],
  ])("rejects an unusable canonical material (%s)", (change, code) => {
    rejected(() => validateAuthoritativeDetailing(withMaterial({ ...material, ...change })), code as string);
  });
  it.each([
    [{ effectiveDate: "2026-08-18" }, "DETAILING_MATERIAL_NOT_YET_EFFECTIVE"],
    [{ expiryDate: "2026-08-16" }, "DETAILING_MATERIAL_EXPIRED"],
  ])("enforces configured resource dates (%s)", (change, code) => {
    rejected(() => validateAuthoritativeDetailing(withMaterial({ ...material, ...change })), code as string);
  });
  it("rejects a material that does not target the detailing Product", () => {
    rejected(() => validateAuthoritativeDetailing(withMaterial({ ...material, productIds: ["PROD-2"] })), "DETAILING_MATERIAL_PRODUCT_MISMATCH");
  });
  it("rejects a canonical Promotion Group mismatch", () => {
    rejected(() => validateAuthoritativeDetailing(withMaterial({ ...material, promotionGroupId: "PG-2" })), "DETAILING_MATERIAL_PROMOTION_GROUP_MISMATCH");
  });
  it("rejects a targeted material for the wrong physician specialty", () => {
    rejected(() => validateAuthoritativeDetailing(withMaterial({ ...material, specialtyIds: ["SPEC-2"] })), "DETAILING_MATERIAL_SPECIALTY_MISMATCH");
  });
  it("rejects material use when the representative lacks Product authorization", () => {
    const value = withMaterial();
    rejected(() => validateCanonicalDetailingMaterials({ visit: value.visit, physician, products, allowedProductIds: ["PROD-2"], resources: value.resources }), "DETAILING_MATERIAL_PRODUCT_NOT_AUTHORIZED");
  });
  it("rejects a material moved to a different Product/detailing block", () => {
    const value = withMaterial();
    value.visit.detailing[0].materialIds = [];
    value.visit.detailing[0].presentedResources = [];
    value.visit.detailing[1].materialIds = ["RES-1"];
    value.visit.detailing[1].presentedResources = ["RES-1"];
    rejected(() => validateAuthoritativeDetailing(value), "DETAILING_MATERIAL_PROMOTION_GROUP_MISMATCH");
  });
  it("accepts the identical material IDs produced after the Fix 1 presentation gate", () => {
    const value = withMaterial();
    const canonical = canonicalizeVisitDetailing(value.visit.detailing, products);
    expect(canonical[0].materialIds).toEqual(["RES-1"]);
    expect(canonical[0].presentedResources).toEqual(["RES-1"]);
  });
  it("preserves existing Product and Key Message authorization", () => {
    const value = withMaterial();
    value.visit.detailing[0].keyMessageIds = ["KM-X"];
    value.visit.detailing[0].presentedKeyMessages = ["KM-X"];
    rejected(() => validateAuthoritativeDetailing(value), "KEY_MESSAGE_NOT_AUTHORIZED");
  });
  it("does not allow direct client metadata to override the canonical resource", () => {
    const value = withMaterial({ ...material, approvalStatus: "DRAFT", productIds: ["PROD-2"] });
    Object.assign(value.visit.detailing[0], { approvalStatus: "PUBLISHED", productIds: ["PROD-1"], specialtyIds: ["SPEC-1"] });
    rejected(() => validateAuthoritativeDetailing(value), "DETAILING_MATERIAL_NOT_PUBLISHED");
  });
  it("rejects mismatched materialIds and presentedResources rather than persisting ambiguous state", () => {
    const value = withMaterial();
    value.visit.detailing[0].presentedResources = [];
    rejected(() => validateAuthoritativeDetailing(value), "INVALID_DETAILING_MATERIAL_PRESENTATION");
  });
  it("locks canonical Academic Resource documents in the same transaction as visit persistence", () => {
    expect(visitWriterSource).toContain('db.collection("academicResources").doc(id)');
    expect(visitWriterSource).toContain("...plannerQuery.docs.map(doc => doc.ref), ...resourceRefs");
  });
});
