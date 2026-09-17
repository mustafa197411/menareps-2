import { resolveBusinessCalendarDay, type BusinessCalendarException, type MarketBusinessSettings } from "./marketSettings";

export type CheckoutMode = "MANUAL" | "AUTO" | "ADMIN_CORRECTION";
export type AttendanceStatus = "OPEN" | "CHECKED_OUT" | "LATE" | "AUTO_CHECKED_OUT" | "CORRECTED";
export type DutyStatus = "NOT_CHECKED_IN" | "ON_DUTY" | "CHECKED_OUT" | "LATE" | "AUTO_CHECKED_OUT" | "LEAVE" | "HOLIDAY" | "NON_WORKING_DAY";
export type LeaveType = "ANNUAL" | "SICK" | "PERSONAL" | "UNPAID" | "WORK_FROM_HOME";

export interface AttendanceLocation { latitude: number; longitude: number; accuracyMeters?: number; label?: string }
export interface AttendanceSession {
  id: string; userId: string; marketId: string; countryId: string; date: string; timezone: string;
  scheduledStart: string; scheduledEnd: string; actualCheckIn: string; actualCheckOut?: string;
  status: AttendanceStatus; checkoutMode?: CheckoutMode; autoCheckoutReason?: string;
  checkInLocation?: AttendanceLocation; checkOutLocation?: AttendanceLocation; effectiveDurationMinutes?: number;
  createdBy: string; createdAt: string; updatedBy: string; updatedAt: string;
}
export interface ApprovedLeave { id: string; userId: string; marketId: string; startDate: string; endDate: string; type: LeaveType; status: "APPROVED" | "PENDING" | "REJECTED" }
export interface AttendanceSummary { scheduledWorkingDays: number; approvedLeaveDays: number; expectedAttendanceDays: number; workedDays: number; holidays: number; absences: number; lateCheckIns: number; manualCheckouts: number; autoCheckouts: number; totalFieldMinutes: number }

const ms = (value: string): number => { const parsed = Date.parse(value); if (!Number.isFinite(parsed)) throw new Error("INVALID_ATTENDANCE_TIMESTAMP"); return parsed; };
const minutes = (start: string, end: string): number => Math.max(0, Math.floor((ms(end) - ms(start)) / 60000));
const dateRange = (from: string, to: string): string[] => {
  const start = ms(`${from}T00:00:00Z`); const end = ms(`${to}T00:00:00Z`);
  if (start > end) throw new Error("INVALID_ATTENDANCE_DATE_RANGE");
  const result: string[] = []; for (let value = start; value <= end; value += 86400000) result.push(new Date(value).toISOString().slice(0, 10)); return result;
};

export function normalizeLeaveType(value: string): LeaveType | null {
  const normalized = value.trim().toUpperCase().replace(/[ -]+/g, "_");
  if (normalized === "EMERGENCY") return "PERSONAL";
  return ["ANNUAL", "SICK", "PERSONAL", "UNPAID", "WORK_FROM_HOME"].includes(normalized) ? normalized as LeaveType : null;
}

export function checkInAttendance(input: Omit<AttendanceSession, "status" | "actualCheckOut" | "checkoutMode" | "effectiveDurationMinutes">, lateToleranceMinutes: number): AttendanceSession {
  if (ms(input.actualCheckIn) < ms(input.scheduledStart) - 24 * 60 * 60000) throw new Error("INVALID_CHECK_IN");
  const late = ms(input.actualCheckIn) > ms(input.scheduledStart) + lateToleranceMinutes * 60000;
  return { ...input, status: late ? "LATE" : "OPEN" };
}

export function manualCheckout(session: AttendanceSession, actualCheckOut: string, location?: AttendanceLocation): AttendanceSession {
  if (session.actualCheckOut || session.checkoutMode) return session;
  if (ms(actualCheckOut) < ms(session.actualCheckIn)) throw new Error("CHECK_OUT_BEFORE_CHECK_IN");
  return { ...session, actualCheckOut, checkOutLocation: location, checkoutMode: "MANUAL", status: "CHECKED_OUT", effectiveDurationMinutes: minutes(session.actualCheckIn, actualCheckOut), updatedAt: actualCheckOut, updatedBy: session.userId };
}

