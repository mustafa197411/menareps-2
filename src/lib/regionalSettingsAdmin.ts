import type { Area, City, Country, District } from "../types";
import { validateBusinessDocumentCode, validateMarketSettings, type MarketBusinessSettings, type Weekday } from "./marketSettings";

export const WORKING_DAY_OPTIONS: ReadonlyArray<{ value: Weekday; label: string }> = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

export function unconfiguredMarketDraft(): MarketBusinessSettings {
  return {
    marketId: "",
    countryId: "",
    countryNameEn: "",
    countryNameAr: "",
    active: true,
    businessDocumentCode: "",
    currencyCode: "",
    currencySymbol: "",
    symbolPosition: "AFTER",
    decimalPlaces: 2,
    numeralLocale: "en",
    timezone: "",
    dateFormat: "YYYY-MM-DD",
    timeFormat: "24H",
    weekStartDay: 0,
    workingWeekdays: [],
    normalWorkdayStart: "",
    normalWorkdayEnd: "",
    checkInOpensAt: "",
    lateToleranceMinutes: 0,
    autoCheckoutAt: "",
    maximumWorkdayMinutes: 480,
  };
}

export function supportedIanaTimezones(): string[] {
  const supportedValuesOf = (Intl as unknown as { supportedValuesOf?: (key: "timeZone") => string[] }).supportedValuesOf;
  if (typeof supportedValuesOf !== "function") return [];
  const discovered: string[] = supportedValuesOf("timeZone");
  return Array.from(new Set<string>(discovered)).filter((zone: string) => {
    try { new Intl.DateTimeFormat("en", { timeZone: zone }).format(new Date()); return true; }
    catch { return false; }
  }).sort();
}

export function normalizeBusinessDocumentCode(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

export function marketSettingsForPersistence(settings: MarketBusinessSettings): MarketBusinessSettings {
  return {
    ...settings,
    businessDocumentCode: normalizeBusinessDocumentCode(settings.businessDocumentCode),
    workingWeekdays: [...settings.workingWeekdays],
  };
}

export function marketDraftForCountry(
  country: Country,
  settings: readonly MarketBusinessSettings[],
): MarketBusinessSettings {
  const saved = settings.find((item) => item.countryId === country.id);
  if (saved) {
    return { ...saved, workingWeekdays: [...saved.workingWeekdays] };
  }

  return { ...unconfiguredMarketDraft(), marketId: country.id, countryId: country.id, countryNameEn: country.name };
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function marketSettingsValidationMessages(settings: MarketBusinessSettings): string[] {
  const messages: string[] = [];
  if (!settings.countryNameEn.trim()) messages.push("English country name is required.");
  if (!settings.countryNameAr.trim()) messages.push("Arabic country name is required.");
  if (!validateBusinessDocumentCode(settings.businessDocumentCode)) messages.push("Business document code must contain 2 to 8 uppercase letters or numbers.");
  if (!/^[A-Z]{3}$/.test(settings.currencyCode)) messages.push("Currency code must contain exactly three uppercase letters.");
  if (!settings.currencySymbol.trim()) messages.push("Currency symbol is required.");
  if (!settings.timezone.trim()) messages.push("A valid IANA timezone is required.");
  else {
    try { new Intl.DateTimeFormat("en", { timeZone: settings.timezone }).format(new Date()); }
    catch { messages.push("A valid IANA timezone is required."); }
  }
  if (!TIME.test(settings.normalWorkdayStart)) messages.push("Standard workday start time is required.");
  if (!TIME.test(settings.normalWorkdayEnd)) messages.push("Standard workday end time is required.");
  if (!TIME.test(settings.checkInOpensAt)) messages.push("Check-in opening time is required.");
  if (!TIME.test(settings.autoCheckoutAt)) messages.push("Auto-checkout fallback time is required.");
  if (settings.workingWeekdays.length === 0) messages.push("Select at least one working day.");
  if (new Set(settings.workingWeekdays).size !== settings.workingWeekdays.length || settings.workingWeekdays.some((day) => day < 0 || day > 6)) {
    messages.push("Working days must be unique valid weekdays.");
  }
  if (validateMarketSettings(settings).includes("decimalPlaces")) messages.push("Decimal places must be a whole number from 0 to 6.");
  return Array.from(new Set(messages));
}

export function districtsForCountry(districts: readonly District[], countryId: string): District[] {
  if (!countryId) return [];
  return districts.filter((district) => district.countryId === countryId);
}

export function citiesForDistrict(cities: readonly City[], countryId: string, districtId: string): City[] {
  if (!countryId || !districtId) return [];
  return cities.filter((city) => city.countryId === countryId && city.districtId === districtId);
}

export function areasForCity(areas: readonly Area[], countryId: string, districtId: string, cityId: string): Area[] {
  if (!countryId || !districtId || !cityId) return [];
  return areas.filter((area) => area.countryId === countryId && area.districtId === districtId && area.cityId === cityId);
}
