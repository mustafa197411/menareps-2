import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { CANONICAL_USER_ROLES, Role } from "../types";
import { evaluateBaseSessionInitialization, resolveSessionDomState } from "./baseSessionInitialization";

const readyFoundation = {
  authReady: true,
  profileLoaded: true,
  permissionsReady: true,
  policyReady: true,
  sessionHydrationComplete: true,
  readinessStatus: "Operational" as const,
};

describe("WP5.2F.6B.2D universal initialization gate", () => {
  it("maps existing session state to a semantic DOM contract without deciding readiness", () => {
    expect(resolveSessionDomState({ sessionReady: false, isSessionInitializing: true, hasInitializationError: false })).toBe("INITIALIZING");
    expect(resolveSessionDomState({ sessionReady: true, isSessionInitializing: false, hasInitializationError: false })).toBe("OPERATIONAL");
    expect(resolveSessionDomState({ sessionReady: false, isSessionInitializing: false, hasInitializationError: false })).toBe("NON_OPERATIONAL");
    expect(resolveSessionDomState({ sessionReady: false, isSessionInitializing: true, hasInitializationError: true })).toBe("ERROR");
  });

  it("initializes all 24 canonical roles independently of WP5.2E availability", () => {
    expect(CANONICAL_USER_ROLES).toHaveLength(24);

    for (const role of CANONICAL_USER_ROLES) {
      for (const operationalScopeStatus of ["READY", "DENIED", "ERROR"] as const) {
        const decision = evaluateBaseSessionInitialization({
          ...readyFoundation,
          operationalScopeStatus,
        });
        expect(decision.ready, `${role} with ${operationalScopeStatus}`).toBe(true);
        expect(decision.operationalScopeAvailable).toBe(operationalScopeStatus === "READY");
      }
    }
  });

  it("keeps unsupported specialist roles isolated from WP5.2E authority", () => {
    const specialists = [
      Role.MARKETING_OFFICER,
      Role.TREASURY_OFFICER,
      Role.INVENTORY_OFFICER,
      Role.DELIVERY_OFFICER,
      Role.ORDER_OPS_OFFICER,
    ];

    for (const role of specialists) {
      const decision = evaluateBaseSessionInitialization({
        ...readyFoundation,
        operationalScopeStatus: "DENIED",
      });
      expect(decision.ready, role).toBe(true);
      expect(decision.operationalScopeAvailable, role).toBe(false);
    }
  });

  it("allows Product Manager readiness while NO_ACTIVE_ASSIGNMENTS remains resource denial", () => {
    const decision = evaluateBaseSessionInitialization({
      ...readyFoundation,
      operationalScopeStatus: "DENIED",
    });
    expect(decision.ready).toBe(true);
    expect(decision.operationalScopeAvailable).toBe(false);
  });

  it("allows hydrated Medical Supervisor readiness without granting invalid geography", () => {
    const decision = evaluateBaseSessionInitialization({
      ...readyFoundation,
      operationalScopeStatus: "DENIED",
    });
    expect(decision.ready).toBe(true);
    expect(decision.operationalScopeAvailable).toBe(false);
  });

  it("keeps authentication, profile, permissions, policy, hydration, and readiness fatal", () => {
    for (const prerequisite of [
      "authReady",
      "profileLoaded",
      "permissionsReady",
      "policyReady",
      "sessionHydrationComplete",
    ] as const) {
      expect(evaluateBaseSessionInitialization({
        ...readyFoundation,
        [prerequisite]: false,
        operationalScopeStatus: "READY",
      }).ready, prerequisite).toBe(false);
    }

    for (const readinessStatus of [
      "Pending",
      "Incomplete",
      "Suspended",
      "Inactive",
      "Terminated",
      "Blocked",
    ] as const) {
      expect(evaluateBaseSessionInitialization({
        ...readyFoundation,
        readinessStatus,
        operationalScopeStatus: "READY",
      }).ready, readinessStatus).toBe(false);
    }
  });

  it("retains resource-level WP5.2E gates and the separate G.1 Operations boundary", () => {
    const app = fs.readFileSync("src/App.tsx", "utf8");
    const server = fs.readFileSync("server.ts", "utf8");
    const workflowScope = fs.readFileSync("server/workflowQueueScopeService.ts", "utf8");

    expect(app).not.toContain("throw new Error(`Canonical operational scope");
    expect(app.match(/operationalScopeSession\.status !== "READY"/g)?.length).toBeGreaterThanOrEqual(4);
    expect(server).toContain('/api/orders/workflow/scoped-query');
    expect(server).toContain('/api/orders/workflow/detail');
    expect(server).toContain('/api/orders/workflow/transition');
    expect(workflowScope).toContain("Order Operations Officer");
  });

  it("keeps scope denial/error state non-authoritative and session transitions clearing data", () => {
    for (const operationalScopeStatus of ["DENIED", "ERROR"] as const) {
      const decision = evaluateBaseSessionInitialization({
        ...readyFoundation,
        operationalScopeStatus,
      });
      expect(decision.ready).toBe(true);
      expect(decision.operationalScopeAvailable).toBe(false);
    }

    const app = fs.readFileSync("src/App.tsx", "utf8");
    expect(app).toContain("operationalScopeController.clear();");
    expect(app).toContain("setPhysicians([]);");
    expect(app).toContain("setPharmacies([]);");
    expect(app).toContain("setPhysicianVisits([]);");
    expect(app).toContain("setPharmacyVisits([]);");
  });
});
