import type { AttendanceSession } from "./attendanceEngine";
import { marketDateForInstant } from "./marketSettings";

const addDays = (date: string, amount: number): string => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
};

export interface AttendanceDateWindow { currentDate: string; monthStart: string; weekDates: string[] }

export function resolveAttendanceDateWindow(instant: string | Date, timezone: string): AttendanceDateWindow {
  const currentDate = marketDateForInstant(instant, timezone);
  const weekday = new Date(`${currentDate}T12:00:00Z`).getUTCDay();
  const weekStart = addDays(currentDate, -weekday);
  return { currentDate, monthStart: `${currentDate.slice(0, 7)}-01`, weekDates: Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)) };
}

export function findCurrentAttendanceSession(sessions: readonly AttendanceSession[], userId: string, marketId: string, currentDate: string): AttendanceSession | undefined {
  return sessions.find(session => session.userId === userId && session.marketId === marketId && session.date === currentDate);
}
