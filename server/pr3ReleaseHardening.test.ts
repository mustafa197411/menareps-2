import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { assertProductionAssets, resolveReleaseRuntime } from "./releaseRuntime";

const root = new URL("../", import.meta.url);
const read = (path: string) => fs.readFileSync(new URL(path, root), "utf8");

describe("PR-3 release and Firestore hardening", () => {
  it("fails closed when production release identity is incomplete", () => {
    expect(() => resolveReleaseRuntime({ NODE_ENV: "production", MENAREPS_GIT_COMMIT: "abc" })).toThrow("RELEASE_RUNTIME_REQUIRED:MENAREPS_RELEASE_ID");
    expect(() => resolveReleaseRuntime({ NODE_ENV: "production", MENAREPS_RELEASE_ID: "release" })).toThrow("RELEASE_RUNTIME_REQUIRED:MENAREPS_GIT_COMMIT");
  });

  it("accepts an explicit production release and Cloud Run port", () => {
    expect(resolveReleaseRuntime({ NODE_ENV: "production", MENAREPS_RELEASE_ID: "release-1", MENAREPS_GIT_COMMIT: "abc123", PORT: "8080", K_REVISION: "revision-1" }))
      .toMatchObject({ production: true, releaseId: "release-1", gitCommit: "abc123", port: 8080, cloudRunRevision: "revision-1" });
  });

  it("rejects an invalid listener port", () => {
    expect(() => resolveReleaseRuntime({ PORT: "not-a-port" })).toThrow("RELEASE_RUNTIME_INVALID:PORT");
  });

  it("refuses production startup without built frontend assets", () => {
    const runtime = resolveReleaseRuntime({ NODE_ENV: "production", MENAREPS_RELEASE_ID: "release", MENAREPS_GIT_COMMIT: "abc" });
    expect(() => assertProductionAssets(runtime, false)).toThrow("RELEASE_RUNTIME_REQUIRED:DIST_INDEX");
    expect(() => assertProductionAssets(runtime, true)).not.toThrow();
  });

  it("declares the supported Node runtime and production start mode", () => {
    const manifest = JSON.parse(read("package.json"));
    expect(manifest.engines.node).toBe("22.x");
    expect(manifest.scripts.start).toBe("NODE_ENV=production node dist/server.cjs");
    expect(read(".nvmrc").trim()).toBe("22");
  });

  it("keeps the Cloud Run buildpack dependency contract npm-only", () => {
    expect(fs.existsSync(new URL("package-lock.json", root))).toBe(true);
    for (const competingLockfile of ["bun.lock", "bun.lockb", "yarn.lock", "pnpm-lock.yaml"]) {
      expect(fs.existsSync(new URL(competingLockfile, root)), competingLockfile).toBe(false);
    }
  });

  it("separates liveness/readiness and initializes Admin before binding", () => {
    const server = read("server.ts");
    expect(server).toContain('app.get("/api/health"');
    expect(server).toContain('app.get("/api/ready"');
    expect(server.indexOf("getFirebaseAdminServices();")).toBeLessThan(server.indexOf("app.listen("));
    expect(server.indexOf("assertProductionAssets(")).toBeLessThan(server.indexOf("app.listen("));
    expect(server).toContain("MENAREPS_STARTUP_FAILED");
  });

  it("keeps frontend Firebase initialization out of the production server graph", () => {
    expect(read("server/pharmacyVisitCompletionService.ts")).toContain('../src/lib/businessDocumentFormat');
    expect(read("server/pharmacyOrderCreateService.ts")).toContain('../src/lib/businessDocumentFormat');
    expect(read("src/lib/businessDocumentFormat.ts")).not.toContain('./firebase');
  });

  it("contains every production composite query in the index manifest", () => {
    const manifest = JSON.parse(read("firestore.indexes.json"));
    const signatures = manifest.indexes.map((index: any) => `${index.collectionGroup}:${index.fields.map((field: any) => `${field.fieldPath}:${field.order}`).join(",")}`);
    expect(signatures).toContain("physicianVisits:repId:ASCENDING,visitDate:ASCENDING,__name__:ASCENDING");
    expect(signatures).toContain("pharmacyVisits:repId:ASCENDING,visitDate:ASCENDING,__name__:ASCENDING");
    expect(signatures).toContain("orders:areaId:ASCENDING,status:ASCENDING,createdAt:ASCENDING,__name__:ASCENDING");
    expect(signatures).toContain("orders:pharmacyId:ASCENDING,status:ASCENDING,createdAt:ASCENDING,__name__:ASCENDING");
    expect(signatures).toContain("attendanceSessions:userId:ASCENDING,date:ASCENDING,__name__:ASCENDING");
    expect(signatures).toContain("leaveRequests:userId:ASCENDING,startDate:ASCENDING,__name__:ASCENDING");
    expect(signatures).toContain("attendanceSessions:marketId:ASCENDING,status:ASCENDING,date:ASCENDING,__name__:ASCENDING");
    expect(signatures).toContain("notifications:userId:ASCENDING,createdAt:DESCENDING,__name__:DESCENDING");
    expect(signatures).toContain("targetCalculationRuns:planId:ASCENDING,requestedAt:DESCENDING,__name__:DESCENDING");

    expect(read("server/physicianVisitReadService.ts")).toContain('.where("repId", "in", subjects)');
    expect(read("server/pharmacyVisitReadService.ts")).toContain('.where("repId", "in", subjects)');
    expect(read("server/orderWorkflowQueueReadService.ts")).toContain('.where("status", "in", statuses)');
    expect(read("server/teamActivityReadService.ts")).toContain('.where("userId", "in", userIds)');
    expect(read("server/attendanceRecoveryService.ts")).toContain('.where("status", "==", "OPEN")');
    expect(read("src/lib/notificationService.ts")).toContain('orderBy("createdAt", "desc")');
    expect(read("src/components/targets/ProductTargetHub.tsx")).toContain('orderBy("requestedAt", "desc")');
  });
});
