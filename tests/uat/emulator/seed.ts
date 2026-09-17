import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { accessGovernanceFixture, GEOGRAPHY_FIXTURES, PRODUCT_FIXTURES, rolePermissionFixture } from "./fixtures";
import { assertProductionIsolation } from "./preflight";
import { emulatorEmail, emulatorPassword, UAT_IDENTITIES, type UatIdentity } from "./roles";
import { resetEmulatorState } from "./reset";
import { UAT_PROJECT_ID, UAT_STORAGE_BUCKET } from "./constants";
import { ENTERPRISE_WORKFLOW_TEMPLATE } from "../../../src/features/orders/orderWorkflowTemplate";
import { marketDateForInstant } from "../../../src/lib/marketSettings";

const NEGATIVE_IDENTITIES: readonly UatIdentity[] = [
  { uid: "uat-inactive-admin", role: UAT_IDENTITIES[1].role, scopeMode: "ORGANIZATION", areaIds: [], productIds: [] },
  { uid: "uat-sales-rep-west-b", role: UAT_IDENTITIES[9].role, managerId: "uat-sales-supervisor", scopeMode: "SELF", countryId: "LY", districtId: "WEST", cityId: "TRIPOLI", areaIds: ["WEST-A2"], productIds: ["P-B"] },
  { uid: "uat-medical-rep-west-b", role: UAT_IDENTITIES[15].role, managerId: "uat-medical-supervisor-other", scopeMode: "SELF", countryId: "LY", districtId: "WEST", cityId: "TRIPOLI", areaIds: ["WEST-A2"], productIds: ["P-B"] },
  { uid: "uat-medical-supervisor-other", role: UAT_IDENTITIES[14].role, managerId: "uat-medical-manager", scopeMode: "DESCENDANTS", countryId: "LY", districtId: "WEST", cityId: "TRIPOLI", areaIds: ["WEST-A2"], productIds: ["P-B"] },
];

