import { describe, expect, it } from "vitest";
import { LIBYA_MARKET_DEFAULT, JORDAN_MARKET_DEFAULT, resolveBusinessCalendarDay } from "./marketSettings";
import { areasForCity, citiesForDistrict, districtsForCountry, marketDraftForCountry, marketSettingsForPersistence, marketSettingsValidationMessages, normalizeBusinessDocumentCode, supportedIanaTimezones, unconfiguredMarketDraft, WORKING_DAY_OPTIONS } from "./regionalSettingsAdmin";
import { validateBusinessDocumentCode } from "./marketSettings";
import { readFileSync } from "node:fs";

const administrationSource = readFileSync(new URL("../components/Administration.tsx", import.meta.url), "utf8");

const countries: any[] = [
  { id: "C-LIB", name: "Libya", code: "LY" },
  { id: "C-EGY", name: "Egypt", code: "EG" },
  { id: "C-JOR", name: "Jordan", code: "JO" },
];

describe("WP77 regional settings administration", () => {
  it("starts with a country-neutral unconfigured draft", () => {
    expect(unconfiguredMarketDraft()).toMatchObject({ marketId: "", countryId: "", currencyCode: "", timezone: "", workingWeekdays: [] });
  });

  it("discovers only runtime-validated IANA timezones without a country fallback", () => {
    const zones = supportedIanaTimezones();
    for (const zone of zones) expect(() => new Intl.DateTimeFormat("en", { timeZone: zone })).not.toThrow();
  });

  it("loads an existing Libya configuration without changing its working days", () => {
    const draft = marketDraftForCountry(countries[0], [{ ...LIBYA_MARKET_DEFAULT, countryId: "C-LIB", marketId: "C-LIB" }]);
    expect(draft.workingWeekdays).toEqual([0, 1, 2, 3, 4]);
    expect(draft.timezone).toBe("Africa/Tripoli");
  });

  it("models save and hard-refresh reload without losing selected working days", () => {
    const saved = { ...LIBYA_MARKET_DEFAULT, countryId: "C-LIB", marketId: "C-LIB", workingWeekdays: [1, 2, 3, 4, 5] as any };
    expect(marketDraftForCountry(countries[0], [saved]).workingWeekdays).toEqual([1, 2, 3, 4, 5]);
  });

  it("supports all seven weekdays and preserves a valid selection", () => {
    expect(WORKING_DAY_OPTIONS.map((day) => day.value)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const saved = { ...LIBYA_MARKET_DEFAULT, countryId: "C-LIB", marketId: "C-LIB", workingWeekdays: [0, 6] as any };
    expect(marketDraftForCountry(countries[0], [saved]).workingWeekdays).toEqual([0, 6]);
  });

  it("creates an isolated blank Egypt draft that becomes persistable when completed", () => {
    const draft = marketDraftForCountry(countries[1], []);
    expect(draft).toMatchObject({ countryId: "C-EGY", countryNameEn: "Egypt", countryNameAr: "", workingWeekdays: [], timezone: "" });
    const complete = { ...draft, countryNameAr: "مصر", businessDocumentCode: "EG", currencyCode: "EGP", currencySymbol: "EGP", timezone: "Africa/Cairo", workingWeekdays: [0, 1, 2, 3, 4] as any, normalWorkdayStart: "08:00", normalWorkdayEnd: "16:00", checkInOpensAt: "07:30", autoCheckoutAt: "18:00" };
    expect(marketSettingsValidationMessages(complete)).toEqual([]);
    expect(marketDraftForCountry(countries[1], [complete])).toEqual(complete);
  });

  it("creates and reloads a completed Jordan configuration independently", () => {
    const initial = marketDraftForCountry(countries[2], []);
    const saved = { ...JORDAN_MARKET_DEFAULT, marketId: "C-JOR", countryId: "C-JOR", workingWeekdays: [0, 1, 2, 3, 4] as any };
    expect(initial.currencyCode).toBe("");
    expect(marketDraftForCountry(countries[2], [saved])).toEqual(saved);
  });

  it("does not leak values while switching countries", () => {
    const libya = { ...LIBYA_MARKET_DEFAULT, marketId: "C-LIB", countryId: "C-LIB" };
    const jordan = { ...JORDAN_MARKET_DEFAULT, marketId: "C-JOR", countryId: "C-JOR" };
    expect(marketDraftForCountry(countries[0], [libya, jordan]).currencyCode).toBe("LYD");
    expect(marketDraftForCountry(countries[2], [libya, jordan]).currencyCode).toBe("JOD");
    expect(marketDraftForCountry(countries[1], [libya, jordan]).currencyCode).toBe("");
  });

  it("keeps holidays scoped to their saved market and country", () => {
    const libya = { ...LIBYA_MARKET_DEFAULT, marketId: "C-LIB", countryId: "C-LIB" };
    const jordan = { ...JORDAN_MARKET_DEFAULT, marketId: "C-JOR", countryId: "C-JOR" };
    const exceptions: any[] = [{ id: "LY-H", marketId: "C-LIB", countryId: "C-LIB", date: "2026-09-01", nameEn: "Libya holiday", nameAr: "عطلة", type: "PUBLIC", active: true, createdBy: "A", createdAt: "x", updatedBy: "A", updatedAt: "x" }];
    expect(resolveBusinessCalendarDay("2026-09-01", libya, exceptions).reason).toBe("PUBLIC");
    expect(resolveBusinessCalendarDay("2026-09-01", jordan, exceptions).reason).not.toBe("PUBLIC");
  });

  it("reports explicit required-field validation messages", () => {
    const messages = marketSettingsValidationMessages(marketDraftForCountry(countries[1], []));
    expect(messages).toContain("Arabic country name is required.");
    expect(messages).toContain("Business document code must contain 2 to 8 uppercase letters or numbers.");
    expect(messages).toContain("Select at least one working day.");
    expect(messages).toContain("A valid IANA timezone is required.");
    expect(messages).toContain("Currency symbol is required.");
    expect(messages).toContain("Standard workday start time is required.");
  });
});

describe("WP79 business document code administration contract", () => {
  it("normalizes administrator input for canonical persistence", () => {
    expect(normalizeBusinessDocumentCode("  a7z  ")).toBe("A7Z");
  });

  it.each(["AB", "A7Z", "CODE2026"])("accepts valid canonical code %s", (code) => {
    expect(validateBusinessDocumentCode(code)).toBe(true);
  });

  it.each(["aB", "A-", "A", "ABCDEFGHI"])("rejects invalid canonical code %s", (code) => {
    expect(validateBusinessDocumentCode(code)).toBe(false);
  });

  it("persists and rehydrates a normalized code through the generic market draft", () => {
    const completed = marketSettingsForPersistence({
      ...LIBYA_MARKET_DEFAULT,
      marketId: "MARKET-SYNTHETIC",
      countryId: "COUNTRY-SYNTHETIC",
      countryNameEn: "Synthetic",
      businessDocumentCode: "  x9  ",
    });
    const rehydrated = marketDraftForCountry({ id: "COUNTRY-SYNTHETIC", name: "Synthetic" } as any, [completed]);
    expect(rehydrated.businessDocumentCode).toBe("X9");
  });

  it("does not erase an existing code when another market field changes", () => {
    const existing = { ...LIBYA_MARKET_DEFAULT, businessDocumentCode: "ZX", currencySymbol: "old" };
    const saved = marketSettingsForPersistence({ ...existing, currencySymbol: "new" });
    expect(saved.businessDocumentCode).toBe("ZX");
  });

  it("provides no country-specific or first-record default", () => {
    expect(unconfiguredMarketDraft().businessDocumentCode).toBe("");
    expect(marketDraftForCountry({ id: "COUNTRY-NEW", name: "New" } as any, []).businessDocumentCode).toBe("");
  });

  it("exposes the generic field and persists the normalized draft through the existing market save", () => {
    expect(administrationSource).toContain('aria-label="Business document code"');
    expect(administrationSource).toContain("marketSettingsForPersistence(marketDraft)");
    expect(administrationSource).not.toMatch(/businessDocumentCode\s*:\s*(?:countries|marketSettings)\s*\[0\]/);
  });
});

describe("WP77 canonical geography cascade", () => {
  const districts: any[] = [{ id: "D-LIB", countryId: "C-LIB" }, { id: "D-JOR", countryId: "C-JOR" }];
  const cities: any[] = [{ id: "CT-TRI", countryId: "C-LIB", districtId: "D-LIB" }, { id: "CT-AMM", countryId: "C-JOR", districtId: "D-JOR" }, { id: "CT-BAD", countryId: "C-LIB", districtId: "D-JOR" }];
  const areas: any[] = [{ id: "A-TRI", countryId: "C-LIB", districtId: "D-LIB", cityId: "CT-TRI" }, { id: "A-AMM", countryId: "C-JOR", districtId: "D-JOR", cityId: "CT-AMM" }, { id: "A-BAD", countryId: "C-LIB", districtId: "D-JOR", cityId: "CT-AMM" }];

  it("filters Country to District by canonical countryId", () => expect(districtsForCountry(districts, "C-JOR").map((item) => item.id)).toEqual(["D-JOR"]));
  it("filters District to City by canonical countryId and districtId", () => expect(citiesForDistrict(cities, "C-JOR", "D-JOR").map((item) => item.id)).toEqual(["CT-AMM"]));
  it("filters City to Area by the complete canonical parent path", () => expect(areasForCity(areas, "C-JOR", "D-JOR", "CT-AMM").map((item) => item.id)).toEqual(["A-AMM"]));
  it("does not show Libya children on the Jordan path", () => { expect(citiesForDistrict(cities, "C-JOR", "D-JOR")).not.toContainEqual(expect.objectContaining({ countryId: "C-LIB" })); expect(areasForCity(areas, "C-JOR", "D-JOR", "CT-AMM")).not.toContainEqual(expect.objectContaining({ countryId: "C-LIB" })); });
  it("does not show Jordan children on the Libya path", () => { expect(districtsForCountry(districts, "C-LIB").map((item) => item.id)).toEqual(["D-LIB"]); expect(citiesForDistrict(cities, "C-LIB", "D-LIB").map((item) => item.id)).toEqual(["CT-TRI"]); });
  it("fails closed until the complete parent selection exists", () => { expect(districtsForCountry(districts, "")).toEqual([]); expect(citiesForDistrict(cities, "C-JOR", "")).toEqual([]); expect(areasForCity(areas, "C-JOR", "D-JOR", "")).toEqual([]); });
});
