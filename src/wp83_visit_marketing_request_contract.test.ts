import fs from "node:fs";
import { describe, expect, it } from "vitest";

const service = fs.readFileSync(new URL("../server/visitMarketingRequestService.ts", import.meta.url), "utf8");
const visitWrite = fs.readFileSync(new URL("../server/physicianVisitWriteService.ts", import.meta.url), "utf8");
const rules = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../server.ts", import.meta.url), "utf8");
const materials = fs.readFileSync(new URL("./components/marketing/MarketingMaterials.tsx", import.meta.url), "utf8");

describe("WP83B1 backend authority contract", () => {
  it("creates canonical requests atomically with Physician Visit completion", () => {
    expect(visitWrite).toContain('collection("visitMarketingRequests").doc()');
    expect(visitWrite).toContain("marketingRequestIds");
    expect(visitWrite).toContain("marketingRequests: undefined");
  });
  it("does not infer Product context", () => {
    expect(service).not.toMatch(/productIds\s*:\s*\[[^\]]/);
    expect(visitWrite).not.toContain("marketingDrafts[0]");
  });
  it("offers authenticated create, scoped read, review and cancellation endpoints", () => {
    expect(server).toContain('/api/visit-marketing-requests/scoped-query');
    expect(server).toContain('/api/visit-marketing-requests/create');
    for (const route of ["supervisor-approve", "supervisor-reject", "final-approve", "final-reject", "cancel"]) expect(server).toContain(route);
    expect(server).toContain('app.post(`/api/visit-marketing-requests/${route}`, requireFirebaseAuth');
  });
  it("exposes execution through the authenticated generic transition endpoint", () => {
    expect(server).toContain('execute: "EXECUTE"');
    expect(server).toContain('app.post(`/api/visit-marketing-requests/${route}`, requireFirebaseAuth');
  });
  it("uses dynamic permission plus hierarchy and scope for final review", () => {
    expect(service).toContain("activeAncestorChain");
    expect(service).toContain("isEligibleVisitMarketingFinalApprover");
    expect(service).toContain("resolveOperationalScopeForActor");
  });
  it("denies direct request and audit mutations", () => {
    expect(rules).toMatch(/match \/visitMarketingRequests\/\{requestId\}[\s\S]*?allow read, write: if false/);
    expect(rules).toMatch(/match \/visitMarketingRequestAudit\/\{eventId\}[\s\S]*?allow read, write: if false/);
  });
  it("leaves Promotional Material Request implementation unchanged", () => expect(materials).toContain('collection(db, "marketingMaterialRequests")'));
  it("contains no fixed final approver role list", () => expect(service).not.toMatch(/\[(?:Role\.|"(?:Medical Manager|Marketing Manager|General Manager|Admin|Super Admin))/));
  it("requires a completion note and records canonical execution lineage", () => {
    expect(service).toContain("REQUEST_EXECUTION_NOTE_REQUIRED");
    expect(service).toContain("executedByUid: actorUid");
    expect(service).toContain("executionNote: text(input.comment)");
  });
  it("keeps Product context optional and does not gate execution on Product data", () => {
    expect(service).not.toMatch(/productIds|promotionGroupIds/);
  });
});
