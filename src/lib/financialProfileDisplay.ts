import { useEffect, useState } from "react";
import { auth } from "./firebase";
import { fetchScopedCommercialRead } from "./commercialReadClient";

/** Display-only consumption of the existing authorized derived-profile DTO. */
export function canonicalDisplayProfile(profiles: any[], pharmacy: any) {
  if (!Array.isArray(profiles) || !pharmacy) return null;
  const matches = profiles.filter(p => p?.pharmacyId === pharmacy.id);
  if (matches.length !== 1) return null;
  const p = matches[0];
  return p.projectionSource === "customerLedgerEntries" && p.projectionVersion === 1
    && p.marketId === pharmacy.marketId && p.currencyCode === (pharmacy.currencyCode || pharmacy.currency)
    && Number.isFinite(p.outstandingBalance) && p.outstandingBalance >= 0
    && Number.isFinite(p.totalCollected) && p.totalCollected >= 0
    && Number.isSafeInteger(p.openInvoiceCount) && p.openInvoiceCount >= 0 ? p : null;
}
export function profileDisplayTotals(data: any, marketId?: string, currencyCode?: string) {
  if (!data || !Array.isArray(data.pharmacies) || !Array.isArray(data.profiles) || !marketId || !currencyCode) return null;
  const pharmacies = data.pharmacies.filter((p: any) => p.marketId === marketId && (p.currencyCode || p.currency) === currencyCode);
  const profiles = pharmacies.map((p: any) => canonicalDisplayProfile(data.profiles, p));
  if (profiles.some((p: any) => !p)) return null;
  return { outstandingBalance: profiles.reduce((n: number, p: any) => n + p.outstandingBalance, 0),
    paymentsCollected: profiles.reduce((n: number, p: any) => n + p.totalCollected, 0) };
}
export function useFinancialProfileDisplay(actorUid: string, pharmacyId?: string, enabled = true) {
  const key = `${actorUid}:${pharmacyId || ""}`;
  const [state, setState] = useState<{ key: string; data: any } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setState(null);
    const user = auth.currentUser;
    if (!enabled || !user || user.uid !== actorUid) return;
    fetchScopedCommercialRead(user, { kind: "CUSTOMER_ACCOUNTS", ...(pharmacyId ? { pharmacyId } : {}) })
      .then(data => { if (!cancelled) setState({ key, data }); })
      .catch(() => { if (!cancelled) setState(null); });
    return () => { cancelled = true; };
  }, [key, actorUid, pharmacyId, enabled]);
  return enabled && state?.key === key ? state.data : null;
}
