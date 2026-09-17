import type { PharmacyVisit, PhysicianVisit } from "../types";

export type DashboardPeriodFilter = "today" | "this-week" | "this-month";

export interface DashboardPeriod {
  filter: DashboardPeriodFilter;
  fromDate: string;
  toDate: string;
}

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

export function resolveDashboardPeriod(filter: DashboardPeriodFilter, now = new Date()): DashboardPeriod {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = new Date(today);
  if (filter === "this-week") {
    const mondayOffset = (today.getUTCDay() + 6) % 7;
    from.setUTCDate(today.getUTCDate() - mondayOffset);
  } else if (filter === "this-month") {
    from.setUTCDate(1);
  }
  return { filter, fromDate: isoDate(from), toDate: isoDate(today) };
}

const visitDate = (visit: { visitDate?: string; date?: string }): string => String(visit.visitDate || visit.date || "").slice(0, 10);
export const isCompletedVisit = (visit: unknown): boolean => {
  const status = visit !== null && typeof visit === "object" && "status" in visit ? visit.status : undefined;
  return String(status || "").trim().toUpperCase() === "COMPLETED";
};

export function filterVisitsForDashboardPeriod<T extends { visitDate?: string; date?: string }>(visits: T[], period: DashboardPeriod): T[] {
  return visits.filter((visit) => {
    const date = visitDate(visit);
    return date >= period.fromDate && date <= period.toDate;
  });
}

const isCurrentRecord = (record: Record<string, unknown>): boolean => {
  const status = String(record.status || "").trim().toUpperCase();
  return record.deleted !== true && record.isDeleted !== true && record.active !== false && record.isActive !== false
    && !["INACTIVE", "DELETED", "ARCHIVED"].includes(status);
};

export function calculatePhysicianCoverage(
  physicians: Array<Record<string, unknown>>,
  visits: PhysicianVisit[],
): { physiciansVisited: number; totalPhysicians: number; percentage: number } {
  const currentIds = new Set(physicians.filter(isCurrentRecord).map((physician) => String(physician.id || physician.physicianId || "").trim()).filter(Boolean));
  const visitedIds = new Set(visits.filter(isCompletedVisit).map((visit) => visit.physicianId).filter((id) => currentIds.has(id)));
  const totalPhysicians = currentIds.size;
  const physiciansVisited = visitedIds.size;
  return { physiciansVisited, totalPhysicians, percentage: totalPhysicians > 0 ? (physiciansVisited / totalPhysicians) * 100 : 0 };
}

export function completedPhysicianVisits(visits: PhysicianVisit[]): PhysicianVisit[] {
  return visits.filter(isCompletedVisit);
}

export function completedPharmacyVisits(visits: PharmacyVisit[]): PharmacyVisit[] {
  return visits.filter(isCompletedVisit);
}
