import { describe, expect, it } from "vitest";
import { JORDAN_MARKET_DEFAULT, LIBYA_MARKET_DEFAULT } from "./marketSettings";
import { assertSingleCurrency, resolveFinancialIdentity } from "./financialIdentity";
describe("WP77 legacy/new financial identity compatibility", () => {
  it("resolves new explicit market identity", () => expect(resolveFinancialIdentity([{ marketId: JORDAN_MARKET_DEFAULT.marketId, currencyCode: "JOD" }], [LIBYA_MARKET_DEFAULT, JORDAN_MARKET_DEFAULT])).toMatchObject({ currencyCode: "JOD", source: "EXPLICIT_MARKET" }));
  it("adapts a legacy explicit currency only with an explicit registry", () => { expect(resolveFinancialIdentity([{ currency: "LYD" }], [LIBYA_MARKET_DEFAULT, JORDAN_MARKET_DEFAULT])).toMatchObject({ marketId: LIBYA_MARKET_DEFAULT.marketId, source: "LEGACY_CURRENCY" }); expect(resolveFinancialIdentity([{ currency: "LYD" }])).toBeNull(); });
  it("rejects market/currency conflict", () => expect(resolveFinancialIdentity([{ country: "Jordan", currency: "LYD" }], [LIBYA_MARKET_DEFAULT, JORDAN_MARKET_DEFAULT])).toBeNull());
  it("refuses mixed totals", () => expect(() => assertSingleCurrency([{ c: "LYD" }, { c: "JOD" }], row => row.c)).toThrow("MIXED"));
});
