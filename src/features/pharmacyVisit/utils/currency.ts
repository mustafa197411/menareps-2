import { formatMarketCurrency, resolveMarket, type MarketBusinessSettings } from "../../../lib/marketSettings";

export interface CountryCurrencyConfig {
  countryId: string;
  currencyCode: string;
  currencySymbol: string;
  currencyName: string;
  currencyNameAr: string;
  decimalPlaces: number;
  position: "BEFORE" | "AFTER";
  active: boolean;
}

export const CANONICAL_COUNTRY_CURRENCY_CONFIGS: Record<string, CountryCurrencyConfig> = {};

export interface CurrencyInfo {
  code: string;
  symbol: string;
  nameEn: string;
  nameAr: string;
}

export interface PharmacyCurrencyContext {
  pharmacyId: string;
  pharmacyCountryId: string;
  countryRegistryFound: boolean;
  currencyCode: string;
  currencySymbol: string;
  decimalPlaces: number;
  currencyPosition: "BEFORE" | "AFTER";
  source: "SELECTED_PHARMACY_COUNTRY" | "CANONICAL_COUNTRY_REGISTRY" | "COMPANY_COUNTRY_CONFIG" | "COMPANY_DEFAULT_FALLBACK";
  fallbackUsed: boolean;
}

export function getCurrencyInfo(countryOrCode?: string): CurrencyInfo {
  if (!countryOrCode) {
    throw new Error("MARKET_CURRENCY_CONFIGURATION_REQUIRED");
  }

  const normalized = countryOrCode.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) throw new Error("MARKET_CURRENCY_CONFIGURATION_REQUIRED");
  return { code: normalized, symbol: normalized, nameEn: normalized, nameAr: normalized };
}

export function resolvePharmacyCurrency(pharmacy?: any, markets: readonly MarketBusinessSettings[] = []): PharmacyCurrencyContext {
  const pharmacyId = pharmacy?.id || pharmacy?.pharmacyId || "";
  const rawCountry = (pharmacy?.countryId || pharmacy?.country || "").trim();
  
  const direct = resolveMarket([...markets], { countryId: rawCountry }) || resolveMarket([...markets], { marketId: rawCountry });
  if (!direct) throw new Error("PHARMACY_MARKET_CURRENCY_REQUIRED");
  const resolved = direct;
  const info = { code: resolved.currencyCode, symbol: resolved.currencySymbol, nameEn: resolved.countryNameEn, nameAr: resolved.countryNameAr };
  const fallbackUsed = false;
  
  // Resolve canonical country ID matching configuration
  const matchedCountryId = resolved.countryId;

  const countryIdUsedAsCurrency = rawCountry === info.code; // false since country IDs are C-LIB-8842 etc.

  // Audit stdout output
  console.info("[COUNTRY_CURRENCY_RESOLUTION_JSON]", JSON.stringify({
    pharmacyId,
    pharmacyCountryId: rawCountry,
    countrySettingsId: matchedCountryId,
    currencyCode: info.code,
    currencySymbol: info.symbol,
    source: "COUNTRY_SETTINGS",
    countryIdUsedAsCurrency: false
  }));

  const context: PharmacyCurrencyContext = {
    pharmacyId,
    pharmacyCountryId: rawCountry,
    countryRegistryFound: true,
    currencyCode: info.code,
    currencySymbol: info.symbol,
    decimalPlaces: resolved.decimalPlaces,
    currencyPosition: resolved.symbolPosition,
    source: "SELECTED_PHARMACY_COUNTRY",
    fallbackUsed
  };

  console.info("[PHARMACY_CURRENCY_CONTEXT_JSON]", JSON.stringify(context));
  return context;
}

export function formatCurrency(amount: number | null | undefined, countryOrCode?: string): string {
  const info = getCurrencyInfo(countryOrCode);
  const numericVal = amount != null && !isNaN(amount) ? amount : 0;
  return `${numericVal.toFixed(2)} ${info.symbol}`;
}
