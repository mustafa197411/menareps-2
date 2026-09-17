import { describe, expect, it } from "vitest";
import { Role } from "../src/types";
import { buildAuthoritativeAuditEvent } from "./auditEventService";
import { resolveFirebaseRuntimeIdentity } from "./firebaseRuntimeIdentity";
import { authorizeProvisioning, parseProvisioningRequest } from "./userProvisioningService";
import { resolveFrontendFirebaseConfig } from "../src/lib/firebaseRuntimeConfig";
import fs from "fs";

describe("PR-1 production security invariants", () => {
  it("rejects enabled provisioning without an explicit credential", () => {
    expect(() => parseProvisioningRequest({ email: "new@example.test", name: "New User", role: Role.MEDICAL_REP, disabled: false }))
      .toThrow("EXPLICIT_INITIAL_CREDENTIAL_REQUIRED");
  });

  it("permits a disabled pending identity without a shared credential", () => {
    expect(parseProvisioningRequest({ email: "new@example.test", name: "New User", role: Role.MEDICAL_REP, disabled: true }))
      .toMatchObject({ disabled: true, password: undefined, role: Role.MEDICAL_REP });
  });

  it("rejects unsupported roles and canonical role escalation", () => {
    expect(() => parseProvisioningRequest({ email: "new@example.test", name: "New User", role: "Invented Manager", disabled: true }))
      .toThrow("INVALID_PROVISIONING_REQUEST");
    expect(() => authorizeProvisioning({ role: Role.MEDICAL_MANAGER }, { active: true, create: true }, Role.SUPER_ADMIN))
      .toThrow("TARGET_ROLE_CREATION_DENIED");
  });

  it("requires active dynamic provisioning permission", () => {
    expect(() => authorizeProvisioning({ role: Role.MEDICAL_MANAGER }, { active: true, create: false }, Role.MEDICAL_REP))
      .toThrow("PROVISIONING_PERMISSION_DENIED");
    expect(() => authorizeProvisioning({ role: Role.MEDICAL_MANAGER }, null, Role.MEDICAL_REP))
      .toThrow("PROVISIONING_PERMISSION_DENIED");
    expect(() => authorizeProvisioning({ role: Role.MEDICAL_MANAGER }, { active: true, create: true }, Role.MEDICAL_REP)).not.toThrow();
  });

  it("preserves the canonical Super Admin provisioning override", () => {
    expect(() => authorizeProvisioning({ role: Role.SUPER_ADMIN }, { active: true, create: false }, Role.MEDICAL_REP)).not.toThrow();
    expect(() => authorizeProvisioning({ role: "super_admin" }, null, Role.MEDICAL_REP)).not.toThrow();
  });

  it("replaces client audit identity, id, and time with server authority", () => {
    const event = buildAuthoritativeAuditEvent(
      { id: "FORGED", userId: "OTHER", userRole: Role.SUPER_ADMIN, timestamp: "2000-01-01T00:00:00.000Z", action: "Viewed", entityType: "Physician", entityName: "Physician Record", details: "Record viewed" },
      { id: "AUTH-UID", name: "Authenticated Actor", role: Role.MEDICAL_REP },
      new Date("2026-08-22T12:00:00.000Z"),
      () => "AUD-SERVER",
    );
    expect(event).toMatchObject({ id: "AUD-SERVER", userId: "AUTH-UID", userRole: Role.MEDICAL_REP, timestamp: "2026-08-22T12:00:00.000Z", createdBy: "AUTH-UID" });
  });

  it("fails closed for missing or inconsistent backend Firebase identity", () => {
    expect(() => resolveFirebaseRuntimeIdentity({})).toThrow("FIREBASE_RUNTIME_IDENTITY_REQUIRED");
    expect(() => resolveFirebaseRuntimeIdentity({ FIREBASE_PROJECT_ID: "project-a", FIRESTORE_DATABASE_ID: "db", GOOGLE_CLOUD_PROJECT: "project-b" }))
      .toThrow("FIREBASE_RUNTIME_PROJECT_MISMATCH");
  });

  it("keeps emulator identity explicit, demo-only, and loopback-isolated", () => {
    expect(resolveFirebaseRuntimeIdentity({ FIREBASE_PROJECT_ID: "demo-menareps-uat", FIRESTORE_DATABASE_ID: "(default)", FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" }))
      .toEqual({ projectId: "demo-menareps-uat", databaseId: "(default)", emulator: true });
    expect(() => resolveFirebaseRuntimeIdentity({ FIREBASE_PROJECT_ID: "production-project", FIRESTORE_DATABASE_ID: "(default)", FIRESTORE_EMULATOR_HOST: "remote.example:8080" }))
      .toThrow("FIREBASE_EMULATOR_IDENTITY_NOT_ISOLATED");
  });

  it("requires explicit production frontend project and database configuration", () => {
    expect(() => resolveFrontendFirebaseConfig({ production: true, env: {}, bundled: { projectId: "fallback" } })).toThrow("FIREBASE_FRONTEND_CONFIG_REQUIRED");
    expect(resolveFrontendFirebaseConfig({ production: true, env: { apiKey: "key", authDomain: "auth", projectId: "project", storageBucket: "bucket", messagingSenderId: "sender", appId: "app", databaseId: "db" }, bundled: {} }).databaseId).toBe("db");
    expect(() => resolveFrontendFirebaseConfig({ production: true, env: { apiKey: "key", authDomain: "auth", projectId: "wrong", storageBucket: "bucket", messagingSenderId: "sender", appId: "app", databaseId: "db" }, bundled: { projectId: "expected", databaseId: "db" } })).toThrow("FIREBASE_FRONTEND_PROJECT_MISMATCH");
  });

  it("keeps duplicate identity and direct client audit mutation paths fail closed", () => {
    const server = fs.readFileSync(new URL("../server.ts", import.meta.url), "utf8");
    const auditService = fs.readFileSync(new URL("./auditEventService.ts", import.meta.url), "utf8");
    const client = fs.readFileSync(new URL("../src/lib/firestoreService.ts", import.meta.url), "utf8");
    const rules = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
    const auditStart = client.indexOf("export async function saveAuditLogRecord");
    const auditEnd = client.indexOf("export async function saveImportHistoryRecord", auditStart);
    expect(server).toContain("CANONICAL_IDENTITY_CONFLICT");
    expect(server).toContain("persistAuthoritativeAuditEvent(db, req.body || {}, user)");
    expect(auditService).toContain('.doc(event.id).create(event)');
    expect(client.slice(auditStart, auditEnd)).not.toContain("setDoc(");
    expect(client.slice(auditStart, auditEnd)).not.toContain("log.userId");
    expect(client.slice(auditStart, auditEnd)).not.toContain("log.timestamp");
    expect(rules).toMatch(/match \/auditLogs\/\{logId\}[\s\S]*?allow create, update: if false;/);
  });
});
