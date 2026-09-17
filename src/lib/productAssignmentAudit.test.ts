import { describe, expect, it } from "vitest";
import { auditProductAssignments } from "./productAssignmentAudit";

const user: any = { id: "U1", name: "Rep", email: "r@test", role: "Medical Representative", active: true, territory: "A", region: "D", assignmentSyncStatus: "COMPLETE" };
const product: any = { id: "P1", name: "Product", brand: "B", therapeuticArea: "T", price: 1, stock: 1, promotionGroupId: "G1" };
const group: any = { id: "G1", name: "Group", normalizedName: "group", isActive: true };
const assignment: any = { assignmentId: "PA1", userId: "U1", productId: "P1", productGroupId: "G1", status: "Active", active: true };
const territory: any = { assignmentId: "TA1", userId: "U1", countryId: "C", districtId: "D", cityId: "CT", areaId: "A", status: "Active", active: true };

describe("WP77F canonical Product Assignment Audit", () => {
  it("reports a canonical valid assignment without demo values", () => expect(auditProductAssignments({ users: [user], assignments: [assignment], products: [product], promotionGroups: [group], territoryAssignments: [territory] })).toMatchObject({ validCount: 1, anomalyCount: 0, generatedFromCanonicalData: true }));
  it("flags orphan users and incomplete sync", () => { const report = auditProductAssignments({ users: [{ ...user, assignmentSyncStatus: "FAILED" }], assignments: [assignment, { ...assignment, assignmentId: "PA2", userId: "MISSING" }], products: [product], promotionGroups: [group], territoryAssignments: [territory] }); expect(report.rows.find(row => row.userId === "U1")?.codes).toContain("INCOMPLETE_SYNC"); expect(report.rows.find(row => row.userId === "MISSING")?.codes).toContain("ORPHAN_USER"); });
  it("flags invalid products/groups, duplicates and missing geography", () => { const bad = { ...assignment, productId: "BAD", productGroupId: "BAD_GROUP" }; const report = auditProductAssignments({ users: [user], assignments: [bad, { ...bad, assignmentId: "PA2" }], products: [product], promotionGroups: [group], territoryAssignments: [] }); expect(report.rows[0].codes).toEqual(expect.arrayContaining(["INVALID_PRODUCT", "INVALID_PROMOTION_GROUP", "DUPLICATE_ASSIGNMENT", "NO_ACTIVE_GEOGRAPHY"])); });
});
