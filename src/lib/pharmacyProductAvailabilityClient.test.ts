import { describe, expect, it, vi } from "vitest";
import { readPharmacyProductAvailability } from "./pharmacyProductAvailabilityClient";

const token = { getIdToken: vi.fn(async () => "TOKEN") };
describe("pharmacy availability client", () => {
  it("maps an HTTP failure to unavailable error, never zero", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ code: "DENIED" }), { status: 403 })) as any;
    await expect(readPharmacyProductAvailability("PH", ["P1"], fetcher, token)).resolves.toEqual([{ productId: "P1", availabilityState: "UNAVAILABLE_ERROR", canOrder: false, shortageEligible: false, showNumericStock: false, code: "DENIED" }]);
  });
  it("maps a malformed response and a missing product row to unavailable errors", async () => {
    const malformed = vi.fn(async () => new Response("not json", { status: 200 })) as any;
    expect((await readPharmacyProductAvailability("PH", ["P1"], malformed, token))[0].shortageEligible).toBe(false);
    const missing = vi.fn(async () => new Response(JSON.stringify({ authorized: true, availability: [] }), { status: 200 })) as any;
    expect((await readPharmacyProductAvailability("PH", ["P1"], missing, token))[0].code).toBe("AVAILABILITY_RESPONSE_PRODUCT_MISSING");
  });
  it("returns unresolved context for a missing pharmacy input", async () => {
    expect((await readPharmacyProductAvailability("", ["P1"], vi.fn() as any, token))[0]).toMatchObject({ availabilityState: "UNRESOLVED_CONTEXT", shortageEligible: false });
  });
});
