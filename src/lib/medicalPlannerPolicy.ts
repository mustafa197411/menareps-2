import type { Physician } from "../types";

export type PlannerFilterKey = "cityId" | "areaId" | "specialtyId" | "classification" | "promotionGroupId";
export type PlannerFilterSelection = string[];
export interface PlannerFilters { cityId: PlannerFilterSelection; areaId: PlannerFilterSelection; specialtyId: PlannerFilterSelection; classification: PlannerFilterSelection; promotionGroupId: PlannerFilterSelection; search: string; }
export const ALL_PLANNER_FILTERS: PlannerFilters = { cityId: ["ALL"], areaId: ["ALL"], specialtyId: ["ALL"], classification: ["ALL"], promotionGroupId: ["ALL"], search: "" };
export interface PlannerPhysician extends Physician { canonicalCityId?: string; canonicalAreaId?: string; }
export interface PlannerFrequencyRecord { id: string; physicianId: string; repId: string; date: string; status?: string; kind: "PLANNED" | "COMPLETED"; completedVisitId?: string; }
export interface PlannerEligibility { eligible: boolean; targetFrequency: number | null; used: number; remaining: number | null; nextEligibleDate: string | null; code?: string; }
export interface PlannerCapacity { totalVisitsPerDay: number; totalVisitsPerWeek: number; samePhysicianPerDay: number; samePhysicianPerWeek: number; maxClassAVisitsPerDay: number; }
export const DEFAULT_PLANNER_CAPACITY: Readonly<PlannerCapacity> = Object.freeze({ totalVisitsPerDay: 8, totalVisitsPerWeek: 40, samePhysicianPerDay: 1, samePhysicianPerWeek: 2, maxClassAVisitsPerDay: 4 });
export interface PlannerCapacityVisit { physicianId: string; date: string; classification?: string; }
export interface PlannerDraftVisit extends PlannerCapacityVisit { id: string; }

const value = (input: unknown) => typeof input === "string" ? input.trim() : "";
const groups = (physician: Physician) => new Set([value(physician.primaryPromotionGroupId), ...(physician.targetPromotionGroupIds || []).map(value)].filter(Boolean));
const field = (physician: PlannerPhysician, key: PlannerFilterKey): string => key === "promotionGroupId" ? "" : key === "cityId" ? value(physician.canonicalCityId || physician.cityId) : key === "areaId" ? value(physician.canonicalAreaId || physician.areaId) : value(physician[key]);
const selectedValues = (selection: PlannerFilterSelection): string[] => selection.includes("ALL") ? [] : selection.map(value).filter(Boolean);
const matches = (physician: PlannerPhysician, filters: PlannerFilters, ignored?: PlannerFilterKey) => {
  for (const key of ["cityId", "areaId", "specialtyId", "classification", "promotionGroupId"] as PlannerFilterKey[]) {
    const selected = selectedValues(filters[key]);
    if (key === ignored || selected.length === 0) continue;
    if (key === "promotionGroupId" ? !selected.some(id => groups(physician).has(id)) : !selected.includes(field(physician, key))) return false;
  }
  return true;
};

export function filterPlannerPhysicians(authorized: PlannerPhysician[], filters: PlannerFilters): PlannerPhysician[] {
  const query = filters.search.trim().toLocaleLowerCase();
  return authorized.filter(physician => matches(physician, filters) && (!query || value(physician.name).toLocaleLowerCase().includes(query)));
}

export function togglePlannerFilter(selection: PlannerFilterSelection, option: string): PlannerFilterSelection {
  if (option === "ALL") return ["ALL"];
  const current = selectedValues(selection);
  return current.includes(option) ? (current.filter(id => id !== option).length ? current.filter(id => id !== option) : ["ALL"]) : [...current, option];
}

export function normalizePlannerFilters(filters: PlannerFilters, options: Record<PlannerFilterKey, string[]>): PlannerFilters {
  const next = { ...filters };
  for (const key of ["cityId", "areaId", "specialtyId", "classification", "promotionGroupId"] as PlannerFilterKey[]) {
    const retained = selectedValues(filters[key]).filter(id => options[key].includes(id));
    next[key] = retained.length ? retained : ["ALL"];
  }
  return next;
}

export function plannerCapacityCode(capacity: PlannerCapacity, visits: PlannerCapacityVisit[], candidate: PlannerCapacityVisit, weekDates: string[]): string | null {
  const day = visits.filter(visit => visit.date === candidate.date);
  const week = visits.filter(visit => weekDates.includes(visit.date));
  if (day.length >= capacity.totalVisitsPerDay) return "DAILY_CAPACITY_REACHED";
  if (week.length >= capacity.totalVisitsPerWeek) return "WEEKLY_CAPACITY_REACHED";
  if (day.filter(visit => visit.physicianId === candidate.physicianId).length >= capacity.samePhysicianPerDay) return "PHYSICIAN_DAILY_CAPACITY_REACHED";
  if (week.filter(visit => visit.physicianId === candidate.physicianId).length >= capacity.samePhysicianPerWeek) return "PHYSICIAN_WEEKLY_CAPACITY_REACHED";
  if (value(candidate.classification).toUpperCase() === "A" && day.filter(visit => value(visit.classification).toUpperCase() === "A").length >= capacity.maxClassAVisitsPerDay) return "CLASS_A_DAILY_CAPACITY_REACHED";
  return null;
}

