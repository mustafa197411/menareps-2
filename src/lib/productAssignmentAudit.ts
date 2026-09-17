import type { Product, ProductPromotionGroup, User, UserProductAssignment, UserTerritoryAssignment } from "../types";

export type AssignmentAuditCode = "OK" | "ORPHAN_USER" | "INVALID_PRODUCT" | "INVALID_PROMOTION_GROUP" | "DUPLICATE_ASSIGNMENT" | "NO_ACTIVE_GEOGRAPHY" | "INCOMPLETE_SYNC";
export interface ProductAssignmentAuditRow { assignmentId: string; userId: string; userName: string; productId: string; productName: string; productGroupId: string; productGroupName: string; geography: string; codes: AssignmentAuditCode[]; valid: boolean }
export interface ProductAssignmentAuditReport { rows: ProductAssignmentAuditRow[]; anomalyCount: number; validCount: number; generatedFromCanonicalData: true }

const active = (value: { active?: boolean; status?: string }) => value.active !== false && value.status !== "Inactive";

export function auditProductAssignments(input: { users: User[]; assignments: UserProductAssignment[]; products: Product[]; promotionGroups: ProductPromotionGroup[]; territoryAssignments: UserTerritoryAssignment[] }): ProductAssignmentAuditReport {
  const users = new Map(input.users.map(user => [user.id || user.uid || "", user]));
  const products = new Map(input.products.map(product => [product.id, product]));
  const groups = new Map(input.promotionGroups.map(group => [group.id, group]));
  const duplicateKeys = new Map<string, number>();
  input.assignments.filter(active).forEach(item => { const key = `${item.userId}::${item.productId}`; duplicateKeys.set(key, (duplicateKeys.get(key) || 0) + 1); });
  const rows = input.assignments.filter(active).map(assignment => {
    const user = users.get(assignment.userId); const product = products.get(assignment.productId); const groupId = assignment.productGroupId || product?.promotionGroupId || ""; const group = groups.get(groupId);
    const territories = input.territoryAssignments.filter(item => item.userId === assignment.userId && active(item));
    const codes: AssignmentAuditCode[] = [];
    if (!user) codes.push("ORPHAN_USER");
    if (!product) codes.push("INVALID_PRODUCT");
    if (!groupId || !group || group.isActive === false) codes.push("INVALID_PROMOTION_GROUP");
    if ((duplicateKeys.get(`${assignment.userId}::${assignment.productId}`) || 0) > 1) codes.push("DUPLICATE_ASSIGNMENT");
    if (territories.length === 0) codes.push("NO_ACTIVE_GEOGRAPHY");
    if (user && user.assignmentSyncStatus !== "COMPLETE") codes.push("INCOMPLETE_SYNC");
    if (codes.length === 0) codes.push("OK");
    const geography = territories.map(item => [item.countryId, item.districtId, item.cityId, item.territoryId].filter(Boolean).join(" / ")).sort().join(", ");
    return { assignmentId: assignment.assignmentId, userId: assignment.userId, userName: user?.name || user?.email || assignment.userId, productId: assignment.productId, productName: product?.name || assignment.productNameSnapshot || assignment.productId, productGroupId: groupId, productGroupName: group?.name || assignment.productGroupNameSnapshot || groupId, geography, codes, valid: codes.length === 1 && codes[0] === "OK" };
  }).sort((a, b) => a.assignmentId.localeCompare(b.assignmentId));
  return { rows, anomalyCount: rows.filter(row => !row.valid).length, validCount: rows.filter(row => row.valid).length, generatedFromCanonicalData: true };
}
