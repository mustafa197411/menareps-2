import { describe, expect, it, vi } from "vitest";
import {
  evaluateDeliveryOfficerEligibility,
  executeDeliveryAssign,
  parseDeliveryAssignRequest,
  resolveEligibleDeliveryOfficers,
} from "./deliveryAssignmentService";
import type {
  DeliveryAssignmentRepository,
  DeliveryAssignmentTransactionContext,
  DeliveryAssignmentUserRecord,
} from "./deliveryAssignmentRepository";

const STORE_UID = "synthetic-store-manager";
const OFFICER_UID = "synthetic-delivery-officer-a";
const STALE_UID = "synthetic-delivery-officer-stale";

const actor: DeliveryAssignmentUserRecord = {
  id: STORE_UID, uid: STORE_UID, name: "Store", email: "store@esnad.local", role: "Store Manager",
  active: true, loginAllowed: true, isDeleted: false, status: "Active", employmentStatus: "Active",
  companyId: "COMPANY-A", countryId: "COUNTRY-A", districtId: "DISTRICT-A", cityId: "CITY-A", areaId: "AREA-A",
};
const officer: DeliveryAssignmentUserRecord = {
  id: OFFICER_UID, uid: OFFICER_UID, name: "delivery", email: "do@esnad.local", role: "Delivery Officer",
  active: true, loginAllowed: true, isDeleted: false, status: "Active", employmentStatus: "Active",
  managerId: STORE_UID, managerEmail: "store@esnad.local",
  companyId: "COMPANY-A", countryId: "COUNTRY-A", districtId: "DISTRICT-A", cityId: "CITY-A", areaId: "AREA-A",
};
const order = {
  id: "O1", status: "READY_FOR_DISPATCH", stage: "DISPATCH", createdByUid: "REP1",
  history: [{ transitionId: "OLD", action: "STORE_MARK_READY" }],
};

function repository(options: {
  actor?: DeliveryAssignmentUserRecord | null;
  candidates?: DeliveryAssignmentUserRecord[];
  officer?: DeliveryAssignmentUserRecord | null;
  order?: Record<string, any> | null;
  authEnabled?: boolean;
} = {}) {
  const writes: Array<{ patch: Record<string, any>; audit: Record<string, any> }> = [];
  const selectedActor = options.actor === undefined ? actor : options.actor;
  const candidates = options.candidates === undefined ? [officer] : options.candidates;
  const selectedOfficer = options.officer === undefined ? officer : options.officer;
  const selectedOrder = options.order === undefined ? order : options.order;
  const repo: DeliveryAssignmentRepository = {
    getActor: vi.fn(async () => selectedActor),
    listDeliveryOfficerCandidates: vi.fn(async () => candidates),
    getUsersByIds: vi.fn(async (uids) => [actor, ...candidates].filter((user) => uids.includes(user.id))),
    isAuthIdentityEnabled: vi.fn(async (uid) => options.authEnabled !== false && uid !== STALE_UID),
    runAssignmentTransaction: vi.fn(async (_actorUid, _orderId, _officerUid, operation) => operation({
      actor: selectedActor,
      officer: selectedOfficer,
      order: selectedOrder ? { id: "O1", data: { ...selectedOrder } } : null,
      write: (patch, audit) => writes.push({ patch, audit }),
    } as DeliveryAssignmentTransactionContext)),
  };
  return { repo, writes };
}

const request = { orderId: "O1", deliveryOfficerUid: OFFICER_UID, plannedDeliveryDate: "2026-08-14", plannedDeliveryWindow: "10:00 - 14:00" };
const deps = (repo: DeliveryAssignmentRepository) => ({ repository: repo, now: () => "2026-08-13T12:00:00.000Z", auditId: () => "AUD1" });

