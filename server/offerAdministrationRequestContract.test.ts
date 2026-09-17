import { describe, expect, it } from "vitest";
import { parseOfferDraftRequest, parseOfferMutationRequest, parseOfferListRequest, parseOfferRepresentativeRequest, parseOfferProductRequest } from "./offerAdministrationRequestContract";

describe("strict Offer administration requests", () => {
  it("accepts audience and rejects commercial-only eligibility", () => {
    const value = { definition: { code: "CODE", name: "Synthetic", type: "PRODUCT_PERCENTAGE", productScope: { mode: "ALL_PRODUCTS", productIds: [] }, benefit: { kind: "PRODUCT_PERCENTAGE", percentage: 10, base: "ELIGIBLE_PAID_PRODUCT_LINES" }, eligibility: { audienceType: "ALL_SALES_REPRESENTATIVES", startAt: "2026-01-01T00:00:00.000Z", endAt: "2026-12-31T00:00:00.000Z" }, stackingPolicy: { mode: "NO_STACKING", priority: 0, maximumProductOrQuantityOffersPerPaidLine: 1, maximumInvoicePercentageOffersPerInvoice: 1 } } };
    expect(parseOfferDraftRequest(value)).not.toBeNull();
    expect(parseOfferDraftRequest({ definition: { ...value.definition, createdBy: "FORGED" } })).toBeNull();
    expect(parseOfferDraftRequest({ definition: { ...value.definition, eligibility: { companyMarketId: "OLD" } } })).toBeNull();
    for (const audienceType of ["ALL_SALES_REPRESENTATIVES", "MY_SALES_TEAM"]) expect(parseOfferDraftRequest({ definition: { ...value.definition, eligibility: { ...value.definition.eligibility, audienceType, audienceUserIds: ["REP"] } } })).toBeNull();
    for (const audienceUserIds of [[], [""], ["REP", "REP"], new Array(1), [" REP"], [7]]) expect(parseOfferDraftRequest({ definition: { ...value.definition, eligibility: { ...value.definition.eligibility, audienceType: "SELECTED_SALES_REPRESENTATIVES", audienceUserIds } } })).toBeNull();
  });
  it("parses only known lifecycle commands", () => {
    expect(parseOfferMutationRequest({ action: "SUBMIT", offerId: "OFFER", expectedRevision: 1 })).not.toBeNull();
    expect(parseOfferMutationRequest({ action: "APPROVED", offerId: "OFFER", expectedRevision: 1 })).toBeNull();
  });
});


describe("bounded Offer option and list request controls", () => {
  it("defaults examined size to 25, accepts 50 and rejects invalid sizes", () => {
    expect(parseOfferListRequest({})).toEqual({ pageSize: 25 });
    expect(parseOfferListRequest({ pageSize: "50" })).toEqual({ pageSize: 50 });
    for (const pageSize of [51, "51", 0, -1, 1.5, "1.5", " 25", "25 ", "01", "", null, [], {}, Infinity]) expect(parseOfferListRequest({ pageSize })).toBeNull();
  });
  it("accepts only a canonical encoded ordering tuple", () => {
    const cursor = { createdAt: "2030-01-01T00:00:00.000Z", documentId: "OFFER-A" };
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    expect(parseOfferListRequest({ continuation: encode(cursor) })).toEqual({ pageSize: 25, cursor });
    for (const value of [{ ...cursor, rootUid: "FORGED" }, { ...cursor, createdAt: "invalid" }, { ...cursor, documentId: "bad/id" }, {}, null]) expect(parseOfferListRequest({ continuation: encode(value) })).toBeNull();
    expect(parseOfferListRequest({ continuation: "%%%" })).toBeNull();
    expect(parseOfferListRequest({ unknown: true })).toBeNull();
  });
  it("rejects trusted roots, roles and prices in option requests", () => {
    expect(parseOfferRepresentativeRequest({ rootUid: "FORGED" })).toBeNull();
    expect(parseOfferRepresentativeRequest({ role: "Sales Representative" })).toBeNull();
    expect(parseOfferRepresentativeRequest({ offerId: "OFFER-A", pageSize: 100, continuationToken: "TOKEN-A" })).not.toBeNull();
    for (const pageSize of [0, 101, 1.5, "50"]) expect(parseOfferRepresentativeRequest({ pageSize })).toBeNull();
    expect(parseOfferProductRequest({ continuation: "PRODUCT-A" })).not.toBeNull();
    expect(parseOfferProductRequest({ price: 1 })).toBeNull();
    expect(parseOfferProductRequest({ continuation: "bad/id" })).toBeNull();
  });
});

it("allows only an existing Offer ID and cursor for Product candidates", async () => {
  const { parseOfferProductRequest } = await import("./offerAdministrationRequestContract");
  expect(parseOfferProductRequest({ offerId: "SYNTH-OFFER", continuation: "SYNTH-PRODUCT" })).toEqual({ offerId: "SYNTH-OFFER", continuation: "SYNTH-PRODUCT" });
  for (const key of ["createdBy", "updatedBy", "scopeRoot", "marketId", "productIds", "makerAudit"]) expect(parseOfferProductRequest({ offerId: "SYNTH-OFFER", [key]: "FORGED" })).toBeNull();
  for (const offerId of ["", " BAD", "BAD/ID", null, 1]) expect(parseOfferProductRequest({ offerId })).toBeNull();
});
