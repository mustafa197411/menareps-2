import { describe, expect, it } from "vitest";
import { aggregateSingleCurrency, formatMarketCurrency, LIBYA_MARKET_DEFAULT, resolveBusinessCalendarDay, resolveMarket, resolveMarketForIdentity, validateMarketSettings, type BusinessCalendarException, type MarketBusinessSettings } from "./marketSettings";

const jordan: MarketBusinessSettings = { ...LIBYA_MARKET_DEFAULT, marketId: "C-JOR-0396", countryId: "C-JOR-0396", countryNameEn: "Jordan", countryNameAr: "الأردن", currencyCode: "JOD", currencySymbol: "JOD", numeralLocale: "en-JO", timezone: "Asia/Amman", workingWeekdays: [0, 1, 2, 3, 4] };
const exception = (type: BusinessCalendarException["type"], date = "2026-08-16"): BusinessCalendarException => ({ id: `${type}:${date}`, marketId: LIBYA_MARKET_DEFAULT.marketId, countryId: LIBYA_MARKET_DEFAULT.countryId, date, nameEn: type, nameAr: type, type, active: true, createdBy: "A", createdAt: "2026-01-01T00:00:00Z", updatedBy: "A", updatedAt: "2026-01-01T00:00:00Z" });

describe("WP77B market and business calendar registry", () => {
  it("validates the Libya seed without making it a global fallback", () => { expect(validateMarketSettings(LIBYA_MARKET_DEFAULT)).toEqual([]); expect(resolveMarket([LIBYA_MARKET_DEFAULT], {})).toBeNull(); });
  it("resolves an explicit second market", () => expect(resolveMarket([LIBYA_MARKET_DEFAULT, jordan], { countryId: jordan.countryId })?.currencyCode).toBe("JOD"));
  it("resolves an exact legacy country name but never invents a default", () => { expect(resolveMarketForIdentity([LIBYA_MARKET_DEFAULT, jordan], { country: "Libya" })?.marketId).toBe("C-LIB-1999"); expect(resolveMarketForIdentity([LIBYA_MARKET_DEFAULT, jordan], {})).toBeNull(); });
  it("formats using market symbol policy", () => expect(formatMarketCurrency(1234.5, LIBYA_MARKET_DEFAULT)).toContain("LYD"));
  it("fails closed for mixed-currency totals", () => expect(() => aggregateSingleCurrency([{ amount: 1, currencyCode: "LYD" }, { amount: 1, currencyCode: "JOD" }])).toThrow("MIXED"));
  it("classifies configured working and weekend days", () => { expect(resolveBusinessCalendarDay("2026-08-16", LIBYA_MARKET_DEFAULT, []).scheduledWorkingDay).toBe(true); expect(resolveBusinessCalendarDay("2026-08-14", LIBYA_MARKET_DEFAULT, []).reason).toBe("WEEKEND"); });
  it("honors holidays and exceptional working days", () => { expect(resolveBusinessCalendarDay("2026-08-16", LIBYA_MARKET_DEFAULT, [exception("PUBLIC")]).scheduledWorkingDay).toBe(false); expect(resolveBusinessCalendarDay("2026-08-14", LIBYA_MARKET_DEFAULT, [exception("EXCEPTIONAL_WORKING", "2026-08-14")]).scheduledWorkingDay).toBe(true); });
});