describe("WP76C server-authoritative Delivery Officer directory", () => {
  it("1. valid live-style officer is eligible", () => expect(evaluateDeliveryOfficerEligibility(actor, officer, [actor, officer], true).dto?.uid).toBe(OFFICER_UID));
  it("2. stale UID is excluded when Auth identity is missing", async () => {
    const stale = { ...officer, id: STALE_UID, uid: STALE_UID };
    const { repo } = repository({ candidates: [stale] });
    expect((await resolveEligibleDeliveryOfficers(STORE_UID, deps(repo))).officers).toEqual([]);
  });
  it("3. inactive officer is excluded", () => expect(evaluateDeliveryOfficerEligibility(actor, { ...officer, active: false }, [actor, officer], true).code).toBe("OFFICER_INACTIVE"));
  it("4. login-disabled officer is excluded", () => expect(evaluateDeliveryOfficerEligibility(actor, { ...officer, loginAllowed: false }, [actor, officer], true).code).toBe("OFFICER_LOGIN_DISABLED"));
  it("5. deleted officer is excluded", () => expect(evaluateDeliveryOfficerEligibility(actor, { ...officer, isDeleted: true }, [actor, officer], true).code).toBe("OFFICER_DELETED"));
  it("6. wrong role is excluded", () => expect(evaluateDeliveryOfficerEligibility(actor, { ...officer, role: "Sales Representative" }, [actor, officer], true).code).toBe("OFFICER_ROLE_INVALID"));
  it("7. wrong Store Manager relationship is excluded", () => expect(evaluateDeliveryOfficerEligibility(actor, { ...officer, managerId: "OTHER" }, [actor, officer], true).code).toBe("OFFICER_MANAGER_MISMATCH"));
  it("8. incompatible canonical geography is excluded", () => expect(evaluateDeliveryOfficerEligibility(actor, { ...officer, areaId: "AREA-B" }, [actor, officer], true).code).toBe("OFFICER_SCOPE_MISMATCH"));
  it("8a. missing canonical geography is excluded without crashing", () => expect(evaluateDeliveryOfficerEligibility(actor, { ...officer, countryId: "", districtId: "", cityId: "", areaId: "" }, [actor, officer], true).code).toBe("OFFICER_SCOPE_MISMATCH"));
  it("8b. incompatible company scope is excluded", () => expect(evaluateDeliveryOfficerEligibility(actor, { ...officer, companyId: "COMPANY-B" }, [actor, officer], true).code).toBe("OFFICER_SCOPE_MISMATCH"));
  it("9. directory returns only eligible officers", async () => {
    const { repo } = repository({ candidates: [officer, { ...officer, id: "BAD", uid: "BAD", loginAllowed: false }] });
    expect((await resolveEligibleDeliveryOfficers(STORE_UID, deps(repo))).officers.map((item) => item.uid)).toEqual([OFFICER_UID]);
  });
  it("10. directory DTO does not expose broad user profile data", async () => {
    const { repo } = repository({ candidates: [{ ...officer, permissions: { admin: true }, password: "secret", areaIds: ["A1"] }] });
    const result = await resolveEligibleDeliveryOfficers(STORE_UID, deps(repo));
    expect(Object.keys(result.officers[0]).sort()).toEqual(["country", "email", "managerId", "name", "readiness", "role", "uid"]);
  });
});

describe("WP76C server-authoritative DELIVERY_ASSIGN", () => {
  it("11. parser rejects client-injected fields", () => expect(parseDeliveryAssignRequest({ ...request, deliveryOfficerName: "Spoofed" })).toBeNull());
  it("12. nonexistent officer is rejected", async () => { const { repo } = repository({ officer: null }); expect((await executeDeliveryAssign(STORE_UID, request, deps(repo))).code).toBe("OFFICER_NOT_FOUND"); });
  it("13. wrong role is rejected", async () => { const { repo } = repository({ officer: { ...officer, role: "Sales Representative" } }); expect((await executeDeliveryAssign(STORE_UID, request, deps(repo))).code).toBe("OFFICER_ROLE_INVALID"); });
  it("14. inactive officer is rejected", async () => { const { repo } = repository({ officer: { ...officer, active: false } }); expect((await executeDeliveryAssign(STORE_UID, request, deps(repo))).code).toBe("OFFICER_INACTIVE"); });
  it("15. login-disabled officer is rejected", async () => { const { repo } = repository({ officer: { ...officer, loginAllowed: false } }); expect((await executeDeliveryAssign(STORE_UID, request, deps(repo))).code).toBe("OFFICER_LOGIN_DISABLED"); });
  it("16. wrong manager is rejected", async () => { const { repo } = repository({ officer: { ...officer, managerId: "OTHER" } }); expect((await executeDeliveryAssign(STORE_UID, request, deps(repo))).code).toBe("OFFICER_MANAGER_MISMATCH"); });
  it("17. incompatible scope is rejected", async () => { const { repo } = repository({ officer: { ...officer, areaId: "AREA-B" } }); expect((await executeDeliveryAssign(STORE_UID, request, deps(repo))).code).toBe("OFFICER_SCOPE_MISMATCH"); });
  it("18. valid officer is accepted", async () => { const { repo } = repository(); expect((await executeDeliveryAssign(STORE_UID, request, deps(repo))).success).toBe(true); });
  it("19. canonical UID and workflow result are persisted", async () => {
    const { repo, writes } = repository(); const result = await executeDeliveryAssign(STORE_UID, request, deps(repo));
    expect(result).toMatchObject({ currentStatus: "ASSIGNED_FOR_DELIVERY", stage: "DELIVERY", deliveryOfficerUid: OFFICER_UID });
    expect(writes[0].patch).toMatchObject({ deliveryOfficerUid: OFFICER_UID, status: "ASSIGNED_FOR_DELIVERY", stage: "DELIVERY" });
  });
  it("20. history and audit are written atomically", async () => {
    const { repo, writes } = repository(); await executeDeliveryAssign(STORE_UID, request, deps(repo));
    expect(writes[0].patch.history.at(-1)).toMatchObject({ action: "DELIVERY_ASSIGN", actorUid: STORE_UID, toStatus: "ASSIGNED_FOR_DELIVERY" });
    expect(writes[0].audit).toMatchObject({ action: "DELIVERY_ASSIGN", deliveryOfficerUid: OFFICER_UID, entityId: "O1" });
  });
  it("21. invalid source status is rejected without writes", async () => {
    const { repo, writes } = repository({ order: { ...order, status: "PENDING_FINANCE_REVIEW" } });
    expect((await executeDeliveryAssign(STORE_UID, request, deps(repo))).success).toBe(false); expect(writes).toHaveLength(0);
  });
});
