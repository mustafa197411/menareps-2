import type { MarketBusinessSettings, Weekday } from "./marketSettings";
import { resolveBusinessCalendarDay, type BusinessCalendarException } from "./marketSettings";
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export function workingDayNames(market: MarketBusinessSettings): string[] { return [...market.workingWeekdays].sort((a, b) => ((a - market.weekStartDay + 7) % 7) - ((b - market.weekStartDay + 7) % 7)).map(day => DAY_NAMES[day]); }
export function isoWeek(value: Date): string { const date = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())); const day = date.getUTCDay() || 7; date.setUTCDate(date.getUTCDate() + 4 - day); const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1)); const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7); return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`; }
export function rollingPlannerPeriods(now = new Date()): { weeks: string[]; months: string[] } { const weeks = Array.from({ length: 4 }, (_, index) => { const date = new Date(now); date.setUTCDate(date.getUTCDate() + index * 7); return isoWeek(date); }); const months = Array.from({ length: 3 }, (_, index) => `${new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + index, 1)).getUTCFullYear()}-${String(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + index, 1)).getUTCMonth() + 1).padStart(2, "0")}`); return { weeks: Array.from(new Set(weeks)), months }; }
export function weekdayNumber(day: string): Weekday | null { const index = DAY_NAMES.indexOf(day as typeof DAY_NAMES[number]); return index < 0 ? null : index as Weekday; }
export interface PlannerWorkingDay { name: string; weekday: Weekday; date: string; }
export function isoWeekDates(week: string): string[] {
  const match = /^(\d{4})-W(\d{2})$/.exec(week); if (!match) return [];
  const januaryFourth = new Date(Date.UTC(Number(match[1]), 0, 4));
  const monday = new Date(januaryFourth); monday.setUTCDate(januaryFourth.getUTCDate() - ((januaryFourth.getUTCDay() + 6) % 7) + (Number(match[2]) - 1) * 7);
  return Array.from({ length: 7 }, (_, index) => { const date = new Date(monday); date.setUTCDate(monday.getUTCDate() + index); return date.toISOString().slice(0, 10); });
}
export function plannerWorkingDays(week: string, market: MarketBusinessSettings, exceptions: BusinessCalendarException[] = [], regionId?: string): PlannerWorkingDay[] {
  return isoWeekDates(week).map(date => ({ date, weekday: new Date(`${date}T12:00:00Z`).getUTCDay() as Weekday })).filter(item => resolveBusinessCalendarDay(item.date, market, exceptions, regionId).scheduledWorkingDay).sort((a, b) => ((a.weekday - market.weekStartDay + 7) % 7) - ((b.weekday - market.weekStartDay + 7) % 7)).map(item => ({ ...item, name: DAY_NAMES[item.weekday] }));
}
export function plannerWeekRange(week: string, locale = "en"): string { const dates = isoWeekDates(week); if (!dates.length) return week; const format = (date: string) => new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)); return `${format(dates[0])} – ${format(dates[6])}`; }
