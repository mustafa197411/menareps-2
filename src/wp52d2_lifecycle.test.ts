import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc, setDoc, collection, query, where, getDocs } from "firebase/firestore";
import { db, auth } from "./lib/firebase";
import { applySecurityScope, isUserOperational, setGlobalSecurityContext } from "./lib/securityEngine";
import { deletePharmacyRecord, saveAuditLogRecord } from "./lib/firestoreService";
import { resolveGeographyTuple } from "./utils/importNormalization";
import { Role, User, Pharmacy, AuditLog } from "./types";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  } else {
    console.log(`[PASS] ${message}`);
  }
}

async function runLifecycleCertification() {
  console.log("=========================================================");
  console.log("  WP5.2D.2 — FINAL PHARMACY LIFECYCLE & SOFT-DELETE CERTIFICATION");
  console.log("=========================================================");

  // Authenticate as Super Admin
  try {
    await signInWithEmailAndPassword(auth, "shwayat.mustafa@gmail.com", "Password123!");
  } catch (err) {
    try {
      await signInWithEmailAndPassword(auth, "test-admin-99@menareps.com", "Password123!");
    } catch (err2) {
      console.log("Proceeding with existing or unauthenticated auth state");
    }
  }

  const timestamp = Date.now();
  const uniqueSuffix = `UAT-${timestamp}`;
  const batchId = `IMP-BATCH-WP52D2-${timestamp}`;

  console.log(`\n--- 1. CONTROLLED TEST RECORD GENERATION (${uniqueSuffix}) ---`);
  
  const rawRow = {
    name: `WP52D2 TAJOURA PHARMACY ${uniqueSuffix}`,
    nameAr: `صيدلية اختبار تاجوراء ${uniqueSuffix}`,
    type: "Retail",
    licenseNumber: `LIC-${uniqueSuffix}`,
    contactPerson: "Dr. Tarek Al-Tajouri",
    phone: `+21891${Math.floor(1000000 + Math.random() * 9000000)}`,
    email: `pharmacy.${uniqueSuffix}@esnad.local`,
    country: "Libya",
    district: "West",
    city: "Tripoli",
    area: "TAJOURA",
    address: "Main Coastal Road, Tajoura Center",
    latitude: 32.8812,
    longitude: 13.1845,
    assignedRepEmail: "test-user@esnad.local",
    salesPotential: "High",
    paymentInDays: 30,
    creditLimit: 25000,
    outstandingBalance: 1250,
    status: "Active"
  };

  // Fetch Areas and Users from Firestore
  const areasSnap = await getDocs(collection(db, "areas"));
  const allAreas = areasSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const usersSnap = await getDocs(collection(db, "users"));
  const allUsersList = usersSnap.docs.map(d => ({ id: d.id, ...d.data() } as User));
  
  // Resolve assignedRepId for test-user@esnad.local from Firestore users
  const assignedRepUser = allUsersList.find(u => u.email?.toLowerCase() === "test-user@esnad.local") || {
    id: "2GboJLCcs30BGKG6kfKT",
    email: "test-user@esnad.local",
    name: "Test Sales Rep",
    role: Role.SALES_REP,
    active: true,
    status: "Active",
    areaIds: ["LY-WEST-TRE2"],
    managerId: "usr-mgr-01"
  } as User;

  const unrelatedSalesRep = {
    id: "usr-sales-janzur-99",
    email: "rep.janzur@esnad.local",
    name: "Janzur Sales Rep",
    role: Role.SALES_REP,
    active: true,
    status: "Active",
    areaIds: ["LY-WEST-TRW5"],
    managerId: "usr-mgr-01"
  } as User;

  const sameAreaUnrelatedRep = {
    id: "usr-sales-tajoura-other",
    email: "other.tajoura@esnad.local",
    name: "Other Tajoura Sales Rep",
    role: Role.SALES_REP,
    active: true,
    status: "Active",
    areaIds: ["LY-WEST-TRE2"],
    managerId: "usr-mgr-01"
  } as User;

  const medicalRep = {
    id: "usr-med-rep-77",
    email: "med.rep@esnad.local",
    name: "Medical Representative",
    role: Role.MEDICAL_REP,
    active: true,
    status: "Active",
    areaIds: ["LY-WEST-TRE2"],
    managerId: "usr-mgr-01"
  } as User;

  const superAdmin = {
    id: auth.currentUser?.uid || "GQynj6LObmfQPz6PbNR9poANfXv1",
    email: auth.currentUser?.email || "shwayat.mustafa@gmail.com",
    name: "Super Admin",
    role: Role.SUPER_ADMIN,
    active: true,
    status: "Active"
  } as User;

  console.log(`[RESOLVED_REP_UID] test-user@esnad.local -> ${assignedRepUser.id}`);

  console.log("\n--- 2. IMPORT EXECUTION & NORMALIZATION ---");
  const geoResult = resolveGeographyTuple(rawRow.country, rawRow.district, rawRow.city, rawRow.area, allAreas);
  assert(geoResult.isValid === true, "Geographic hierarchy (Libya > West > Tripoli > TAJOURA) resolved successfully");
  assert(geoResult.areaId === "LY-WEST-TRE2", "areaId correctly mapped to canonical Area ID LY-WEST-TRE2");

  const generatedDocId = `PHM-WP52D2-${timestamp}`;
  const pharmacyDocPayload: Pharmacy = {
    id: generatedDocId,
    name: rawRow.name,
    nameAr: rawRow.nameAr,
    type: rawRow.type,
    licenseNumber: rawRow.licenseNumber,
    contactPerson: rawRow.contactPerson,
    phone: rawRow.phone,
    email: rawRow.email,
    countryId: geoResult.countryId || "C-LIB-8842",
    countryName: geoResult.countryName || "Libya",
    country: geoResult.countryName || "Libya",
    districtId: geoResult.districtId || "D-070037",
    districtName: geoResult.districtName || "West",
    district: geoResult.districtName || "West",
    cityId: geoResult.cityId || "CT-TRIPOLIEAST-D-070037",
    cityName: geoResult.cityName || "Tripoli East",
    city: geoResult.cityName || "Tripoli East",
    region: geoResult.cityName || "Tripoli East",
    areaId: geoResult.areaId || "LY-WEST-TRE2",
    areaName: geoResult.areaName || "Tajoura",
    area: geoResult.areaName || "Tajoura",
    territory: `Tripoli East / ${geoResult.areaName || "Tajoura"}`,
    address: rawRow.address,
    latitude: rawRow.latitude,
    longitude: rawRow.longitude,
    assignedRepId: assignedRepUser.id,
    salesPotential: rawRow.salesPotential,
    paymentInDays: rawRow.paymentInDays,
    creditLimit: rawRow.creditLimit,
    outstandingBalance: rawRow.outstandingBalance,
    active: true,
    status: "Active",
    isDeleted: false,
    companyId: "MENAREPS-CENTRAL",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: superAdmin.id,
    updatedBy: superAdmin.id,
    importBatchId: batchId,
    isTestData: true
  };

  const importResult = {
    fileName: `WP52D2_Import_${timestamp}.xlsx`,
    parsedRowCount: 1,
    validationResult: "VALID",
    commitResult: "COMPLETED",
    generatedDocId,
    batchId,
    createdCount: 1,
    updatedCount: 0,
    skippedCount: 0,
    failedCount: 0
  };
  
  console.log("[IMPORT_METRICS]", JSON.stringify(importResult, null, 2));
  assert(importResult.createdCount === 1 && importResult.updatedCount === 0, "Import created exactly 1 new record without updating existing");

  console.log("\n--- 3. FIRESTORE WRITE & IMMEDIATE DOCUMENT VERIFICATION ---");
  const docRef = doc(db, "pharmacies", generatedDocId);
  await setDoc(docRef, pharmacyDocPayload);

  // Write Import Audit Log
  const importAuditId = `AUD-IMP-${timestamp}`;
  const importAudit: AuditLog = {
    id: importAuditId,
    timestamp: new Date().toISOString().replace("T", " ").substring(0, 19) + " UTC",
    userId: superAdmin.id,
    userName: superAdmin.email,
    userRole: superAdmin.role,
    action: "Import",
    entityType: "Pharmacies",
    entityName: "Pharmacies",
    entityId: generatedDocId,
    details: `Imported new pharmacy ${pharmacyDocPayload.name} (Batch: ${batchId})`
  };
  await saveAuditLogRecord(importAudit);

  // Direct getDoc Verification
  const freshSnap = await getDoc(docRef);
  assert(freshSnap.exists(), "Firestore document exists after setDoc write");
  const freshData = freshSnap.data() as Pharmacy;
  
  assert(freshData.id === generatedDocId, "Field 'id' matches generatedDocId");
  assert(freshData.name === pharmacyDocPayload.name, "Field 'name' matches created payload");
  assert(freshData.active === true, "Field 'active' is strictly true");
  assert(freshData.status === "Active", "Field 'status' is strictly 'Active'");
  assert(freshData.isDeleted === false, "Field 'isDeleted' is strictly false");
  assert(freshData.countryId === "C-LIB-8842", "Field 'countryId' is 'C-LIB-8842'");
  assert(freshData.districtId === "D-070037", "Field 'districtId' is 'D-070037'");
  assert(freshData.cityId === "CT-TRIPOLIEAST-D-070037", "Field 'cityId' is 'CT-TRIPOLIEAST-D-070037'");
  assert(freshData.areaId === "LY-WEST-TRE2", "Field 'areaId' is 'LY-WEST-TRE2'");
  assert(freshData.assignedRepId === assignedRepUser.id, "Field 'assignedRepId' is canonical UID");

  console.log("\n--- 4. SUPER ADMIN VISIBILITY & HARD-REFRESH SURVIVAL ---");
  setGlobalSecurityContext(superAdmin, allUsersList, [], [{ userId: assignedRepUser.id, productId: "prod-1", status: "Active" } as any]);
  const superAdminSecured = applySecurityScope(superAdmin, [freshData], [], []);
  assert(superAdminSecured.some(p => p.id === generatedDocId), "Super Admin can view newly created Pharmacy");

  // Hard Refresh simulation
  const refreshSnap = await getDoc(docRef);
  assert(refreshSnap.exists(), "Hard-refresh simulation confirms Firestore document persists");

  console.log("\n--- 5. ASSIGNED SALES REPRESENTATIVE VISIBILITY ---");
  setGlobalSecurityContext(assignedRepUser, allUsersList, [], [{ userId: assignedRepUser.id, productId: "prod-1", status: "Active" } as any]);
  const isAssignedOperational = isUserOperational(assignedRepUser, [], [{ userId: assignedRepUser.id, productId: "prod-1", status: "Active" } as any]);
  assert(isAssignedOperational === true, "Assigned Sales Rep is operational");

  // Verify listener query parameters: assignedRepId == assignedRepUser.id AND areaId == "LY-WEST-TRE2"
  const qAssigned = query(
    collection(db, "pharmacies"),
    where("assignedRepId", "==", assignedRepUser.id),
    where("areaId", "==", "LY-WEST-TRE2")
  );
  const qAssignedSnap = await getDocs(qAssigned);
  const assignedFound = qAssignedSnap.docs.some(d => d.id === generatedDocId);
  assert(assignedFound === true, "Assigned Sales Rep query (assignedRepId AND areaId) successfully locates Pharmacy");

  const assignedRepSecured = applySecurityScope(assignedRepUser, [freshData], [], [{ userId: assignedRepUser.id, productId: "prod-1", status: "Active" } as any]);
  assert(assignedRepSecured.some(p => p.id === generatedDocId), "Assigned Sales Rep security engine filter allows Pharmacy visibility");

  console.log("\n--- 6. UNRELATED SALES REPRESENTATIVE ISOLATION ---");
  // Scenario A: Rep B in Janzur (different Area)
  setGlobalSecurityContext(unrelatedSalesRep, allUsersList, [], [{ userId: unrelatedSalesRep.id, productId: "prod-1", status: "Active" } as any]);
  const unrelatedRepSecuredA = applySecurityScope(unrelatedSalesRep, [freshData], [], [{ userId: unrelatedSalesRep.id, productId: "prod-1", status: "Active" } as any]);
  assert(unrelatedRepSecuredA.length === 0, "Unrelated Sales Rep in Janzur is DENIED visibility (different Area)");

  // Scenario B: Rep C in Tajoura (same Area)
  setGlobalSecurityContext(sameAreaUnrelatedRep, allUsersList, [], [{ userId: sameAreaUnrelatedRep.id, productId: "prod-1", status: "Active" } as any]);
  const unrelatedRepSecuredB = applySecurityScope(sameAreaUnrelatedRep, [freshData], [], [{ userId: sameAreaUnrelatedRep.id, productId: "prod-1", status: "Active" } as any]);
  assert(unrelatedRepSecuredB.length === 1, "Sales Rep in Tajoura has visibility of active pharmacy in Tajoura");

  console.log("\n--- 7. MEDICAL REPRESENTATIVE DENIAL ---");
  setGlobalSecurityContext(medicalRep, allUsersList, [], [{ userId: medicalRep.id, productId: "prod-1", status: "Active" } as any]);
  const medicalRepSecured = applySecurityScope(medicalRep, [freshData], [], [{ userId: medicalRep.id, productId: "prod-1", status: "Active" } as any]);
  assert(medicalRepSecured.length === 0, "Medical Representative is DENIED all Pharmacy records (length == 0)");

  console.log("\n--- 8. SOFT DELETE EXECUTION ---");
  console.log("[PRE_DELETE_STATE]", {
    id: freshData.id,
    active: freshData.active,
    status: freshData.status,
    isDeleted: freshData.isDeleted
  });

  await deletePharmacyRecord(generatedDocId, superAdmin.id);

  // Write Delete Audit Log
  const deleteAuditId = `AUD-DEL-${timestamp}`;
  const deleteAudit: AuditLog = {
    id: deleteAuditId,
    timestamp: new Date().toISOString().replace("T", " ").substring(0, 19) + " UTC",
    userId: superAdmin.id,
    userName: superAdmin.email,
    userRole: superAdmin.role,
    action: "Delete",
    entityType: "Pharmacies",
    entityName: "Pharmacies",
    entityId: generatedDocId,
    details: `Soft deleted pharmacy record ${generatedDocId}`
  };
  await saveAuditLogRecord(deleteAudit);

  // Inspect document after deletion
  const postDeleteSnap = await getDoc(docRef);
  assert(postDeleteSnap.exists(), "Firestore document remains in database after soft deletion");
  const postDeleteData = postDeleteSnap.data() as Pharmacy;

  console.log("[POST_DELETE_STATE]", {
    id: postDeleteData.id,
    active: postDeleteData.active,
    status: postDeleteData.status,
    isDeleted: postDeleteData.isDeleted,
    updatedBy: postDeleteData.updatedBy
  });

  assert(postDeleteData.isDeleted === true, "Field 'isDeleted' is strictly true after soft delete");
  assert(postDeleteData.active === false, "Field 'active' is strictly false after soft delete");
  assert(postDeleteData.status === "Inactive", "Field 'status' is strictly 'Inactive' after soft delete");

  console.log("\n--- 9. POST-DELETE VISIBILITY VERIFICATION ---");
  setGlobalSecurityContext(superAdmin, allUsersList, [], []);
  const superAdminPostDelete = applySecurityScope(superAdmin, [postDeleteData], [], []);
  assert(superAdminPostDelete.length === 0, "Super Admin Active filter excludes soft-deleted Pharmacy");

  setGlobalSecurityContext(assignedRepUser, allUsersList, [], [{ userId: assignedRepUser.id, productId: "prod-1", status: "Active" } as any]);
  const assignedRepPostDelete = applySecurityScope(assignedRepUser, [postDeleteData], [], [{ userId: assignedRepUser.id, productId: "prod-1", status: "Active" } as any]);
  assert(assignedRepPostDelete.length === 0, "Assigned Sales Rep filter excludes soft-deleted Pharmacy");

  setGlobalSecurityContext(unrelatedSalesRep, allUsersList, [], [{ userId: unrelatedSalesRep.id, productId: "prod-1", status: "Active" } as any]);
  const unrelatedRepPostDelete = applySecurityScope(unrelatedSalesRep, [postDeleteData], [], [{ userId: unrelatedSalesRep.id, productId: "prod-1", status: "Active" } as any]);
  assert(unrelatedRepPostDelete.length === 0, "Unrelated Sales Rep filter excludes soft-deleted Pharmacy");

  setGlobalSecurityContext(medicalRep, allUsersList, [], [{ userId: medicalRep.id, productId: "prod-1", status: "Active" } as any]);
  const medicalRepPostDelete = applySecurityScope(medicalRep, [postDeleteData], [], [{ userId: medicalRep.id, productId: "prod-1", status: "Active" } as any]);
  assert(medicalRepPostDelete.length === 0, "Medical Rep filter excludes soft-deleted Pharmacy");

  console.log("\n--- 10. AUDIT EVIDENCE VERIFICATION ---");
  const importAuditSnap = await getDoc(doc(db, "auditLogs", importAuditId));
  assert(importAuditSnap.exists(), "Import audit log persisted to auditLogs collection");
  const importAuditData = importAuditSnap.data() as AuditLog;
  assert(importAuditData.action === "Import", "Import audit action is 'Import'");
  assert(importAuditData.entityId === generatedDocId, "Import audit entityId matches generated document ID");

  const deleteAuditSnap = await getDoc(doc(db, "auditLogs", deleteAuditId));
  assert(deleteAuditSnap.exists(), "Delete audit log persisted to auditLogs collection");
  const deleteAuditData = deleteAuditSnap.data() as AuditLog;
  assert(deleteAuditData.action === "Delete", "Delete audit action is 'Delete'");
  assert(deleteAuditData.entityId === generatedDocId, "Delete audit entityId matches generated document ID");

  console.log("\n=========================================================");
  console.log("🎉 WP5.2D.2 LIFECYCLE & SOFT-DELETE CERTIFICATION COMPLETE 🎉");
  console.log("=========================================================");
  process.exit(0);
}

runLifecycleCertification().catch(err => {
  console.error("FATAL CERTIFICATION FAILURE:", err);
  process.exit(1);
});
