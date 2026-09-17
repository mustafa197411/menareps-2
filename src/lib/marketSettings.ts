export type CurrencySymbolPosition = "BEFORE" | "AFTER";
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type HolidayType = "PUBLIC" | "COMPANY" | "REGIONAL" | "EXCEPTIONAL_WORKING" | "EXCEPTIONAL_NON_WORKING";

export interface MarketBusinessSettings {
  marketId: string;
  countryId: string;
  countryNameEn: string;
  countryNameAr: string;
  active: boolean;
  /** Explicit prefix used for regulated business-document identifiers. */
  businessDocumentCode?: string;
  currencyCode: string;
  currencySymbol: string;
  symbolPosition: CurrencySymbolPosition;
  decimalPlaces: number;
  numeralLocale: string;
  timezone: string;
  dateFormat: "YYYY-MM-DD" | "DD/MM/YYYY" | "MM/DD/YYYY";
  timeFormat: "12H" | "24H";
  weekStartDay: Weekday;
  workingWeekdays: Weekday[];
  normalWorkdayStart: string;
  normalWorkdayEnd: string;
  checkInOpensAt: string;
  lateToleranceMinutes: number;
  autoCheckoutAt: string;
  maximumWorkdayMinutes: number;
  createdBy?: string;
  createdAt?: string;
  updatedBy?: string;
  updatedAt?: string;
}

