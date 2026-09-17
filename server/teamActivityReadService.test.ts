import { describe, expect, it, vi } from "vitest";
import type { OperationalScopeRepository } from "./operationalScopeRepository";
import { parseTeamActivityReadControls, resolveScopedTeamActivityRead, type TeamActivityReadRepository } from "./teamActivityReadService";
import { executeLeaveRequestMutation, parseLeaveRequestMutation, type LeaveMutationRepository } from "./leaveRequestMutationService";
import { resolveScopedProductAnalytics } from "./productAnalyticsReadService";
import { executeAttendanceRecovery, parseAttendanceRecoveryRequest } from "./attendanceRecoveryService";
import { LIBYA_MARKET_DEFAULT } from "../src/lib/marketSettings";

function scopeRepository(manager = true, withProduct = false): OperationalScopeRepository {
  const actor = { id: "SUP", role: manager ? "Medical Supervisor" : "Medical Representative", active: true, loginAllowed: true, status: "Active", securityScope: "Area", areaIds: ["A1"], country: "C1" };
  const rep = { id: "REP", role: "Medical Representative", active: true, loginAllowed: true, status: "Active", managerId: "SUP" };
  return {
    hierarchy: { async getUser(uid) { return uid === "SUP" ? actor : uid === "REP" ? rep : null; }, async getDirectReports(uid) { return manager && uid === "SUP" ? [rep] : []; }, async getAllUsers() { return manager ? [actor, rep] : [actor]; }, async getRolePermissions() { return null; } },
    async getGeographyCatalog() { return { countries: [{ id: "C1", active: true }], districts: [{ id: "D1", countryId: "C1", active: true }], cities: [{ id: "CT1", countryId: "C1", districtId: "D1", active: true }], areas: [{ id: "A1", countryId: "C1", districtId: "D1", cityId: "CT1", active: true }], nodes: [{ countryId: "C1", regionId: "D1", districtId: "D1", cityId: "CT1", areaId: "A1", active: true }] }; },
    async getTerritoryAssignments(subjects) { return subjects.map((userId, index) => ({ assignmentId: `TA${index}`, userId, status: "Active", active: true, countryId: "C1", regionId: "D1", districtId: "D1", cityId: "CT1", areaId: "A1" })); },
    async getProductAssignments(subjects) { return withProduct ? subjects.map((userId, index) => ({ assignmentId: `PA${index}`, userId, productId: "P1", status: "Active", active: true, effectiveFrom: "2026-01-01", effectiveTo: "2030-01-01", assignedAt: "2026-01-01", assignedBy: "TEST" })) : []; }, async getProducts() { return withProduct ? [{ id: "P1", name: "P1", brand: "P1", sku: "P1", therapeuticArea: "T", price: 1, stock: 1, isActive: true }] : []; },
  };
}

