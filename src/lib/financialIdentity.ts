import { resolveMarketForIdentity, type MarketBusinessSettings } from "./marketSettings";

export interface FinancialIdentityInput { marketId?: unknown; countryId?: unknown; country?: unknown; currencyCode?: unknown; currency?: unknown }
export interface ResolvedFinancialIdentity { marketId: string; countryId: string; currencyCode: string; source: "EXPLICIT_MARKET" | "LEGACY_COUNTRY" | "LEGACY_CURRENCY" }
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";

export function resolveFinancialIdentity(
  sources: FinancialIdentityInput[],
  markets: readonly MarketBusinessSettings[] = [],
): ResolvedFinancialIdentity | null {
  for (const source of sources) {
    const marketId = text(source.marketId), countryId = text(source.countryId), country = text(source.country);
    const market = resolveMarketForIdentity(markets, { ...(marketId ? { marketId } : {}), ...(countryId ? { countryId } : {}), ...(country ? { country } : {}) });
    if (market) {
      const explicitCurrency = text(source.currencyCode || source.currency).toUpperCase();
      if (explicitCurrency && explicitCurrency !== market.currencyCode) return null;
      return { marketId: market.marketId, countryId: market.countryId, currencyCode: market.currencyCode, source: marketId || countryId ? "EXPLICIT_MARKET" : "LEGACY_COUNTRY" };
    }
  }
  const currencies = Array.from(new Set(sources.map(source => text(source.currencyCode || source.currency).toUpperCase()).filter(code => /^[A-Z]{3}$/.test(code))));
  if (currencies.length !== 1) return null;
  const matches = markets.filter(market => market.active && market.currencyCode === currencies[0]);
  return matches.length === 1 ? { marketId: matches[0].marketId, countryId: matches[0].countryId, currencyCode: matches[0].currencyCode, source: "LEGACY_CURRENCY" } : null;
}

export function requireFinancialIdentity(sources: FinancialIdentityInput[], markets?: readonly MarketBusinessSettings[]): ResolvedFinancialIdentity {
  const identity = resolveFinancialIdentity(sources, markets);
  if (!identity) throw new Error("FINANCIAL_MARKET_CURRENCY_REQUIRED");
  return identity;
}

export function assertSingleCurrency<T>(records: T[], currencyOf: (record: T) => string): string | null {
  const currencies = Array.from(new Set(records.map(currencyOf).filter(Boolean)));
  if (currencies.length > 1) throw new Error("MIXED_CURRENCY_AGGREGATION_DENIED");
  return currencies[0] || null;
}