export interface BusinessCalendarException {
  id: string;
  marketId: string;
  countryId: string;
  date: string;
  nameEn: string;
  nameAr: string;
  type: HolidayType;
  active: boolean;
  regionId?: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

export interface CalendarDayResolution {
  date: string;
  scheduledWorkingDay: boolean;
  reason: "WORKING_WEEKDAY" | "WEEKEND" | HolidayType;
  exception?: BusinessCalendarException;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const unique = <T,>(values: T[]): T[] => Array.from(new Set(values));

export function validateMarketSettings(settings: MarketBusinessSettings): string[] {
  const errors: string[] = [];
  if (!settings.marketId.trim()) errors.push("marketId");
  if (!settings.countryId.trim()) errors.push("countryId");
  if (!settings.countryNameEn.trim() || !settings.countryNameAr.trim()) errors.push("countryNames");
  if (!/^[A-Z]{3}$/.test(settings.currencyCode)) errors.push("currencyCode");
  if (!settings.currencySymbol.trim()) errors.push("currencySymbol");
  if (!Number.isInteger(settings.decimalPlaces) || settings.decimalPlaces < 0 || settings.decimalPlaces > 6) errors.push("decimalPlaces");
  if (!TIME.test(settings.normalWorkdayStart) || !TIME.test(settings.normalWorkdayEnd) || !TIME.test(settings.checkInOpensAt) || !TIME.test(settings.autoCheckoutAt)) errors.push("workdayTimes");
  if (settings.workingWeekdays.length === 0 || unique(settings.workingWeekdays).length !== settings.workingWeekdays.length || settings.workingWeekdays.some(day => day < 0 || day > 6)) errors.push("workingWeekdays");
  try { new Intl.DateTimeFormat("en", { timeZone: settings.timezone }).format(new Date()); } catch { errors.push("timezone"); }
  return unique(errors);
}

export function validateBusinessDocumentCode(value: unknown): boolean {
  return typeof value === "string" && /^[A-Z0-9]{2,8}$/.test(value.trim());
}

export function resolveMarket(markets: MarketBusinessSettings[], identity: { marketId?: string; countryId?: string }): MarketBusinessSettings | null {
  const active = markets.filter(market => market.active);
  const matches = identity.marketId
    ? active.filter(market => market.marketId === identity.marketId)
    : identity.countryId ? active.filter(market => market.countryId === identity.countryId) : [];
  return matches.length === 1 && validateMarketSettings(matches[0]).length === 0 ? matches[0] : null;
}

export function resolveMarketForIdentity(
  markets: readonly MarketBusinessSettings[],
  identity: { marketId?: string; countryId?: string; country?: string },
): MarketBusinessSettings | null {
  const active = markets.filter(market => market.active && validateMarketSettings(market).length === 0);
  const exactId = identity.marketId || identity.countryId;
  if (exactId) {
    const matches = active.filter(market => market.marketId === exactId || market.countryId === exactId);
    return matches.length === 1 ? matches[0] : null;
  }
  const country = identity.country?.trim().toLocaleLowerCase();
  if (!country) return null;
  const matches = active.filter(market => market.countryNameEn.toLocaleLowerCase() === country || market.countryNameAr === identity.country?.trim());
  return matches.length === 1 ? matches[0] : null;
}

export function formatMarketCurrency(amount: number, market: MarketBusinessSettings): string {
  if (!Number.isFinite(amount) || validateMarketSettings(market).length > 0) throw new Error("INVALID_MARKET_CURRENCY_FORMAT_REQUEST");
  const numeral = new Intl.NumberFormat(market.numeralLocale, {
    minimumFractionDigits: market.decimalPlaces,
    maximumFractionDigits: market.decimalPlaces,
    useGrouping: true,
  }).format(amount);
  return market.symbolPosition === "BEFORE" ? `${market.currencySymbol}${numeral}` : `${numeral} ${market.currencySymbol}`;
}

export function formatCurrencyForIdentity(amount: number, identity: { marketId?: string; countryId?: string; country?: string }, markets: readonly MarketBusinessSettings[] = []): string {
  const market = resolveMarketForIdentity(markets, identity);
  if (!market) throw new Error("MARKET_CURRENCY_CONFIGURATION_REQUIRED");
  return formatMarketCurrency(amount, market);
}

export function aggregateSingleCurrency(values: Array<{ amount: number; currencyCode: string }>): { amount: number; currencyCode: string } | null {
  if (values.length === 0) return null;
  const currencies = unique(values.map(value => value.currencyCode));
  if (currencies.length !== 1 || values.some(value => !Number.isFinite(value.amount))) throw new Error("MIXED_OR_INVALID_CURRENCY_AGGREGATION");
  return { amount: values.reduce((sum, value) => sum + value.amount, 0), currencyCode: currencies[0] };
}

export function formatMarketDateTime(instant: string | Date, market: MarketBusinessSettings, locale = market.numeralLocale): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (!Number.isFinite(date.getTime())) throw new Error("INVALID_DATE_TIME");
  const dateParts: Intl.DateTimeFormatOptions = market.dateFormat === "YYYY-MM-DD"
    ? { year: "numeric", month: "2-digit", day: "2-digit" }
    : market.dateFormat === "DD/MM/YYYY" ? { day: "2-digit", month: "2-digit", year: "numeric" } : { month: "2-digit", day: "2-digit", year: "numeric" };
  return new Intl.DateTimeFormat(locale, { ...dateParts, hour: "2-digit", minute: "2-digit", hour12: market.timeFormat === "12H", timeZone: market.timezone }).format(date);
}

export function marketDateForInstant(instant: string | Date, timezone: string): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (!Number.isFinite(date.getTime())) throw new Error("INVALID_MARKET_CLOCK");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function marketTimeForInstant(instant: string | Date, timezone: string): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (!Number.isFinite(date.getTime())) throw new Error("INVALID_MARKET_CLOCK");
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(date);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.hour}:${value.minute}`;
}

export function resolveBusinessCalendarDay(date: string, market: MarketBusinessSettings, exceptions: BusinessCalendarException[], regionId?: string): CalendarDayResolution {
  if (!DATE.test(date)) throw new Error("INVALID_BUSINESS_DATE");
  const candidates = exceptions.filter(item => item.active && item.marketId === market.marketId && item.countryId === market.countryId && item.date === date && (!item.regionId || item.regionId === regionId));
  const exceptionalWorking = candidates.find(item => item.type === "EXCEPTIONAL_WORKING");
  if (exceptionalWorking) return { date, scheduledWorkingDay: true, reason: exceptionalWorking.type, exception: exceptionalWorking };
  const nonWorking = candidates.find(item => item.type !== "EXCEPTIONAL_WORKING");
  if (nonWorking) return { date, scheduledWorkingDay: false, reason: nonWorking.type, exception: nonWorking };
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay() as Weekday;
  return market.workingWeekdays.includes(weekday)
    ? { date, scheduledWorkingDay: true, reason: "WORKING_WEEKDAY" }
    : { date, scheduledWorkingDay: false, reason: "WEEKEND" };
}

// Bootstrap/test templates only. Runtime resolvers deliberately default to an
// empty registry and must receive persisted marketSettings explicitly.
export const LIBYA_MARKET_DEFAULT: MarketBusinessSettings = {
  marketId: "C-LIB-1999", countryId: "C-LIB-1999", countryNameEn: "Libya", countryNameAr: "ليبيا", active: true,
  currencyCode: "LYD", currencySymbol: "LYD", symbolPosition: "AFTER", decimalPlaces: 3, numeralLocale: "en-LY",
  timezone: "Africa/Tripoli", dateFormat: "DD/MM/YYYY", timeFormat: "24H", weekStartDay: 0,
  workingWeekdays: [0, 1, 2, 3, 4], normalWorkdayStart: "07:30", normalWorkdayEnd: "15:30", checkInOpensAt: "07:00",
  lateToleranceMinutes: 15, autoCheckoutAt: "18:00", maximumWorkdayMinutes: 480,
};

export const JORDAN_MARKET_DEFAULT: MarketBusinessSettings = {
  ...LIBYA_MARKET_DEFAULT,
  marketId: "C-JOR-0396", countryId: "C-JOR-0396", countryNameEn: "Jordan", countryNameAr: "الأردن",
  currencyCode: "JOD", currencySymbol: "JOD", numeralLocale: "en-JO", timezone: "Asia/Amman",
};

export const CANONICAL_MARKET_DEFAULTS = [LIBYA_MARKET_DEFAULT, JORDAN_MARKET_DEFAULT] as const;