export function syntheticProfile(identity: UatIdentity, active = true) {
  return {
    id: identity.uid,
    uid: identity.uid,
    email: emulatorEmail(identity),
    name: `Synthetic ${identity.role}`,
    role: identity.role,
    active,
    status: active ? "Active" : "Inactive",
    employmentStatus: active ? "Active" : "Inactive",
    loginAllowed: active,
    isDeleted: false,
    operationalStatus: active ? "Operational" : "Inactive",
    securityScope: identity.securityScope ?? (identity.scopeMode === "SELF" ? "Self Only" : identity.scopeMode === "ORGANIZATION" ? "National" : "Subordinates Only"),
    managerId: identity.managerId ?? null,
    managerUid: identity.managerId ?? null,
    country: identity.countryId ?? "",
    countryId: identity.countryId ?? "",
    region: identity.districtId ?? "",
    districtId: identity.districtId ?? "",
    city: identity.cityId ?? "",
    cityId: identity.cityId ?? "",
    areaIds: identity.areaIds,
    productIds: identity.productIds,
    primaryPromotionGroupId: identity.primaryPromotionGroupId ?? null,
    targetPromotionGroupIds: identity.targetPromotionGroupIds ?? [],
    assignmentSyncStatus: "COMPLETE",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

export function territoryAssignmentsForIdentity(identity: UatIdentity) {
  return identity.areaIds.map((areaId) => {
    const matches = GEOGRAPHY_FIXTURES.areas.filter((area) => area.id === areaId);
    if (matches.length !== 1) {
      throw new Error(`[MENAREPS UAT] Synthetic Area ${areaId} must resolve to exactly one canonical fixture.`);
    }
    const area = matches[0];
    if (
      (identity.countryId && identity.countryId !== area.countryId)
      || (identity.districtId && identity.districtId !== area.districtId)
      || (identity.cityId && identity.cityId !== area.cityId)
    ) {
      throw new Error(`[MENAREPS UAT] Synthetic identity ${identity.uid} has invalid canonical geography ancestry for Area ${areaId}.`);
    }
    return {
      assignmentId: `TA_${identity.uid}_${area.id}`,
      userId: identity.uid,
      userRole: identity.role,
      countryId: area.countryId,
      regionId: area.districtId,
      districtId: area.districtId,
      cityId: area.cityId,
      areaId: area.id,
      territoryId: area.id,
      territoryName: area.name,
      assignmentType: identity.role.includes("Medical") ? "medical" : identity.role.includes("Sales") ? "sales" : "manager",
      status: "Active",
      active: true,
      assignedBy: "MENAREPS_UAT_HARNESS",
      assignedAt: FieldValue.serverTimestamp(),
    };
  });
}

export async function seedEmulatorState(): Promise<void> {
  assertProductionIsolation();
  await resetEmulatorState();
  const existing = getApps().find(app => app.name === "menareps-uat-seed");
  const app = existing ?? initializeApp({ projectId: UAT_PROJECT_ID, storageBucket: UAT_STORAGE_BUCKET }, "menareps-uat-seed");
  const auth = getAuth(app);
  const db = getFirestore(app);
  const identities = [...UAT_IDENTITIES, ...NEGATIVE_IDENTITIES];

  for (const identity of identities) {
    await auth.createUser({ uid: identity.uid, email: emulatorEmail(identity), password: emulatorPassword(identity), emailVerified: true, disabled: false });
    await db.collection("users").doc(identity.uid).set(syntheticProfile(identity, identity.uid !== "uat-inactive-admin"));
  }
  await auth.createUser({ uid: "uat-profile-less", email: "uat-profile-less@menareps-uat.test", password: emulatorPassword({ uid: "uat-profile-less" } as UatIdentity), emailVerified: true });
  await db.collection("users").doc("uat-unknown-role").set({ id: "uat-unknown-role", role: "Unknown Role", active: true, status: "Active" });

  for (const identity of UAT_IDENTITIES) {
    await db.collection("rolePermissions").doc(identity.role).set(rolePermissionFixture(identity));
    await db.collection("accessGovernance").doc(identity.role).set(accessGovernanceFixture(identity));
  }

  for (const [collection, records] of Object.entries(GEOGRAPHY_FIXTURES)) {
    for (const record of records) await db.collection(collection).doc(record.id).set(record);
  }
  for (const identity of identities) {
    for (const assignment of territoryAssignmentsForIdentity(identity)) {
      await db.collection("userTerritoryAssignments").doc(assignment.assignmentId).set(assignment);
    }
  }
  for (const product of PRODUCT_FIXTURES) await db.collection("products").doc(product.id).set(product);
  for (const group of [
    { id: "PG-A", name: "Synthetic Group A", marketId: "LY", active: true },
    { id: "PG-B", name: "Synthetic Group B", marketId: "LY", active: true },
    { id: "PG-OUTSIDE", name: "Synthetic Outside Group", marketId: "JO", active: true },
  ]) await db.collection("productPromotionGroups").doc(group.id).set(group);

  const medicalScenarioRecords = [
    ["physicians", "PHY-MED-IN", {
      id: "PHY-MED-IN", name: "Synthetic In-Scope Physician", specialty: "Synthetic Specialty", classification: "A",
      active: true, status: "Active", areaId: "WEST-A1", countryId: "LY", districtId: "WEST", cityId: "TRIPOLI",
      area: "UAT Area 1", territory: "WEST-A1", region: "WEST", address: "Synthetic Clinic One",
      latitude: 32.9, longitude: 13.1, gpsVerified: true, gpsVerificationStatus: "VERIFIED",
      primaryPromotionGroupId: "PG-A", targetPromotionGroupIds: ["PG-B"], alignedProductIds: ["P-A", "P-B"],
      assignedRepId: "uat-medical-rep-west-a", assignedSupervisorId: "uat-medical-supervisor", assignedManagerId: "uat-medical-manager",
    }],
    ["physicians", "PHY-MED-OUT", {
      id: "PHY-MED-OUT", name: "Synthetic Out-of-Scope Physician", specialty: "Synthetic Specialty", classification: "B",
      active: true, status: "Active", areaId: "WEST-A2", countryId: "LY", districtId: "WEST", cityId: "TRIPOLI",
      area: "UAT Area 2", territory: "WEST-A2", region: "WEST", address: "Synthetic Clinic Two",
      latitude: 32.8, longitude: 13.2, gpsVerified: true, gpsVerificationStatus: "VERIFIED",
      primaryPromotionGroupId: "PG-B", targetPromotionGroupIds: [], alignedProductIds: ["P-B"],
      assignedRepId: "uat-medical-rep-west-b", assignedSupervisorId: "uat-medical-supervisor-other", assignedManagerId: "uat-medical-manager",
    }],
    ["keyMessages", "KM-P-A", {
      id: "KM-P-A", productId: "P-A", productName: "Synthetic Product A", brandId: "P-A", brandName: "Synthetic Product A",
      promotionGroupId: "PG-A", message: "Synthetic canonical primary message", messageContent: "Synthetic canonical primary message",
      therapeuticArea: "Synthetic Therapy", active: true, isApproved: true, detailingSequence: 1,
    }],
    ["sampleCatalog", "SKU-P-A-ONE", {
      id: "SKU-P-A-ONE", sampleSkuId: "SKU-P-A-ONE", productId: "P-A", name: "Synthetic Sample Unit", skuCode: "UAT-SKU-A",
      active: true, status: "ACTIVE",
    }],
    ["sampleBatches", "BATCH-P-A-FEFO", {
      id: "BATCH-P-A-FEFO", batchId: "BATCH-P-A-FEFO", sampleSkuId: "SKU-P-A-ONE", batchNumber: "UAT-BATCH-A",
      active: true, status: "AVAILABLE", expiryDate: "2035-12-31", receivedQuantity: 20, availableQuantity: 20,
      createdAt: "2030-01-01T08:00:00.000Z", createdBy: "uat-warehouse-manager",
    }],
    ["sampleAllocations", "ALLOC-MED-A", {
      id: "ALLOC-MED-A", allocationId: "ALLOC-MED-A", repId: "uat-medical-rep-west-a", representativeUid: "uat-medical-rep-west-a",
      productId: "P-A", sampleSkuId: "SKU-P-A-ONE", batchId: "BATCH-P-A-FEFO", quantityAllocated: 20,
      quantityRemaining: 20, consumedQuantity: 0, active: true, status: "ACTIVE", allocatedAt: "2030-01-01T08:00:00.000Z",
    }],
  ] as const;
  for (const [collection, id, data] of medicalScenarioRecords) await db.collection(collection).doc(id).set(data);

  for (const identity of identities) {
    for (const productId of identity.productIds) {
      const product = PRODUCT_FIXTURES.find(candidate => candidate.id === productId);
      if (!product?.promotionGroupId) {
        throw new Error(`Synthetic Product assignment requires canonical Promotion Group metadata: ${productId}`);
      }
      await db.collection("userProductAssignments").doc(`PA_${identity.uid}_${productId}`).set({
        assignmentId: `PA_${identity.uid}_${productId}`, userId: identity.uid, repId: identity.uid,
        productId, productGroupId: product.promotionGroupId, active: true, status: "Active", syncStatus: "COMPLETE",
        countryId: identity.countryId ?? "", areaIds: identity.areaIds,
      });
    }
  }

  const scopedRecords = [
    ["pharmacies", "PHARM-COMM-A", { id: "PHARM-COMM-A", name: "Synthetic In-Scope Pharmacy", active: true, status: "Active", areaId: "WEST-A1", countryId: "LY", marketId: "LY", territory: "LY / WEST / TRIPOLI / WEST-A1", region: "WEST", address: "Synthetic Pharmacy Address", assignedRepId: "uat-sales-rep-west-a", outstandingBalance: 0, gpsVerified: true, gpsVerificationStatus: "VERIFIED", latitude: 32.9, longitude: 13.1 }],
    ["pharmacies", "PHARM-COMM-OUT", { id: "PHARM-COMM-OUT", name: "Synthetic Out-of-Scope Pharmacy", active: true, status: "Active", areaId: "WEST-A2", countryId: "LY", marketId: "LY", assignedRepId: "uat-sales-rep-west-b", outstandingBalance: 0 }],
    ["attendanceSessions", "ATT-MED-A", { userId: "uat-medical-rep-west-a", marketId: "LY", areaId: "WEST-A1", date: "2030-01-02", status: "CLOSED" }],
    ["attendanceSessions", "ATT-MED-B", { userId: "uat-medical-rep-west-b", marketId: "LY", areaId: "WEST-A2", date: "2030-01-02", status: "CLOSED" }],
    ["physicianVisits", "VIS-MED-A", { repId: "uat-medical-rep-west-a", physicianId: "PHY-A", areaId: "WEST-A1", productIds: ["P-A"], visitDate: "2030-01-02", status: "COMPLETED" }],
    ["physicianVisits", "VIS-MED-B", { repId: "uat-medical-rep-west-b", physicianId: "PHY-B", areaId: "WEST-A2", productIds: ["P-B"], visitDate: "2030-01-02", status: "COMPLETED" }],
    ["orders", "ORD-SALES-A", { repId: "uat-sales-rep-west-a", marketId: "LY", areaId: "WEST-A1", productIds: ["P-A"], status: "PENDING_FINANCE_REVIEW", currencyCode: "LYD", total: 10 }],
    ["orders", "ORD-OUTSIDE", { repId: "uat-sales-rep-west-b", marketId: "JO", areaId: "JO-A1", productIds: ["P-OUTSIDE"], status: "PENDING_FINANCE_REVIEW", currencyCode: "JOD", total: 10 }],
  ] as const;
  for (const [collection, id, data] of scopedRecords) await db.collection(collection).doc(id).set(data);

  await db.collection("marketSettings").doc("LY").set({
    marketId: "LY", countryId: "LY", countryNameEn: "Synthetic Market", countryNameAr: "سوق اختباري", active: true,
    businessDocumentCode: "UT", currencyCode: "TST", currencySymbol: "¤", symbolPosition: "before", decimalPlaces: 2,
    numeralLocale: "en", timezone: "Africa/Tripoli", dateFormat: "YYYY-MM-DD", timeFormat: "24h", weekStartDay: 1,
    workingWeekdays: [1, 2, 3, 4, 5], normalWorkdayStart: "08:00", normalWorkdayEnd: "16:00",
    checkInOpensAt: "07:30", lateToleranceMinutes: 15, autoCheckoutAt: "18:00", maximumWorkdayMinutes: 600,
  });
  await db.collection("businessCalendarExceptions").doc("LY-2030-01-01").set({ marketId: "LY", date: "2030-01-01", type: "PUBLIC_HOLIDAY", active: true });
  const currentMarketDate = marketDateForInstant(new Date(), "Africa/Tripoli");
  await db.collection("businessCalendarExceptions").doc(`LY-UAT-${currentMarketDate}`).set({
    id: `LY-UAT-${currentMarketDate}`, marketId: "LY", countryId: "LY", date: currentMarketDate,
    nameEn: "Synthetic certification working day", nameAr: "يوم عمل اختباري", type: "EXCEPTIONAL_WORKING", active: true,
    createdBy: "UAT_SEED", createdAt: new Date().toISOString(), updatedBy: "UAT_SEED", updatedAt: new Date().toISOString(),
  });
  await db.collection("orderWorkflowTemplates").doc(ENTERPRISE_WORKFLOW_TEMPLATE.templateId).set({ ...ENTERPRISE_WORKFLOW_TEMPLATE, createdBy: "UAT_SEED", updatedBy: "UAT_SEED" });

  if (!existing) await deleteApp(app);
}

if (process.argv[1]?.endsWith("seed.ts")) {
  await seedEmulatorState();
  console.log("MENAREPS_UAT_SEED=PASS");
}
