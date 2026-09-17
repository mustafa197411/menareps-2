import { describe, expect, it } from "vitest";
import { Role, type Permissions, type User } from "../types";
import { getDefaultSampleCapabilities } from "./sampleAuthorization";
import { getAuthorizedInitialSampleTab, getSampleManagementRoute, getSampleRequestStatusLabel, getVisibleSampleManagementTabs, isSampleManagementRoute, resolveSampleManagementTab, SAMPLE_SIDEBAR_CHILDREN } from "./sampleWorkspace";

const user = (role: Role): User => ({ id: `user-${role}`, name: role, email: `${role}@test.local`, role, region: "", territory: "", status: "Active" } as User);
const permissions = (role: Role): Permissions => ({ sampleCapabilities: getDefaultSampleCapabilities(role) });
const tabs = (role: Role) => getVisibleSampleManagementTabs(user(role), permissions(role)).map(tab => tab.id);

describe("WP-S8 final unified Samples workspace", () => {
  it("exposes only Sample Management and Sample Reports in the Samples sidebar", () => {
    expect(SAMPLE_SIDEBAR_CHILDREN.map(item => item.id)).toEqual(["sample-management", "samples-reports"]);
  });

  it.each([
    ["samples-allocation", "allocations"], ["samples-approvals", "approvals"], ["samples-physician", "distribution"],
    ["samples-requests", "requests"], ["samples-inventory", "inventory"], ["sample-management?tab=catalog", "catalog"], ["samples-management?tab=catalog", "catalog"]
  ])("maps legacy route %s to workspace tab %s", (route, tab) => expect(resolveSampleManagementTab(route)).toBe(tab));

  it("keeps reports outside the Sample Management route map", () => expect(resolveSampleManagementTab("samples-reports")).toBe("overview"));

  it("generates the canonical singular workspace route", () => {
    expect(getSampleManagementRoute()).toBe("sample-management");
    expect(getSampleManagementRoute("allocations")).toBe("sample-management?tab=allocations");
  });

  it("treats every legacy operational route as the unified workspace", () => {
    expect(["samples-allocation", "samples-approvals", "samples-physician", "samples-requests", "samples-inventory"].every(isSampleManagementRoute)).toBe(true);
    expect(isSampleManagementRoute("samples-reports")).toBe(false);
  });

  it("gives Medical Representatives own workflow tabs without approvals or inventory", () => {
    expect(tabs(Role.MEDICAL_REP)).toEqual(expect.arrayContaining(["overview", "catalog", "requests", "allocations", "distribution"]));
    expect(tabs(Role.MEDICAL_REP)).not.toEqual(expect.arrayContaining(["inventory", "approvals"]));
  });

  it("does not expose Sample SKU creation through supervisor capabilities", () => {
    expect(permissions(Role.MEDICAL_SUPERVISOR).sampleCapabilities?.CREATE_SAMPLE_SKU).toBe(false);
    expect(tabs(Role.MEDICAL_SUPERVISOR)).toContain("approvals");
  });

  it("exposes read-only Catalog to Product Manager", () => {
    expect(permissions(Role.PRODUCT_MANAGER).sampleCapabilities?.CREATE_SAMPLE_SKU).toBe(false);
    expect(tabs(Role.PRODUCT_MANAGER)).toContain("catalog");
  });

  it("exposes Inventory and balance tab to Inventory Officer without managerial allocation", () => {
    expect(tabs(Role.INVENTORY_OFFICER)).toEqual(expect.arrayContaining(["inventory", "allocations"]));
    expect(permissions(Role.INVENTORY_OFFICER).sampleCapabilities?.ALLOCATE_SAMPLE_STOCK).toBe(false);
  });

  it("falls back from an unauthorized requested tab", () => {
    expect(getAuthorizedInitialSampleTab(user(Role.MEDICAL_REP), "approvals", permissions(Role.MEDICAL_REP))).toBe("overview");
  });

  it("distinguishes approval awaiting allocation from allocated stock", () => {
    expect(getSampleRequestStatusLabel("AWAITING_ALLOCATION", "en")).toBe("Approved — Awaiting Allocation");
    expect(getSampleRequestStatusLabel("ALLOCATED", "en")).toBe("Allocated — Stock Available");
  });
});
