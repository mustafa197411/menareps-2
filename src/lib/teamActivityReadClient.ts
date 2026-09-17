import type { User as FirebaseUser } from "firebase/auth";
import type { AttendanceSessionRecord, LeaveRequestRecord } from "../../server/teamActivityReadService";

export interface ScopedTeamActivityResponse { authorized: boolean; code?: string; subjectUids: string[]; attendanceSessions: AttendanceSessionRecord[]; leaveRequests: LeaveRequestRecord[] }

export async function fetchScopedTeamActivity(user: Pick<FirebaseUser, "getIdToken">, fromDate: string, toDate: string, fetchImplementation: typeof fetch = fetch): Promise<ScopedTeamActivityResponse> {
  const token = await user.getIdToken();
  const response = await fetchImplementation("/api/team-activity/scoped-query", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ fromDate, toDate }) });
  const payload = await response.json() as ScopedTeamActivityResponse;
  if (!response.ok || !payload || typeof payload.authorized !== "boolean" || !Array.isArray(payload.subjectUids) || !Array.isArray(payload.attendanceSessions) || !Array.isArray(payload.leaveRequests)) {
    const error = new Error("Unable to load scoped team activity") as Error & { code?: string };
    error.code = payload?.code || `HTTP_${response.status}`;
    throw error;
  }
  return payload;
}
