import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { ENTERPRISE_WORKFLOW_TEMPLATE } from "../src/features/orders/orderWorkflowTemplate";
import { assertProductionSnapshotIdentity, validateProductionReadiness, type ProductionReadinessSnapshot, type ReadinessRow } from "./productionReadinessValidator";

const row = (id: string, value: Record<string, unknown> = {}): ReadinessRow => ({ id, ...value });
function validSnapshot(): ProductionReadinessSnapshot {
  const user = row("REP-1", { uid: "REP-1", email: "rep@example.invalid", name: "Representative", role: "Medical Representative", active: true, status: "Active", employmentStatus: "Active", accountStatus: "ACTIVE", loginAllowed: true, isDeleted: false, managerId: "SUP-1", primaryPromotionGroupId: "PG-1", assignmentSyncStatus: "COMPLETE" });
  const supervisor = row("SUP-1", { uid: "SUP-1", email: "supervisor@example.invalid", name: "Supervisor", role: "Medical Supervisor", active: true, status: "Active", employmentStatus: "Active", accountStatus: "ACTIVE", loginAllowed: true, isDeleted: false, managerId: "MM-1" });
  const manager = row("MM-1", { uid: "MM-1", email: "manager@example.invalid", name: "Manager", role: "Medical Manager", active: true, status: "Active", employmentStatus: "Active", accountStatus: "ACTIVE", loginAllowed: true, isDeleted: false, managerId: "GM-1" });
  const general = row("GM-1", { uid: "GM-1", email: "general@example.invalid", name: "General", role: "General Manager", active: true, status: "Active", employmentStatus: "Active", accountStatus: "ACTIVE", loginAllowed: true, isDeleted: false, managerId: "ADMIN-1" });
  const admin = row("ADMIN-1", { uid: "ADMIN-1", email: "admin@example.invalid", name: "Admin", role: "Admin", active: true, status: "Active", employmentStatus: "Active", accountStatus: "ACTIVE", loginAllowed: true, isDeleted: false, managerId: "ROOT-1" });
  const root = row("ROOT-1", { uid: "ROOT-1", email: "root@example.invalid", name: "Root", role: "Super Admin", active: true, status: "Active", employmentStatus: "Active", accountStatus: "ACTIVE", loginAllowed: true, isDeleted: false });
  const users = [user, supervisor, manager, general, admin, root];
  const permissions = [...new Set(users.map(item => String(item.role)))].map(role => row(role, { active: true, view: true }));
  const market = row("MARKET-1", { marketId: "MARKET-1", countryId: "COUNTRY-1", countryNameEn: "Country", countryNameAr: "بلد", active: true, businessDocumentCode: "CT", currencyCode: "CUR", currencySymbol: "¤", symbolPosition: "AFTER", decimalPlaces: 2, numeralLocale: "en", timezone: "UTC", dateFormat: "YYYY-MM-DD", timeFormat: "24H", weekStartDay: 1, workingWeekdays: [1, 2, 3, 4, 5], normalWorkdayStart: "08:00", normalWorkdayEnd: "16:00", checkInOpensAt: "07:30", lateToleranceMinutes: 15, autoCheckoutAt: "18:00", maximumWorkdayMinutes: 600 });
  return {
    metadata: { projectId: "production-project", databaseId: "(default)", mode: "PRODUCTION_READ_ONLY_EXPORT" },
    authUsers: users.map(item => ({ uid: item.id, email: String(item.email) })),
    external: { firestorePitrConfigured: true, verifiedBackupExport: true, storageBucketConfigured: true, storageProtectionConfigured: true, schedulerAudienceConfigured: true, schedulerServiceAccountConfigured: true },
    collections: {
      users, rolePermissions: permissions,
      countries: [row("COUNTRY-1", { active: true })], districts: [row("DISTRICT-1", { countryId: "COUNTRY-1", active: true })], cities: [row("CITY-1", { countryId: "COUNTRY-1", districtId: "DISTRICT-1", active: true })], areas: [row("AREA-1", { countryId: "COUNTRY-1", districtId: "DISTRICT-1", cityId: "CITY-1", active: true })],
      marketSettings: [market], productPromotionGroups: [row("PG-1", { active: true })], products: [row("PRODUCT-1", { active: true, promotionGroupId: "PG-1", price: 1 })],
      userTerritoryAssignments: [row("TA-1", { userId: "REP-1", areaId: "AREA-1", countryId: "COUNTRY-1", districtId: "DISTRICT-1", cityId: "CITY-1", active: true, status: "Active" })],
      userProductAssignments: [row("PA-1", { userId: "REP-1", productId: "PRODUCT-1", productGroupId: "PG-1", active: true, status: "Active" })],
      physicianSpecialties: [row("SPECIALTY-1", { active: true })], physicians: [row("PHYSICIAN-1", { active: true, areaId: "AREA-1", specialtyId: "SPECIALTY-1", primaryPromotionGroupId: "PG-1", alignedProductIds: ["PRODUCT-1"] })],
      pharmacies: [row("PHARMACY-1", { active: true, areaId: "AREA-1" })], customerFinancialProfiles: [], keyMessages: [row("MESSAGE-1", { active: true, productId: "PRODUCT-1" })],
      orderWorkflowTemplates: [row("ENTERPRISE_V1", { ...ENTERPRISE_WORKFLOW_TEMPLATE, createdBy: "ADMIN-1", updatedBy: "ADMIN-1" })], businessDocumentSequences: [], businessCalendarExceptions: [], sampleCatalog: [], sampleBatches: [], sampleAllocations: [],
    },
  };
}

