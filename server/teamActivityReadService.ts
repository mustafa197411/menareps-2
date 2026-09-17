import { getFirebaseAdminServices } from "./firebaseAdmin";
import { createFirestoreOperationalScopeRepository, resolveOperationalScopeForActor, type OperationalScopeRepository } from "./operationalScopeRepository";

export interface TeamActivityReadControls { fromDate: string; toDate: string }
export interface AttendanceSessionRecord { id: string; userId: string; marketId: string; date: string; status: string; checkoutMode?: string; actualCheckIn?: string; actualCheckOut?: string; effectiveDurationMinutes?: number; checkInLocation?: unknown; checkOutLocation?: unknown; timezone?: string }
export interface LeaveRequestRecord { id: string; userId: string; startDate: string; endDate: string; category: string; status: string; reason?: string; createdAt?: string }
export interface TeamActivityReadResult { authorized: boolean; code?: string; subjectUids: string[]; attendanceSessions: AttendanceSessionRecord[]; leaveRequests: LeaveRequestRecord[] }
export interface TeamActivityReadRepository {
  queryAttendance(userIds: string[], fromDate: string, toDate: string): Promise<AttendanceSessionRecord[]>;
  queryLeave(userIds: string[], toDate: string): Promise<LeaveRequestRecord[]>;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ids = (values: unknown): string[] => Array.isArray(values) ? Array.from(new Set(values.filter((value): value is string => typeof value === "string" && value.trim() !== "").map(value => value.trim()))).sort() : [];

export function parseTeamActivityReadControls(body: unknown): TeamActivityReadControls | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some(key => !["fromDate", "toDate"].includes(key)) || typeof value.fromDate !== "string" || typeof value.toDate !== "string" || !DATE.test(value.fromDate) || !DATE.test(value.toDate) || value.fromDate > value.toDate) return null;
  const days = (Date.parse(`${value.toDate}T00:00:00Z`) - Date.parse(`${value.fromDate}T00:00:00Z`)) / 86_400_000;
  return days <= 366 ? { fromDate: value.fromDate, toDate: value.toDate } : null;
}

export function createFirestoreTeamActivityReadRepository(): TeamActivityReadRepository {
  return {
    async queryAttendance(userIds, fromDate, toDate) {
      if (userIds.length < 1 || userIds.length > 30) throw new Error("INVALID_ATTENDANCE_SUBJECT_CHUNK");
      const { db } = getFirebaseAdminServices();
      const snapshot = await db.collection("attendanceSessions").where("userId", "in", userIds).where("date", ">=", fromDate).where("date", "<=", toDate).get();
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AttendanceSessionRecord));
    },
    async queryLeave(userIds, toDate) {
      if (userIds.length < 1 || userIds.length > 30) throw new Error("INVALID_LEAVE_SUBJECT_CHUNK");
      const { db } = getFirebaseAdminServices();
      const snapshot = await db.collection("leaveRequests").where("userId", "in", userIds).where("startDate", "<=", toDate).get();
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as LeaveRequestRecord));
    },
  };
}

export async function resolveScopedTeamActivityRead(authenticatedActorUid: string, controls: TeamActivityReadControls, dependencies: { operationalScopeRepository?: OperationalScopeRepository; readRepository?: TeamActivityReadRepository } = {}): Promise<TeamActivityReadResult> {
  const scope = await resolveOperationalScopeForActor(authenticatedActorUid, {}, dependencies.operationalScopeRepository || createFirestoreOperationalScopeRepository());
  if (!scope.authorized || scope.queryPlan.denyAll || scope.queryPlan.subjectUidChunks.length === 0) return { authorized: false, code: scope.code || "OPERATIONAL_SCOPE_DENIED", subjectUids: [], attendanceSessions: [], leaveRequests: [] };
  const repository = dependencies.readRepository || createFirestoreTeamActivityReadRepository();
  const chunks = scope.queryPlan.subjectUidChunks;
  if (chunks.some(chunk => chunk.length < 1 || chunk.length > 30)) return { authorized: false, code: "INVALID_TEAM_ACTIVITY_QUERY_PLAN", subjectUids: [], attendanceSessions: [], leaveRequests: [] };
  const [attendance, leave] = await Promise.all([
    Promise.all(chunks.map(chunk => repository.queryAttendance(chunk, controls.fromDate, controls.toDate))).then(rows => rows.flat()),
    Promise.all(chunks.map(chunk => repository.queryLeave(chunk, controls.toDate))).then(rows => rows.flat()),
  ]);
  const allowed = new Set(ids(scope.subjectUids));
  const attendanceSessions = attendance.filter(row => allowed.has(row.userId) && DATE.test(row.date) && row.date >= controls.fromDate && row.date <= controls.toDate);
  const leaveRequests = leave.filter(row => allowed.has(row.userId) && DATE.test(row.startDate) && DATE.test(row.endDate) && row.startDate <= controls.toDate && row.endDate >= controls.fromDate);
  return { authorized: true, subjectUids: [...allowed].sort(), attendanceSessions, leaveRequests };
}
