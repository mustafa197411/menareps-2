import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Role, type Permissions, type User } from "../types";
import { canExportSampleReports, getDefaultSampleCapabilities, hasSampleCapability } from "./sampleAuthorization";
import { getSampleRequestStatusLabel, getVisibleSampleManagementTabs, resolveSampleManagementTab } from "./sampleWorkspace";

const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");
const management = source("../components/samples/SampleManagement.tsx");
const requests = source("../components/samples/SampleRequests.tsx");
const approvals = source("../components/samples/SampleApprovals.tsx");
const allocations = source("../components/samples/SampleAllocation.tsx");
const distribution = source("../components/samples/SampleDisbursedLog.tsx");
const inventory = source("../components/samples/SampleInventory.tsx");
const router = source("../components/SidebarPageRouter.tsx");

const user = (role: Role): User => ({ id: `U-${role}`, name: role, email: `${role}@test.local`, role, active: true, region: "", territory: "" } as User);
const permissions = (role: Role): Permissions => ({ sampleCapabilities: getDefaultSampleCapabilities(role) });
const tabs = (role: Role) => getVisibleSampleManagementTabs(user(role), permissions(role)).map(item => item.id);

describe("WP-S8 workspace architecture and consolidation", () => {
  it.each([
    ["samples-allocation", "allocations"], ["samples-approvals", "approvals"], ["samples-physician", "distribution"],
    ["samples-requests", "requests"], ["samples-inventory", "inventory"]
  ])("resolves old route %s into tab %s", (route, tab) => expect(resolveSampleManagementTab(route)).toBe(tab));

  it("routes old operational IDs through the SampleManagement shell", () => {
    expect(router).toContain("isSampleManagementRoute(activeView)");
    expect(router).toContain("<SampleManagement");
    expect(router.match(/<SampleAllocation/g)).toBeNull();
    expect(router.match(/<SampleApprovals/g)).toBeNull();
  });

  it("keeps Reports as an independently routed page", () => {
    expect(router).toContain('case "samples-reports"');
    expect(router).toContain("<SampleConsumptionReports");
    expect(management).not.toContain("SampleConsumptionReports");
  });

  it("composes the seven required tabs from reusable components", () => {
    for (const tab of ["overview", "catalog", "inventory", "requests", "approvals", "allocations", "distribution"]) expect(management).toContain(`activeTab === "${tab}"`);
    for (const component of ["SampleInventory", "SampleRequests", "SampleApprovals", "SampleAllocation", "SampleDisbursedLog"]) expect(management).toContain(`<${component}`);
  });

  it("gives a rep operational tabs but no approval or inventory management", () => {
    expect(tabs(Role.MEDICAL_REP)).toEqual(expect.arrayContaining(["overview", "catalog", "requests", "distribution"]));
    expect(tabs(Role.MEDICAL_REP)).not.toEqual(expect.arrayContaining(["approvals", "inventory"]));
    expect(hasSampleCapability(user(Role.MEDICAL_REP), "ALLOCATE_SAMPLE_STOCK", permissions(Role.MEDICAL_REP))).toBe(false);
  });

  it("follows supervisor capabilities with allocation but without SKU mutation", () => {
    expect(tabs(Role.MEDICAL_SUPERVISOR)).toEqual(expect.arrayContaining(["overview", "catalog", "requests", "approvals", "distribution"]));
    expect(hasSampleCapability(user(Role.MEDICAL_SUPERVISOR), "CREATE_SAMPLE_SKU", permissions(Role.MEDICAL_SUPERVISOR))).toBe(false);
    expect(hasSampleCapability(user(Role.MEDICAL_SUPERVISOR), "ALLOCATE_SAMPLE_STOCK", permissions(Role.MEDICAL_SUPERVISOR))).toBe(true);
  });

  it("gives Inventory Officer inventory and balance viewing without managerial allocation", () => { expect(tabs(Role.INVENTORY_OFFICER)).toEqual(expect.arrayContaining(["inventory", "allocations"])); expect(hasSampleCapability(user(Role.INVENTORY_OFFICER), "ALLOCATE_SAMPLE_STOCK", permissions(Role.INVENTORY_OFFICER))).toBe(false); });
  it("keeps Product Manager Catalog read-only", () => expect(hasSampleCapability(user(Role.PRODUCT_MANAGER), "CREATE_SAMPLE_SKU", permissions(Role.PRODUCT_MANAGER))).toBe(false));
  it("keeps canonical request lifecycle labels", () => expect(getSampleRequestStatusLabel("AWAITING_ALLOCATION", "en")).toBe("Approved — Awaiting Allocation"));

  it("does not restore Shipped or Delivered request mutation actions", () => {
    expect(requests).not.toContain("updateStatus");
    expect(requests).not.toContain('newStatus: "Shipped"');
    expect(requests).not.toContain('newStatus: "Delivered"');
  });

  it("keeps approval separate from allocation persistence", () => {
    expect(approvals).toContain("decideAuthorizedSampleRequest");
    expect(approvals).not.toContain("persistSampleRequestDecision");
    expect(approvals).not.toContain("allocateCanonicalSampleStock");
  });

  it("routes allocation through authenticated backend authority", () => expect(allocations).toContain("allocateSampleStock"));
  it("keeps standalone distribution history-only", () => { expect(distribution).toContain("History only"); expect(distribution).not.toContain("recordCanonicalSampleDistribution"); });
  it("routes receipt and security-sensitive adjustment through backend authority", () => { expect(inventory).toContain("receiveSampleStock"); expect(inventory).toContain("adjustSampleStock"); expect(inventory).not.toContain("adjustCanonicalSampleStock"); expect(inventory).not.toContain("products.stockQuantity"); });

  it("does not start central inventory listeners from the Catalog tab", () => {
    expect(inventory).toContain('workspaceSection !== "catalog"');
    expect(inventory).toContain("shouldListenToCentralInventory");
    expect(inventory).toContain("[SAMPLE_LISTENER_DIAGNOSTIC]");
  });

  it("preserves capability-gated operational export control", () => {
    expect(distribution).toContain("canExportSampleReports");
    expect(canExportSampleReports(user(Role.MEDICAL_REP), permissions(Role.MEDICAL_REP))).toBe(true);
    expect(canExportSampleReports(user(Role.MEDICAL_REP), { sampleCapabilities: { EXPORT_SAMPLE_REPORTS: false } })).toBe(false);
  });

  it("keeps the bilingual horizontally scrollable tab navigation", () => { expect(management).toContain("overflow-x-auto"); expect(management).toContain('dir={isRtl ? "rtl" : "ltr"}'); });
  it("scopes every Overview representative read without truncating hierarchy", () => { expect(management).toContain("subscribeToScopedSampleCollection"); expect(management).toContain("getAuthorizedSampleUserIds"); expect(management).not.toContain("slice(0, 30)"); });
});
