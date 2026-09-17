import type { User as FirebaseUser } from "firebase/auth";
import type { PharmacyVisit, PhysicianVisit } from "../types";
import { fetchScopedPharmacyVisits, type PharmacyVisitReadRequest, type ScopedPharmacyVisitReadResponse } from "./pharmacyVisitReadClient";
import { fetchScopedPhysicianVisits, type PhysicianVisitReadRequest, type ScopedPhysicianVisitReadResponse } from "./physicianVisitReadClient";
import type { DashboardPeriod } from "./dashboardOperationalPeriod";

const PAGE_SIZE = 100;

async function loadAllPages<T extends { id: string }>(
  load: (request: { fromDate: string; toDate: string; pageSize: number; cursor?: string }) => Promise<{ visits: T[]; nextCursor?: string }>,
  period: DashboardPeriod,
): Promise<T[]> {
  const byId = new Map<string, T>();
  let cursor: string | undefined;
  do {
    const page = await load({ fromDate: period.fromDate, toDate: period.toDate, pageSize: PAGE_SIZE, ...(cursor ? { cursor } : {}) });
    page.visits.forEach((visit) => byId.set(visit.id, visit));
    cursor = page.nextCursor;
  } while (cursor);
  return Array.from(byId.values()).sort((a, b) => String((b as any).visitDate || "").localeCompare(String((a as any).visitDate || "")) || a.id.localeCompare(b.id));
}

export function fetchDashboardPhysicianVisits(
  user: Pick<FirebaseUser, "getIdToken">,
  period: DashboardPeriod,
  loader: (user: Pick<FirebaseUser, "getIdToken">, request: PhysicianVisitReadRequest) => Promise<ScopedPhysicianVisitReadResponse> = fetchScopedPhysicianVisits,
): Promise<PhysicianVisit[]> {
  return loadAllPages((request) => loader(user, request), period);
}

export function fetchDashboardPharmacyVisits(
  user: Pick<FirebaseUser, "getIdToken">,
  period: DashboardPeriod,
  loader: (user: Pick<FirebaseUser, "getIdToken">, request: PharmacyVisitReadRequest) => Promise<ScopedPharmacyVisitReadResponse> = fetchScopedPharmacyVisits,
): Promise<PharmacyVisit[]> {
  return loadAllPages((request) => loader(user, request), period);
}
