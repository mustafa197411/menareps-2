import fs from "fs";
import { describe, expect, it } from "vitest";
import { resolveFinancialIdentity } from "./lib/financialIdentity";
import { formatCurrencyForIdentity, type MarketBusinessSettings } from "./lib/marketSettings";
import { filterCommercialRows } from "../server/commercialReadService";

const market: MarketBusinessSettings = { marketId: "MARKET-X", countryId: "COUNTRY-X", countryNameEn: "Synthetic", countryNameAr: "Synthetic", active: true, currencyCode: "TST", currencySymbol: "T", symbolPosition: "AFTER", decimalPlaces: 2, numeralLocale: "en", timezone: "UTC", dateFormat: "YYYY-MM-DD", timeFormat: "24H", weekStartDay: 1, workingWeekdays: [1, 2, 3, 4, 5], normalWorkdayStart: "08:00", normalWorkdayEnd: "16:00", checkInOpensAt: "07:30", lateToleranceMinutes: 15, autoCheckoutAt: "18:00", maximumWorkdayMinutes: 600 };

describe("PR-2 runtime source-of-truth", () => {
  it("resolves market and currency only from an explicitly supplied canonical registry", () => {
    expect(resolveFinancialIdentity([{ marketId: "MARKET-X", countryId: "COUNTRY-X", currencyCode: "TST" }])).toBeNull();
    expect(resolveFinancialIdentity([{ marketId: "MARKET-X", countryId: "COUNTRY-X", currencyCode: "TST" }], [market])).toMatchObject({ marketId: "MARKET-X", currencyCode: "TST" });
    expect(() => formatCurrencyForIdentity(10, { marketId: "MARKET-X" })).toThrow("MARKET_CURRENCY_CONFIGURATION_REQUIRED");
    expect(formatCurrencyForIdentity(10, { marketId: "MARKET-X" }, [market])).toContain("T");
  });

  it("commercial filtering fails closed without persisted markets", () => {
    const row = { id: "ORDER-X", areaId: "AREA-X", representativeUid: "REP-X", marketId: "MARKET-X", countryId: "COUNTRY-X", currencyCode: "TST" };
    const context = { actor: "REP-X", role: "Sales Representative", subjectMode: "SELF" as const, areaIds: ["AREA-X"], subjectUids: ["REP-X"], kind: "ORDERS" as const };
    expect(filterCommercialRows([row], context)).toEqual([]);
    expect(filterCommercialRows([row], context, [market])).toEqual([row]);
  });

  it("contains no production Finance or Operations mock records", () => {
    const finance = fs.readFileSync(new URL("./components/finance/FinanceManager.tsx", import.meta.url), "utf8");
    const operations = fs.readFileSync(new URL("./components/operations/OperationsHub.tsx", import.meta.url), "utf8");
    expect(finance).not.toMatch(/mockReceipts|mockCheques|customerCredit\s*=\s*useState/);
    expect(operations).not.toMatch(/TRK-WEST|CS-TCK|setFleet|setTickets/);
    expect(finance).toContain("finance-canonical-source-required");
    expect(operations).toContain("operations-canonical-source-required");
    const accounts = fs.readFileSync(new URL("./components/finance/CustomerAccountsPage.tsx", import.meta.url), "utf8");
    expect(accounts).toContain("customer-accounts-load-error");
    expect(accounts).toContain("setMarkets(Array.isArray(result.markets)");
  });

  it("keeps bundled market templates out of production runtime consumers", () => {
    const files = ["./lib/financialIdentity.ts", "../server/commercialReadService.ts", "./features/pharmacyVisit/utils/currency.ts"];
    for (const file of files) expect(fs.readFileSync(new URL(file, import.meta.url), "utf8")).not.toContain("CANONICAL_MARKET_DEFAULTS");
  });
});