export function addPlannerDraftVisit(visits: PlannerDraftVisit[], visit: PlannerDraftVisit, workingDates: string[]): PlannerDraftVisit[] {
  if (!workingDates.includes(visit.date)) throw new Error("PLANNER_NON_WORKING_DAY");
  return visits.some(item => item.id === visit.id || (item.physicianId === visit.physicianId && item.date === visit.date)) ? visits : [...visits, visit];
}
export function removePlannerDraftVisit(visits: PlannerDraftVisit[], id: string): PlannerDraftVisit[] { return visits.filter(visit => visit.id !== id); }
export function movePlannerDraftVisit(visits: PlannerDraftVisit[], id: string, date: string, workingDates: string[]): PlannerDraftVisit[] {
  if (!workingDates.includes(date)) throw new Error("PLANNER_NON_WORKING_DAY");
  return visits.map(visit => visit.id === id ? { ...visit, date } : visit);
}
export function plannerLastVisitPresentation(dates: string[], now = new Date()): { exact: string | null; elapsedDays: number | null } {
  const latest = dates.filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort().at(-1) || null;
  return latest ? { exact: latest, elapsedDays: Math.max(0, Math.floor((now.getTime() - Date.parse(`${latest}T12:00:00Z`)) / 86400000)) } : { exact: null, elapsedDays: null };
}

export function plannerCascadeOptions(authorized: PlannerPhysician[], filters: PlannerFilters): Record<PlannerFilterKey, string[]> {
  const result = {} as Record<PlannerFilterKey, string[]>;
  for (const key of ["cityId", "areaId", "specialtyId", "classification", "promotionGroupId"] as PlannerFilterKey[]) {
    const candidates = authorized.filter(physician => matches(physician, filters, key));
    const options = key === "promotionGroupId" ? candidates.flatMap(physician => [...groups(physician)]) : candidates.map(physician => field(physician, key));
    result[key] = [...new Set(options.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }
  return result;
}

export const TARGET_FREQUENCY_POLICY: Readonly<Record<number, { maximum: number; minimumGapDays: number }>> = Object.freeze({
  1: { maximum: 1, minimumGapDays: 25 }, 2: { maximum: 2, minimumGapDays: 10 },
  3: { maximum: 3, minimumGapDays: 8 }, 4: { maximum: 4, minimumGapDays: 5 },
});
const dateMs = (date: string) => Date.parse(`${date}T12:00:00Z`);
const addDays = (date: string, days: number) => new Date(dateMs(date) + days * 86400000).toISOString().slice(0, 10);
const activeReservation = (record: PlannerFrequencyRecord) => !["CANCELLED", "REMOVED"].includes(value(record.status).toUpperCase());

export function qualifyingPlannerRecords(records: PlannerFrequencyRecord[]): PlannerFrequencyRecord[] {
  const completed = records.filter(record => record.kind === "COMPLETED" && value(record.status).toUpperCase() === "COMPLETED");
  const completedIds = new Set(completed.map(record => record.id));
  const completedKeys = new Set(completed.map(record => `${record.repId}:${record.physicianId}:${record.date}`));
  const planned = records.filter(record => record.kind === "PLANNED" && activeReservation(record)
    && !record.completedVisitId && !completedIds.has(value(record.completedVisitId))
    && !completedKeys.has(`${record.repId}:${record.physicianId}:${record.date}`));
  return [...completed, ...planned];
}

export function evaluatePlannerEligibility(targetFrequency: unknown, selectedDate: string, records: PlannerFrequencyRecord[]): PlannerEligibility {
  const frequency = Number(targetFrequency);
  const policy = TARGET_FREQUENCY_POLICY[frequency];
  if (!policy || !/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) return { eligible: false, targetFrequency: policy ? frequency : null, used: 0, remaining: null, nextEligibleDate: null, code: policy ? "PLAN_DATE_REQUIRED" : "TARGET_FREQUENCY_REQUIRED" };
  const selectedMs = dateMs(selectedDate);
  const relevant = qualifyingPlannerRecords(records).filter(record => record.date <= selectedDate && selectedMs - dateMs(record.date) < 30 * 86400000 && selectedMs - dateMs(record.date) >= 0).sort((a, b) => a.date.localeCompare(b.date));
  const used = relevant.length;
  const last = relevant.at(-1)?.date || null;
  const nextEligibleDate = last ? addDays(last, policy.minimumGapDays) : null;
  const eligible = used < policy.maximum && (!nextEligibleDate || selectedDate >= nextEligibleDate);
  return { eligible, targetFrequency: frequency, used, remaining: Math.max(0, policy.maximum - used), nextEligibleDate, ...(!eligible ? { code: used >= policy.maximum ? "TARGET_REACHED" : "MINIMUM_SPACING_REQUIRED" } : {}) };
}
