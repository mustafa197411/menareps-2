import { describe, expect, it } from "vitest";
import { Role, type User } from "../types";
import { canAccessGroup, canAccessView } from "./userPolicyEngine";
import {
  canActOnSampleRecord,
  canApproveSampleRequest,
  canExportSampleReports,
  getAuthorizedSampleUserIds,
  getDefaultSampleCapabilities,
  getSampleDataScope,
  hasSampleCapability
} from "./sampleAuthorization";

const manager = (id: string, role: Role, managerId?: string): User => ({ id, name: id, email: `${id}@test.local`, role, managerId, active: true });
const rep = (id: string, managerId: string): User => manager(id, Role.MEDICAL_REP, managerId);
const users = [
  manager("gm", Role.GENERAL_MANAGER),
  manager("mm", Role.MEDICAL_MANAGER, "gm"),
  manager("sup", Role.MEDICAL_SUPERVISOR, "mm"),
  rep("rep1", "sup"),
  manager("sup2", Role.MEDICAL_SUPERVISOR, "mm"),
  rep("rep2", "sup2"),
  manager("warehouse", Role.WAREHOUSE_MANAGER, "gm")
];
const byId = (id: string) => users.find(user => user.id === id)!;

describe("WP-S4 Samples authorization", () => {
  it("1. Medical Rep can create own Sample Request", () => {
    expect(hasSampleCapability(byId("rep1"), "CREATE_SAMPLE_REQUEST")).toBe(true);
    expect(canActOnSampleRecord(byId("rep1"), "rep1", users, "VIEW_OWN_SAMPLE_REQUESTS")).toBe(true);
  });
  it("2. Medical Rep cannot create or act for another rep", () => {
    expect(canActOnSampleRecord(byId("rep1"), "rep2", users, "VIEW_OWN_SAMPLE_REQUESTS")).toBe(false);
  });
  it("3. Medical Rep cannot approve own request", () => {
    expect(hasSampleCapability(byId("rep1"), "APPROVE_SAMPLE_REQUEST")).toBe(false);
  });
  it("4. Medical Rep cannot create Sample SKU", () => {
    expect(hasSampleCapability(byId("rep1"), "CREATE_SAMPLE_SKU")).toBe(false);
  });
  it("5. Medical Supervisor cannot create Sample SKU", () => {
    expect(hasSampleCapability(byId("sup"), "CREATE_SAMPLE_SKU")).toBe(false);
  });
  it("6. only Super Admin and Admin defaults create Sample SKU", () => {
    expect(getDefaultSampleCapabilities(Role.SUPER_ADMIN).CREATE_SAMPLE_SKU).toBe(true);
    expect(getDefaultSampleCapabilities(Role.ADMIN).CREATE_SAMPLE_SKU).toBe(true);
    expect(getDefaultSampleCapabilities(Role.PRODUCT_MANAGER).CREATE_SAMPLE_SKU).toBe(false);
    expect(hasSampleCapability(byId("warehouse"), "CREATE_SAMPLE_SKU")).toBe(false);
  });
  it("7. Supervisor can view and approve direct subordinate request", () => {
    expect(canActOnSampleRecord(byId("sup"), "rep1", users, "APPROVE_SAMPLE_REQUEST")).toBe(true);
  });
  it("8. Supervisor cannot approve unrelated rep request", () => {
    expect(canActOnSampleRecord(byId("sup"), "rep2", users, "APPROVE_SAMPLE_REQUEST")).toBe(false);
  });
  it("9. approval scope does not authorize self approval", () => {
    expect(canApproveSampleRequest(byId("sup"), "sup", users)).toBe(false);
  });
  it("10. Medical Rep cannot create allocation", () => {
    expect(hasSampleCapability(byId("rep1"), "ALLOCATE_SAMPLE_STOCK")).toBe(false);
  });
  it("11. managerial supervisor can allocate while warehouse custody cannot", () => {
    expect(hasSampleCapability(byId("sup"), "ALLOCATE_SAMPLE_STOCK")).toBe(true);
    expect(hasSampleCapability(byId("warehouse"), "ALLOCATE_SAMPLE_STOCK")).toBe(false);
  });
  it("12. Rep can read own balance", () => {
    expect(getSampleDataScope(byId("rep1"), "VIEW_OWN_SAMPLE_BALANCE")).toBe("OWN");
  });
  it("13. Rep cannot read another rep balance", () => {
    expect(canActOnSampleRecord(byId("rep1"), "rep2", users, "VIEW_OWN_SAMPLE_BALANCE")).toBe(false);
  });
  it("14. Rep has no allocation mutation capability", () => {
    expect(hasSampleCapability(byId("rep1"), "ALLOCATE_SAMPLE_STOCK")).toBe(false);
    expect(hasSampleCapability(byId("rep1"), "ADJUST_SAMPLE_STOCK")).toBe(false);
  });
  it("15. Rep distribution authority is own-scope only", () => {
    expect(hasSampleCapability(byId("rep1"), "DISTRIBUTE_SAMPLE")).toBe(true);
    expect(getSampleDataScope(byId("rep1"), "DISTRIBUTE_SAMPLE")).toBe("OWN");
  });
  it("16. Manager hierarchy includes authorized descendants", () => {
    expect(getAuthorizedSampleUserIds(byId("mm"), users, "TEAM")).toEqual(expect.arrayContaining(["mm", "sup", "rep1", "sup2", "rep2"]));
  });
  it("17. Warehouse has inventory authority without clinical approval authority", () => {
    expect(hasSampleCapability(byId("warehouse"), "RECEIVE_SAMPLE_STOCK")).toBe(true);
    expect(hasSampleCapability(byId("warehouse"), "APPROVE_SAMPLE_REQUEST")).toBe(false);
    expect(hasSampleCapability(byId("warehouse"), "DISTRIBUTE_SAMPLE")).toBe(false);
  });
  it("18. Sidebar and router use consistent Samples decisions", () => {
    for (const user of users) {
      const hasChild = ["sample-management", "samples-reports"]
        .some(view => canAccessView(user, view));
      expect(canAccessGroup(user, "samples")).toBe(hasChild);
    }
  });
  it("19. export requires both report view and export capabilities", () => {
    expect(canExportSampleReports(byId("rep1"))).toBe(true);
    expect(canExportSampleReports(byId("rep1"), { ...emptyPermissions, sampleCapabilities: { EXPORT_SAMPLE_REPORTS: false } })).toBe(false);
  });
  it("20. rolePermissions cannot override frozen exact-role master authority", () => {
    expect(hasSampleCapability(byId("rep1"), "CREATE_SAMPLE_SKU", { ...emptyPermissions, sampleCapabilities: { CREATE_SAMPLE_SKU: true } })).toBe(false);
    expect(hasSampleCapability(byId("rep1"), "ADJUST_SAMPLE_STOCK", { ...emptyPermissions, sampleCapabilities: { CREATE_SAMPLE_SKU: true } })).toBe(false);
  });
});

const emptyPermissions = {
  view: false, create: false, edit: false, delete: false, approve: false, export: false,
  import: false, assign: false, reassign: false, viewTeamData: false,
  viewNationalData: false, viewFinancialData: false
};
