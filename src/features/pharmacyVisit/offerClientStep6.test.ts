import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLivePharmacyOffers } from "./services/offerService";
import { parseQuickAddInput } from "./services/quickAddParser";
vi.mock("../../lib/firebase", () => ({ auth: { currentUser: { getIdToken: async () => "test-token" } } }));
afterEach(() => vi.unstubAllGlobals());
const request = { pharmacyId: "PH", productIds: ["P"], paidLines: [], selectedOfferIds: [] };
const complete = { authorized: true, complete: true, offers: [], unavailableOfferIds: [], selectedCombinationAvailable: true };
describe("Step 6 client complete-result contract", () => {
  it.each([
    [503, { code: "OFFER_DISCOVERY_CAPACITY_EXCEEDED", complete: false }],
    [200, { ...complete, complete: false }], [200, { ...complete, complete: undefined }],
    [200, { ...complete, authorized: false }], [200, { ...complete, offers: [{ id: "MALFORMED" }] }],
    [200, { ...complete, unavailableOfferIds: [null] }], [200, { ...complete, selectedCombinationAvailable: undefined }],
  ])("rejects incomplete/invalid responses %s %j", async (status, payload) => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: status === 200, status, json: async () => payload })));
    await expect(fetchLivePharmacyOffers(request)).rejects.toThrow();
  });
  it("accepts a complete authorized empty result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => complete })));
    await expect(fetchLivePharmacyOffers(request)).resolves.toMatchObject({ offers: [] });
  });
  it.each([undefined, null, "5", false, -1, Infinity])("quick add never uses unitPrice fallback for price %s", price => {
    const product: any = { id: "P", name: "Medicine", code: "MED", price, unitPrice: 10 };
    const result = parseQuickAddInput("MED 2", [product], [product]);
    expect(result.parsedLines.flatMap(line => line.candidates || [])).toEqual([]);
  });
});

it("manual and candidate-confirmed order entry use matched Product.price exclusively", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync(new URL("./steps/Step2OrderItems.tsx", import.meta.url), "utf8");
  expect(source).toContain("const unitPrice = product.price;");
  expect(source).toContain("const unitPrice = matchedProduct.price;");
  expect(source).not.toContain("candidate?.unitPrice");
  expect(source).not.toContain("(product as any).unitPrice");
  expect(source).not.toContain("(p as any).unitPrice");
});
