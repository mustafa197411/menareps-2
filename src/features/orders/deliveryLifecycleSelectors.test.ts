import { describe, expect, it } from "vitest";
import { deliveryActionCandidatesForOrder, resolveDeliveryLifecycleDecision } from "./deliveryLifecycleSelectors";

const order = (status: string, overrides: Record<string, unknown> = {}) => ({
  status,
  inventoryContractVersion: 2,
  deliveryOfficerUid: "OFFICER-A",
  deliveryAssignmentStatus: "ASSIGNED",
  ...overrides,
});

describe("Phase 5C version-2 delivery lifecycle selectors", () => {
  it("requires assignment at Ready for Dispatch", () => {
    const result = resolveDeliveryLifecycleDecision(order("READY_FOR_DISPATCH", { deliveryOfficerUid: "", deliveryAssignmentStatus: "UNASSIGNED" }), "OFFICER-A");
    expect(result).toMatchObject({ assignmentRequired: true, startDeliveryAllowed: false, finalOutcomesAllowed: false });
  });

  it("does not treat a display UID without persisted assignment status as canonical", () => {
    const result = resolveDeliveryLifecycleDecision(order("READY_FOR_DISPATCH", { deliveryAssignmentStatus: undefined }), "OFFICER-A");
    expect(result).toMatchObject({ canonicalAssignmentPresent: false, assignmentRequired: true, startDeliveryAllowed: false });
  });

  it.each(["READY_FOR_DISPATCH", "ASSIGNED_FOR_DELIVERY"])("shows only Start Delivery for assigned %s", status => {
    const result = resolveDeliveryLifecycleDecision(order(status), "OFFICER-A");
    expect(result).toMatchObject({ startDeliveryAllowed: true, finalOutcomesAllowed: false, partialDeliveryAllowed: false });
    expect(deliveryActionCandidatesForOrder(order(status), "OFFICER-A")).toEqual(["DELIVERY_START"]);
  });

  it("denies a different Delivery Officer", () => {
    expect(deliveryActionCandidatesForOrder(order("ASSIGNED_FOR_DELIVERY"), "OFFICER-B")).toEqual([]);
  });

  it("shows complete-invoice outcomes only after Start Delivery", () => {
    const result = resolveDeliveryLifecycleDecision(order("OUT_FOR_DELIVERY"), "OFFICER-A");
    expect(result).toMatchObject({ startDeliveryAllowed: false, finalOutcomesAllowed: true, partialDeliveryAllowed: false });
    expect(deliveryActionCandidatesForOrder(order("OUT_FOR_DELIVERY"), "OFFICER-A")).not.toContain("DELIVERY_PARTIAL");
  });

  it("preserves explicit legacy partial-delivery behavior", () => {
    const legacy = order("READY_FOR_DISPATCH", { inventoryContractVersion: 1 });
    expect(resolveDeliveryLifecycleDecision(legacy, "OFFICER-B").partialDeliveryAllowed).toBe(true);
    expect(deliveryActionCandidatesForOrder(legacy, "OFFICER-B")).toContain("DELIVERY_PARTIAL");
  });

  it("renders terminal version-2 states as read-only summaries", () => {
    const result = resolveDeliveryLifecycleDecision(order("DELIVERED"), "OFFICER-A");
    expect(result).toMatchObject({ terminal: true, showDeliveryWorkstation: true, startDeliveryAllowed: false, finalOutcomesAllowed: false });
  });

  it("exposes no delivery action for reservation-backed orders with missing contract metadata", () => {
    const ambiguous = order("ASSIGNED_FOR_DELIVERY", { inventoryContractVersion: undefined, reservationIds: ["RESERVATION-A"] });
    expect(resolveDeliveryLifecycleDecision(ambiguous, "OFFICER-A")).toMatchObject({ inventoryContractIntegrityError: true, startDeliveryAllowed: false, finalOutcomesAllowed: false });
    expect(deliveryActionCandidatesForOrder(ambiguous, "OFFICER-A")).toEqual([]);
  });
});