export function autoCheckoutOpenSession(session: AttendanceSession, fallbackExecutionTime: string, maximumWorkdayMinutes: number): AttendanceSession {
  if (session.actualCheckOut || session.checkoutMode) return session;
  if (ms(fallbackExecutionTime) < ms(session.scheduledEnd)) return session;
  const maximumEnd = ms(session.actualCheckIn) + maximumWorkdayMinutes * 60000;
  const creditedEndMs = Math.min(ms(session.scheduledEnd), ms(fallbackExecutionTime), maximumEnd);
  const creditedEnd = new Date(Math.max(ms(session.actualCheckIn), creditedEndMs)).toISOString();
  return { ...session, actualCheckOut: creditedEnd, checkoutMode: "AUTO", status: "AUTO_CHECKED_OUT", autoCheckoutReason: "MISSED_MANUAL_CHECKOUT_CREDIT_CAPPED_AT_SCHEDULED_END", effectiveDurationMinutes: minutes(session.actualCheckIn, creditedEnd), updatedAt: fallbackExecutionTime, updatedBy: "AUTO_CHECKOUT" };
}

export function correctCheckout(session: AttendanceSession, actualCheckOut: string, adminUid: string, reason: string): AttendanceSession {
  if (!adminUid.trim() || !reason.trim() || ms(actualCheckOut) < ms(session.actualCheckIn)) throw new Error("INVALID_ADMIN_CORRECTION");
  return { ...session, actualCheckOut, checkoutMode: "ADMIN_CORRECTION", status: "CORRECTED", autoCheckoutReason: reason, effectiveDurationMinutes: minutes(session.actualCheckIn, actualCheckOut), updatedAt: new Date().toISOString(), updatedBy: adminUid };
}

export function deriveDutyStatus(date: string, market: MarketBusinessSettings, exceptions: BusinessCalendarException[], session?: AttendanceSession, approvedLeave?: ApprovedLeave): DutyStatus {
  const day = resolveBusinessCalendarDay(date, market, exceptions);
  if (!day.scheduledWorkingDay) return day.reason === "WEEKEND" || day.reason === "EXCEPTIONAL_NON_WORKING" ? "NON_WORKING_DAY" : "HOLIDAY";
  if (approvedLeave?.status === "APPROVED") return "LEAVE";
  if (!session) return "NOT_CHECKED_IN";
  if (session.checkoutMode === "AUTO") return "AUTO_CHECKED_OUT";
  if (session.actualCheckOut) return "CHECKED_OUT";
  return session.status === "LATE" ? "LATE" : "ON_DUTY";
}

export function calculateAttendanceSummary(input: { userId: string; fromDate: string; toDate: string; market: MarketBusinessSettings; exceptions: BusinessCalendarException[]; sessions: AttendanceSession[]; leaves: ApprovedLeave[] }): AttendanceSummary {
  const days = dateRange(input.fromDate, input.toDate);
  let scheduledWorkingDays = 0, approvedLeaveDays = 0, workedDays = 0, holidays = 0, lateCheckIns = 0, manualCheckouts = 0, autoCheckouts = 0, totalFieldMinutes = 0;
  for (const date of days) {
    const calendar = resolveBusinessCalendarDay(date, input.market, input.exceptions);
    if (!calendar.scheduledWorkingDay) { if (calendar.reason !== "WEEKEND") holidays++; continue; }
    scheduledWorkingDays++;
    const leave = input.leaves.find(item => item.userId === input.userId && item.marketId === input.market.marketId && item.status === "APPROVED" && item.startDate <= date && item.endDate >= date);
    if (leave) { approvedLeaveDays++; continue; }
    const session = input.sessions.find(item => item.userId === input.userId && item.marketId === input.market.marketId && item.date === date);
    if (!session) continue;
    workedDays++;
    if (session.status === "LATE") lateCheckIns++;
    if (session.checkoutMode === "MANUAL") manualCheckouts++;
    if (session.checkoutMode === "AUTO") autoCheckouts++;
    totalFieldMinutes += session.effectiveDurationMinutes || 0;
  }
  const expectedAttendanceDays = Math.max(0, scheduledWorkingDays - approvedLeaveDays);
  return { scheduledWorkingDays, approvedLeaveDays, expectedAttendanceDays, workedDays, holidays, absences: Math.max(0, expectedAttendanceDays - workedDays), lateCheckIns, manualCheckouts, autoCheckouts, totalFieldMinutes };
}
