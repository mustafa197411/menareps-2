import { describe, expect, it } from "vitest";
import { formatCanonicalProductPrice } from "../lib/operationalScopeClient";
import { readFileSync } from "node:fs";
const market: any = { marketId: "SYNTH-M", countryId: "SYNTH-C", countryNameEn: "Synthetic", countryNameAr: "بلد", active: true, currencyCode: "TST", currencySymbol: "T", symbolPosition: "BEFORE", decimalPlaces: 2, numeralLocale: "en-US", timezone: "UTC", workingWeekdays: [1], normalWorkdayStart: "09:00", normalWorkdayEnd: "17:00", checkInOpensAt: "08:00", autoCheckoutAt: "18:00" };
describe("Product List canonical price presentation", () => {
  it.each([[12.5, "T12.50"], [0, "T0.00"]])("formats canonical price %s", (price, expected) => expect(formatCanonicalProductPrice(price, { status: "RESOLVED", market })).toBe(expected));
  it.each([-1, "1", null, undefined, NaN, Infinity])("does not coerce or replace invalid price %s", price => expect(formatCanonicalProductPrice(price, { status: "RESOLVED", market })).toBe("Product price invalid"));
  it("only reports missing context when context is actually unresolved", () => {
    expect(formatCanonicalProductPrice(1, { status: "UNRESOLVED" })).toBe("Market configuration required");
    expect(formatCanonicalProductPrice(1, { status: "RESOLVED", market: { ...market, currencyCode: "bad" } })).toBe("Market configuration required");
  });
  it("wires the Product List to authenticated session market context", () => {
    const source = readFileSync(new URL("./ProductList.tsx", import.meta.url), "utf8");
    expect(source).toContain("formatCanonicalProductPrice(amount, operationalScopeSession.scope?.marketContext)");
  });
});
