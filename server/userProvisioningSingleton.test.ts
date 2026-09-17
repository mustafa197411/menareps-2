import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { Role } from "../src/types";
import { assertSingletonProvisioningRoleAvailable, authorizeProvisioning } from "./userProvisioningService";

const snapshot = (records: Array<Record<string, unknown>>) => ({
  docs: records.map(record => ({ data: () => record })),
});

function fakeDb(records: Record<string, Array<Record<string, unknown>>>) {
  return {
    collection(name: string) {
      return {
        where(_field: string, _operator: string, role: string) {
          return { get: async () => snapshot((records[name] || []).filter(record => record.role === role)) };
        },
      };
    },
  } as unknown as FirebaseFirestore.Firestore;
}

describe("installation-wide User Management provisioning", () => {
  it("allows Super Admin to provision the first Admin", async () => {
    expect(() => authorizeProvisioning({ role: Role.SUPER_ADMIN }, null, Role.ADMIN)).not.toThrow();
    await expect(assertSingletonProvisioningRoleAvailable(fakeDb({}), Role.ADMIN)).resolves.toBeUndefined();
  });

  it("blocks a second Admin with the explicit uniqueness reason", async () => {
    await expect(assertSingletonProvisioningRoleAvailable(fakeDb({ users: [{ role: Role.ADMIN }] }), Role.ADMIN))
      .rejects.toThrow("An Admin already exists for this MENAREPS installation.");
  });

  it("allows Admin to provision the first General Manager without a rolePermissions document", async () => {
    expect(() => authorizeProvisioning({ role: Role.ADMIN }, null, Role.GENERAL_MANAGER)).not.toThrow();
    await expect(assertSingletonProvisioningRoleAvailable(fakeDb({}), Role.GENERAL_MANAGER)).resolves.toBeUndefined();
  });

  it("blocks a second General Manager with the explicit uniqueness reason", async () => {
    await expect(assertSingletonProvisioningRoleAvailable(fakeDb({ userActivationProfiles: [{ role: Role.GENERAL_MANAGER }] }), Role.GENERAL_MANAGER))
      .rejects.toThrow("A General Manager already exists for this MENAREPS installation.");
  });

  it("blocks Admin from provisioning Super Admin", () => {
    expect(() => authorizeProvisioning({ role: Role.ADMIN }, null, Role.SUPER_ADMIN)).toThrow("TARGET_ROLE_CREATION_DENIED");
  });

  it("keeps permitted lower-role provisioning available to Admin", () => {
    expect(() => authorizeProvisioning({ role: Role.ADMIN }, null, Role.MEDICAL_MANAGER)).not.toThrow();
  });

  it("rejects uniqueness before any downstream identity or assignment mutation", async () => {
    const createAuth = vi.fn();
    const writeUser = vi.fn();
    const writeActivation = vi.fn();
    const syncTerritories = vi.fn();
    const syncProducts = vi.fn();
    const provision = async () => {
      await assertSingletonProvisioningRoleAvailable(fakeDb({ users: [{ role: Role.GENERAL_MANAGER }] }), Role.GENERAL_MANAGER);
      await createAuth();
      await writeUser();
      await writeActivation();
      await syncTerritories();
      await syncProducts();
    };
    await expect(provision()).rejects.toThrow("A General Manager already exists for this MENAREPS installation.");
    for (const mutation of [createAuth, writeUser, writeActivation, syncTerritories, syncProducts]) expect(mutation).not.toHaveBeenCalled();
  });

  it("places the trusted singleton gate before every Firebase Auth operation", () => {
    const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
    const routeStart = server.indexOf('app.post("/api/admin/create-auth-user"');
    const routeEnd = server.indexOf("// Secure Firebase Runtime Diagnostic endpoint", routeStart);
    const route = server.slice(routeStart, routeEnd);
    const uniquenessGate = route.indexOf("assertSingletonProvisioningRoleAvailable");
    expect(uniquenessGate).toBeGreaterThan(-1);
    expect(uniquenessGate).toBeLessThan(route.indexOf("adminAuth.getUserByEmail"));
    expect(uniquenessGate).toBeLessThan(route.indexOf("adminAuth.createUser"));
  });

  it("ignores archived singleton records", async () => {
    await expect(assertSingletonProvisioningRoleAvailable(fakeDb({ users: [{ role: Role.ADMIN, isDeleted: true }] }), Role.ADMIN)).resolves.toBeUndefined();
  });
});