describe("WP77C scoped Team Activity and leave persistence", () => {
  it("bounds read dates", () => { expect(parseTeamActivityReadControls({ fromDate: "2026-08-01", toDate: "2026-08-16" })).not.toBeNull(); expect(parseTeamActivityReadControls({ fromDate: "2025-01-01", toDate: "2026-08-16" })).toBeNull(); });
  it("returns only subjects authorized by canonical operational scope", async () => {
    const readRepository: TeamActivityReadRepository = { queryAttendance: vi.fn(async () => [{ id: "A1", userId: "REP", marketId: "M", date: "2026-08-16", status: "OPEN" }, { id: "OUT", userId: "OTHER", marketId: "M", date: "2026-08-16", status: "OPEN" }]), queryLeave: vi.fn(async () => [{ id: "L1", userId: "REP", startDate: "2026-08-16", endDate: "2026-08-16", category: "ANNUAL", status: "APPROVED" }, { id: "OUT", userId: "OTHER", startDate: "2026-08-16", endDate: "2026-08-16", category: "ANNUAL", status: "APPROVED" }]) };
    const result = await resolveScopedTeamActivityRead("SUP", { fromDate: "2026-08-01", toDate: "2026-08-16" }, { operationalScopeRepository: scopeRepository(), readRepository });
    expect(result.subjectUids).toEqual(["REP", "SUP"]); expect(result.attendanceSessions.map(row => row.id)).toEqual(["A1"]); expect(result.leaveRequests.map(row => row.id)).toEqual(["L1"]);
  });
  it("rejects unknown leave categories and fields", () => { expect(parseLeaveRequestMutation({ action: "CREATE", userId: "REP", category: "HOLIDAY", startDate: "2026-08-01", endDate: "2026-08-01", reason: "" })).toBeNull(); expect(parseLeaveRequestMutation({ action: "APPROVE", requestId: "L1", extra: true })).toBeNull(); });
  it("self scope cannot approve and cannot create for another user", async () => {
    const repository: LeaveMutationRepository = { create: vi.fn(), decide: vi.fn() };
    expect(await executeLeaveRequestMutation("SUP", { action: "CREATE", userId: "REP", category: "ANNUAL", startDate: "2026-08-01", endDate: "2026-08-01", reason: "" }, { operationalScopeRepository: scopeRepository(false), repository })).toMatchObject({ success: false, code: "LEAVE_SUBJECT_DENIED" });
    expect(await executeLeaveRequestMutation("SUP", { action: "APPROVE", requestId: "L1" }, { operationalScopeRepository: scopeRepository(false), repository })).toMatchObject({ success: false, code: "LEAVE_APPROVAL_DENIED" });
  });
  it("manager decisions remain bounded to the resolved team", async () => {
    const decide = vi.fn(async (_id, subjects) => subjects.includes("REP")); const repository: LeaveMutationRepository = { create: vi.fn(), decide };
    expect(await executeLeaveRequestMutation("SUP", { action: "APPROVE", requestId: "L1" }, { operationalScopeRepository: scopeRepository(), repository, now: () => "2026-08-16T00:00:00Z" })).toMatchObject({ success: true });
    expect(decide.mock.calls[0][1]).toEqual(["REP", "SUP"]);
  });
  it("product analytics removes out-of-scope products and geography", async () => {
    const result = await resolveScopedProductAnalytics("SUP", { operationalScopeRepository: scopeRepository(true, true), repository: { async queryOrdersByAreaIds() { return [{ id: "O1", areaId: "A1", date: "2026-08-16", currencyCode: "LYD", status: "Delivered", items: [{ productId: "P1", name: "Allowed", quantity: 2, total: 10 }, { productId: "P2", name: "Denied", quantity: 1, total: 999 }] }, { id: "OUT", areaId: "A2", date: "2026-08-16", currencyCode: "LYD", items: [{ productId: "P1", quantity: 1, total: 10 }] }]; } } });
    expect(result.orders).toHaveLength(1); expect(result.orders[0].items.map(item => item.productId)).toEqual(["P1"]); expect(result.orders[0].total).toBe(10);
  });
  it("manual recovery is Admin-only and credits only through scheduled end", async () => {
    const recoverOpenSession = vi.fn(async () => true); const session: any = { id: "S", userId: "REP", marketId: LIBYA_MARKET_DEFAULT.marketId, countryId: LIBYA_MARKET_DEFAULT.countryId, date: "2026-08-16", timezone: LIBYA_MARKET_DEFAULT.timezone, scheduledStart: "2026-08-16T05:30:00Z", scheduledEnd: "2026-08-16T13:30:00Z", actualCheckIn: "2026-08-16T05:30:00Z", status: "OPEN", createdBy: "REP", createdAt: "x", updatedBy: "REP", updatedAt: "x" };
    const repository: any = { getActor: async () => ({ role: "Admin", active: true }), getMarket: async () => LIBYA_MARKET_DEFAULT, getActiveMarkets: async () => [LIBYA_MARKET_DEFAULT], getOpenSessions: async () => [session], recoverOpenSession };
    expect(parseAttendanceRecoveryRequest({ marketId: "M", throughDate: "2026-08-16", executedAt: "2026-08-16T18:00:00Z" })).not.toBeNull(); const result = await executeAttendanceRecovery("ADMIN", { marketId: LIBYA_MARKET_DEFAULT.marketId, throughDate: "2026-08-16", executedAt: "2026-08-16T18:00:00Z" }, repository); expect(result).toEqual({ success: true, processed: 1 }); expect(recoverOpenSession).toHaveBeenCalledWith("S", LIBYA_MARKET_DEFAULT, "2026-08-16T18:00:00Z");
    expect(await executeAttendanceRecovery("REP", { marketId: "M", throughDate: "2026-08-16", executedAt: "2026-08-16T18:00:00Z" }, { ...repository, getActor: async () => ({ role: "Medical Representative", active: true }) })).toMatchObject({ success: false, code: "ATTENDANCE_RECOVERY_DENIED" });
  });
});
