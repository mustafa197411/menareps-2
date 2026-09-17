import { describe, expect, it } from "vitest";
import {
  hasVisitMarketingRequestPermission,
  isApplicableVisitMarketingSupervisor,
  isEligibleVisitMarketingFinalApprover,
  nextVisitMarketingRequestStatus,
  parseVisitMarketingRequestDraft,
} from "./lib/visitMarketingRequestPolicy";

const active = (id: string, role: string, extra: Record<string, unknown> = {}) => ({ id, role, active: true, loginAllowed: true, isDeleted: false, ...extra });

describe("WP83 canonical Visit Marketing Request policy", () => {
  it("accepts a generic valid request without requiring Product context", () => {
    expect(parseVisitMarketingRequestDraft({ requestType: "Symposium", urgency: "High", description: "Canonical support", estimatedBudget: 0 })).toEqual({ requestType: "Symposium", urgency: "High", description: "Canonical support", estimatedBudget: 0 });
  });
  it("rejects invalid request vocabulary", () => expect(parseVisitMarketingRequestDraft({ requestType: "Invented", urgency: "High", description: "x" })).toBeNull());
  it("rejects negative budget", () => expect(parseVisitMarketingRequestDraft({ requestType: "Other", urgency: "Low", description: "x", estimatedBudget: -1 })).toBeNull());
  it("rejects missing description", () => expect(parseVisitMarketingRequestDraft({ requestType: "Other", urgency: "Low" })).toBeNull());

  it("canonical Supervisor is resolved by exact manager relationship and capability", () => expect(isApplicableVisitMarketingSupervisor({
    representativeUid: "REP-ALPHA", representativeManagerId: "SUP-BETA", supervisorUid: "SUP-BETA",
    supervisor: active("SUP-BETA", "Medical Supervisor"), permissions: { marketingRequestCapabilities: { supervisorApprove: true, supervisorReject: true } },
  })).toBe(true));
  it("unrelated Supervisor fails", () => expect(isApplicableVisitMarketingSupervisor({ representativeUid: "REP", representativeManagerId: "SUP-OTHER", supervisorUid: "SUP", supervisor: active("SUP", "Supervisor"), permissions: { marketingRequestCapabilities: { supervisorApprove: true, supervisorReject: true } } })).toBe(false));
  it("inactive Supervisor fails", () => expect(isApplicableVisitMarketingSupervisor({ representativeUid: "REP", representativeManagerId: "SUP", supervisorUid: "SUP", supervisor: active("SUP", "Supervisor", { active: false }), permissions: { marketingRequestCapabilities: { supervisorApprove: true, supervisorReject: true } } })).toBe(false));
  it("Supervisor missing canonical capability fails", () => expect(isApplicableVisitMarketingSupervisor({ representativeUid: "REP", representativeManagerId: "SUP", supervisorUid: "SUP", supervisor: active("SUP", "Arbitrary Role"), permissions: { marketingRequestCapabilities: { supervisorApprove: false, supervisorReject: false } } })).toBe(false));
  it("dynamic permission cannot grant first-stage capability without a canonical lifecycle role", () => expect(hasVisitMarketingRequestPermission("Arbitrary Canonical Role", "supervisorApprove", { marketingRequestCapabilities: { supervisorApprove: true } })).toBe(false));
  it("execution capability is independently configurable", () => {
    expect(hasVisitMarketingRequestPermission("Medical Manager", "execute", { marketingRequestCapabilities: { execute: true } })).toBe(true);
    expect(hasVisitMarketingRequestPermission("Medical Manager", "execute", { marketingRequestCapabilities: { execute: false } })).toBe(false);
  });

  it("valid higher manager requires ancestry, permission and Area scope", () => expect(isEligibleVisitMarketingFinalApprover({
    actorUid: "MANAGER-GAMMA", creatorUid: "REP-ALPHA", actor: active("MANAGER-GAMMA", "Medical Manager"),
    activeAncestorUids: ["MANAGER-GAMMA"], requestAreaId: "AREA-X", actorAreaIds: ["AREA-X"], action: "finalApprove",
    permissions: { marketingRequestCapabilities: { finalApprove: true } },
  })).toBe(true));
  it("lower or unrelated actor fails final review", () => expect(isEligibleVisitMarketingFinalApprover({ actorUid: "OTHER", creatorUid: "REP", actor: active("OTHER", "Manager"), activeAncestorUids: ["MANAGER"], requestAreaId: "A", actorAreaIds: ["A"], action: "finalApprove", permissions: { marketingRequestCapabilities: { finalApprove: true } } })).toBe(false));
  it("higher actor without permission fails", () => expect(isEligibleVisitMarketingFinalApprover({ actorUid: "MANAGER", creatorUid: "REP", actor: active("MANAGER", "Manager"), activeAncestorUids: ["MANAGER"], requestAreaId: "A", actorAreaIds: ["A"], action: "finalApprove", permissions: { marketingRequestCapabilities: { finalApprove: false } } })).toBe(false));
  it("permitted actor outside request Area fails", () => expect(isEligibleVisitMarketingFinalApprover({ actorUid: "MANAGER", creatorUid: "REP", actor: active("MANAGER", "Manager"), activeAncestorUids: ["MANAGER"], requestAreaId: "A", actorAreaIds: ["B"], action: "finalApprove", permissions: { marketingRequestCapabilities: { finalApprove: true } } })).toBe(false));
  it("creator later promoted remains unable to approve", () => expect(isEligibleVisitMarketingFinalApprover({ actorUid: "CREATOR", creatorUid: "CREATOR", actor: active("CREATOR", "Manager"), activeAncestorUids: ["CREATOR"], requestAreaId: "A", actorAreaIds: ["A"], action: "finalApprove", permissions: { marketingRequestCapabilities: { finalApprove: true } } })).toBe(false));
  it("execution uses the same ancestry and scope contract with a distinct permission", () => expect(isEligibleVisitMarketingFinalApprover({ actorUid: "EXECUTOR", creatorUid: "REP", actor: active("EXECUTOR", "Medical Manager"), activeAncestorUids: ["APPROVER", "EXECUTOR"], requestAreaId: "A", actorAreaIds: ["A"], action: "execute", permissions: { marketingRequestCapabilities: { execute: true } } })).toBe(true));
  it("execution fails outside applicable scope", () => expect(isEligibleVisitMarketingFinalApprover({ actorUid: "EXECUTOR", creatorUid: "REP", actor: active("EXECUTOR", "Arbitrary Role"), activeAncestorUids: ["EXECUTOR"], requestAreaId: "A", actorAreaIds: ["B"], action: "execute", permissions: { marketingRequestCapabilities: { execute: true } } })).toBe(false));

  it.each([
    ["PENDING_SUPERVISOR", "SUPERVISOR_APPROVE", "PENDING_FINAL_APPROVAL"],
    ["PENDING_SUPERVISOR", "SUPERVISOR_REJECT", "REJECTED"],
    ["PENDING_SUPERVISOR", "CANCEL", "CANCELLED"],
    ["PENDING_FINAL_APPROVAL", "FINAL_APPROVE", "APPROVED"],
    ["PENDING_FINAL_APPROVAL", "FINAL_REJECT", "REJECTED"],
    ["PENDING_FINAL_APPROVAL", "CANCEL", "CANCELLED"],
    ["APPROVED", "EXECUTE", "EXECUTED"],
  ] as const)("allows %s + %s", (status, action, expected) => expect(nextVisitMarketingRequestStatus(status, action)).toBe(expected));
  it.each(["REJECTED", "CANCELLED", "EXECUTED"] as const)("keeps %s terminal", status => {
    expect(nextVisitMarketingRequestStatus(status, "SUPERVISOR_APPROVE")).toBeNull();
    expect(nextVisitMarketingRequestStatus(status, "FINAL_APPROVE")).toBeNull();
    expect(nextVisitMarketingRequestStatus(status, "CANCEL")).toBeNull();
    expect(nextVisitMarketingRequestStatus(status, "EXECUTE")).toBeNull();
  });
  it("does not require Product context for execution or any lifecycle transition", () => {
    expect(nextVisitMarketingRequestStatus("APPROVED", "EXECUTE")).toBe("EXECUTED");
    expect(parseVisitMarketingRequestDraft({ requestType: "Other", urgency: "Low", description: "General request" })).not.toBeNull();
  });
});
