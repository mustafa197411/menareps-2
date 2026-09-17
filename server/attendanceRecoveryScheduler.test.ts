import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { attendanceRecoveryThroughDate, executeScheduledAttendanceRecovery, type AttendanceRecoveryRepository } from "./attendanceRecoveryService";
import { verifyAttendanceSchedulerRequest } from "./attendanceSchedulerAuth";
import { LIBYA_MARKET_DEFAULT, type MarketBusinessSettings } from "../src/lib/marketSettings";
import type { AttendanceSession } from "../src/lib/attendanceEngine";

const market = (overrides: Partial<MarketBusinessSettings> = {}): MarketBusinessSettings => ({ ...LIBYA_MARKET_DEFAULT, marketId: "MARKET-X", countryId: "COUNTRY-X", countryNameEn: "Synthetic", countryNameAr: "اصطناعي", ...overrides });
const openSession = (id = "OPEN"): AttendanceSession => ({ id, userId: "REP", marketId: "MARKET-X", countryId: "COUNTRY-X", date: "2026-08-21", timezone: "Africa/Tripoli", scheduledStart: "2026-08-21T06:00:00Z", scheduledEnd: "2026-08-21T14:00:00Z", actualCheckIn: "2026-08-21T06:01:00Z", status: "OPEN", createdBy: "REP", createdAt: "x", updatedBy: "REP", updatedAt: "x" });

function repository() {
  let open = true;
  const recoverOpenSession = vi.fn(async () => { if (!open) return false; open = false; return true; });
  const value: AttendanceRecoveryRepository = { getActor: async () => null, getMarket: async () => market(), getActiveMarkets: async () => [market()], getOpenSessions: async (_marketId, throughDate) => throughDate >= "2026-08-21" && open ? [openSession()] : [], recoverOpenSession };
  return { value, recoverOpenSession };
}

describe("WP95 scheduler-ready attendance recovery", () => {
  it("uses the canonical market timezone and configured auto-checkout threshold", () => {
    expect(attendanceRecoveryThroughDate("2026-08-21T15:59:00Z", market())).toBe("2026-08-20");
    expect(attendanceRecoveryThroughDate("2026-08-21T16:00:00Z", market())).toBe("2026-08-21");
  });
  it("recovers an eligible open session and repeated invocation is idempotent", async () => { const repo = repository(); expect(await executeScheduledAttendanceRecovery("2026-08-21T16:00:00Z", repo.value)).toMatchObject({ success: true, processed: 1, markets: 1 }); expect(await executeScheduledAttendanceRecovery("2026-08-21T16:01:00Z", repo.value)).toMatchObject({ success: true, processed: 0, markets: 1 }); expect(repo.recoverOpenSession).toHaveBeenCalledTimes(1); });
  it("bounds recovery before today's threshold to earlier sessions", async () => { const repo = repository(); expect(await executeScheduledAttendanceRecovery("2026-08-21T15:59:00Z", repo.value)).toMatchObject({ success: true, processed: 0 }); expect(repo.recoverOpenSession).not.toHaveBeenCalled(); });
  it("allows at most one transition across concurrent/repeated recovery", async () => { const repo = repository(); const results = await Promise.all([executeScheduledAttendanceRecovery("2026-08-21T16:00:00Z", repo.value), executeScheduledAttendanceRecovery("2026-08-21T16:00:00Z", repo.value)]); expect(results.reduce((sum, result) => sum + result.processed, 0)).toBe(1); });
  it("accepts only the configured verified scheduler service identity", async () => {
    const verify = vi.fn(async () => ({ email: "attendance-job@example.iam.gserviceaccount.com", email_verified: true } as any));
    await expect(verifyAttendanceSchedulerRequest("Bearer signed-token", { audience: "https://service.example/internal", serviceAccountEmail: "attendance-job@example.iam.gserviceaccount.com" }, verify)).resolves.toMatchObject({ authorized: true });
    await expect(verifyAttendanceSchedulerRequest("Bearer signed-token", { audience: "https://service.example/internal", serviceAccountEmail: "different@example.iam.gserviceaccount.com" }, verify)).resolves.toMatchObject({ authorized: false, code: "ATTENDANCE_SCHEDULER_AUTH_DENIED" });
    await expect(verifyAttendanceSchedulerRequest("Bearer firebase-user-token", { audience: "https://service.example/internal", serviceAccountEmail: "attendance-job@example.iam.gserviceaccount.com" }, async () => ({ email: "representative@example.test", email_verified: true } as any))).resolves.toMatchObject({ authorized: false, code: "ATTENDANCE_SCHEDULER_AUTH_DENIED" });
    await expect(verifyAttendanceSchedulerRequest(undefined, { audience: "https://service.example/internal", serviceAccountEmail: "attendance-job@example.iam.gserviceaccount.com" }, verify)).resolves.toMatchObject({ authorized: false, code: "ATTENDANCE_SCHEDULER_AUTH_REQUIRED" });
  });
  it("exposes only a dedicated OIDC-governed scheduler route and retains representative denial", () => { const source = fs.readFileSync(new URL("../server.ts", import.meta.url), "utf8"); expect(source).toContain('app.post("/api/internal/attendance/recover", requireAttendanceSchedulerAuth'); expect(source).toContain('app.post("/api/attendance/process-open-sessions", requireFirebaseAuth'); expect(source).not.toContain("setInterval("); });
});
