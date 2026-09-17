import { describe, expect, it } from "vitest";
import {
  canTransitionOrder,
  getOrderWorkflowPresentation,
  getStageForStatus,
  normalizeOrderStatus,
} from "./features/orders/orderWorkflowEngine";
import { Role } from "./types";

const stageOf = (status: string) => getStageForStatus(normalizeOrderStatus(status));

describe("WP76E-FIX-01 terminal Delivered/Closed rendering", () => {
  it("renders a Delivered record as Delivered in the closed stage", () => {
    expect(getOrderWorkflowPresentation({ status: "DELIVERED", lang: "en" })).toMatchObject({
      statusLabel: "Delivered",
      stageLabel: "Completed & Closed",
    });
  });

  it("renders an explicitly Closed record as Delivered & Closed", () => {
    expect(getOrderWorkflowPresentation({ status: "CLOSED", lang: "en" })).toMatchObject({
      statusLabel: "Delivered & Closed",
      stageLabel: "Completed & Closed",
    });
  });

  it("normalizes case variants into the canonical terminal statuses", () => {
    expect(normalizeOrderStatus("Delivered")).toBe("DELIVERED");
    expect(normalizeOrderStatus("closed")).toBe("CLOSED");
    expect(stageOf("Delivered")).toBe("CLOSED");
    expect(stageOf("closed")).toBe("CLOSED");
  });

  it("separates active delivery work from terminal history", () => {
    const statuses = ["ASSIGNED_FOR_DELIVERY", "OUT_FOR_DELIVERY", "Delivered", "CLOSED"];
    expect(statuses.filter(status => stageOf(status) === "DELIVERY")).toEqual([
      "ASSIGNED_FOR_DELIVERY",
      "OUT_FOR_DELIVERY",
    ]);
    expect(statuses.filter(status => stageOf(status) === "CLOSED")).toEqual(["Delivered", "CLOSED"]);
  });

  it("does not permit terminal records to re-enter active workflow", () => {
    for (const status of ["DELIVERED", "CLOSED"]) {
      const result = canTransitionOrder({
        order: { id: `ORDER-${status}`, status },
        action: "DELIVERY_START",
        actor: { uid: "DELIVERY-1", role: Role.DELIVERY_OFFICER, name: "Delivery Officer" },
      });
      expect(result.allowed).toBe(false);
      expect(result.nextStatus).toBeNull();
    }
  });

  it("leaves non-terminal delivery stages unchanged", () => {
    expect(stageOf("ASSIGNED_FOR_DELIVERY")).toBe("DELIVERY");
    expect(stageOf("OUT_FOR_DELIVERY")).toBe("DELIVERY");
    expect(stageOf("READY_FOR_DISPATCH")).toBe("DISPATCH");
  });
});