describe("PR-5 production configuration readiness", () => {
  it("passes a canonical snapshot with explicit warnings for lazy optional data", () => {
    const report = validateProductionReadiness(validSnapshot());
    expect(report.status).toBe("PASS");
    expect(report.failures).toBe(0);
    expect(report.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(["CUSTOMER_PROFILE_WILL_INITIALIZE_ON_FIRST_POSTING", "SEQUENCES_WILL_INITIALIZE_TRANSACTIONALLY", "SAMPLE_DISTRIBUTION_NOT_CONFIGURED"]));
  });

  it("fails duplicate identity, invalid assignments, missing external gates, and certification data", () => {
    const snapshot = validSnapshot();
    snapshot.authUsers.push({ uid: "OTHER", email: snapshot.authUsers[0].email });
    snapshot.collections.userTerritoryAssignments[0].areaId = "MISSING";
    snapshot.collections.products[0].active = false;
    snapshot.external.verifiedBackupExport = false;
    snapshot.collections.pharmacies.push(row("uat-pharmacy", { active: true, areaId: "AREA-1" }));
    const codes = validateProductionReadiness(snapshot).issues.map(issue => issue.code);
    expect(codes).toEqual(expect.arrayContaining(["DUPLICATE_AUTH_EMAIL", "ORPHAN_OR_MISMATCHED_TERRITORY_ASSIGNMENT", "ORPHAN_OR_MISMATCHED_PRODUCT_ASSIGNMENT", "VERIFIED_BACKUP_EXPORT_REQUIRED", "CERTIFICATION_RECORD_IN_AUTHORITATIVE_COLLECTION"]));
  });

  it("fails closed on project/database mismatch, demo identities, and emulator configuration", () => {
    const metadata = validSnapshot().metadata;
    expect(() => assertProductionSnapshotIdentity(metadata, "other", "(default)", {})).toThrow("PRODUCTION_VALIDATION_IDENTITY_MISMATCH");
    expect(() => assertProductionSnapshotIdentity({ ...metadata, projectId: "demo-project" }, "demo-project", "(default)", {})).toThrow("PRODUCTION_VALIDATION_ISOLATION_REQUIRED");
    expect(() => assertProductionSnapshotIdentity(metadata, "production-project", "(default)", { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8089" })).toThrow("PRODUCTION_VALIDATION_ISOLATION_REQUIRED");
  });

  it("keeps the CLI read-only and free of Firebase connectivity or repair behavior", () => {
    const source = fs.readFileSync(new URL("./productionReadinessCli.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/firebase-admin|initializeApp|getFirestore|\.set\(|\.update\(|\.delete\(|writeBatch|runTransaction/);
    expect(source).toContain("fs.readFileSync");
    expect(source).toContain("assertProductionSnapshotIdentity");
  });
});
