import fs from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const read = (path: string) => fs.readFileSync(new URL(path, root), "utf8");

describe("PR-4 operational safety contract", () => {
  it("documents backup verification and non-production restore drills", () => {
    const runbook = read("docs/production-operations.md");
    expect(runbook).toContain("point-in-time recovery");
    expect(runbook).toContain("pre-release Firestore export");
    expect(runbook).toContain("restore drill into a dedicated non-production");
    expect(runbook).toContain("object versioning or soft delete");
  });

  it("documents revision, Rules, index, and migration rollback boundaries", () => {
    const runbook = read("docs/production-operations.md");
    expect(runbook).toContain("previous healthy Cloud Run revision");
    expect(runbook).toContain("previously approved `firestore.rules`");
    expect(runbook).toContain("Index rollback");
    expect(runbook).toContain("This release performs no migration");
  });

  it("defines a bounded OIDC scheduler template", () => {
    const template = read("ops/attendance-scheduler.template.yaml");
    expect(template).toContain("/api/internal/attendance/recover");
    expect(template).toContain("httpMethod: POST");
    expect(template).toContain("oidcToken:");
    expect(template).toContain("serviceAccountEmail: ${SCHEDULER_SERVICE_ACCOUNT_EMAIL}");
    expect(template).toContain("audience: ${ATTENDANCE_SCHEDULER_AUDIENCE}");
    expect(template).toContain("retryCount: 5");
    expect(template).toContain("maxRetryDuration: 3600s");
  });

  it("retains the governed scheduler endpoint and exact identity verification", () => {
    const server = read("server.ts");
    const auth = read("server/attendanceSchedulerAuth.ts");
    expect(server).toContain('app.post("/api/internal/attendance/recover", requireAttendanceSchedulerAuth');
    expect(auth).toContain("ATTENDANCE_SCHEDULER_AUDIENCE");
    expect(auth).toContain("ATTENDANCE_SCHEDULER_SERVICE_ACCOUNT_EMAIL");
    expect(auth).toContain("payload?.email_verified !== true");
  });

  it("retains transactional and idempotent recovery", () => {
    const recovery = read("server/attendanceRecoveryService.ts");
    expect(recovery).toContain("db.runTransaction");
    expect(recovery).toContain('session.status !== "OPEN"');
    expect(recovery).toContain("session.actualCheckOut");
    expect(recovery).toContain("session.checkoutMode");
  });

  it("specifies the minimum production monitoring and incident response baseline", () => {
    const runbook = read("docs/production-operations.md");
    for (const signal of ["Cloud Run errors", "Readiness/startup", "Authentication", "Authorization", "Firestore indexes/transactions", "Attendance recovery", "Order workflow", "Invoice posting", "Audit ledger", "Storage policy", "Backup freshness"]) {
      expect(runbook).toContain(signal);
    }
    expect(runbook).toContain("Incident response checklist");
  });
});
