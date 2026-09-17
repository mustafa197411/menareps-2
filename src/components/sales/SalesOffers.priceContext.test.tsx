import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { formatCanonicalProductPrice } from "../../lib/operationalScopeClient";
const market: any = { marketId: "SYNTH-M", countryId: "SYNTH-C", countryNameEn: "Synthetic", countryNameAr: "بلد", active: true, currencyCode: "TST", currencySymbol: "T", symbolPosition: "AFTER", decimalPlaces: 2, numeralLocale: "en-US", timezone: "UTC", workingWeekdays: [1], normalWorkdayStart: "09:00", normalWorkdayEnd: "17:00", checkInOpensAt: "08:00", autoCheckoutAt: "18:00" };
describe("Offer controls canonical price presentation", () => {
  it("uses Product price independently of a conflicting catalog amount", () => {
    const product = { price: 12, unitPrice: 999 };
    expect(formatCanonicalProductPrice(product.price, { status: "RESOLVED", market })).toBe("12.00 T");
  });
  it("uses the same formatter for trigger and reward controls and transports Offer identity", () => {
    const source = readFileSync(new URL("./SalesOffers.tsx", import.meta.url), "utf8");
    expect(source.match(/formatCanonicalProductPrice\(product.price, marketContext\)/g)).toHaveLength(2);
    expect(source).toContain("loadProducts(undefined, offer.id)");
    expect(source).not.toContain("resolveOfferCommercialContext");
    expect(source).not.toContain("offerEligibilityEngine");
  });
});
