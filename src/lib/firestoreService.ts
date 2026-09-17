import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc, writeBatch, query, where, getDocs, runTransaction } from "firebase/firestore";
import { auth, db } from "./firebase";
import { decorateRecord } from "./firebaseSync";
import { Area, Physician, Pharmacy, Product, ProductPromotionProfile, KeyMessage, AuditLog, PhysicianVisit, PhysicianVisitCompletionResult, PharmacyVisit, ImportHistory, OrderRecord, Role, User, UserProductAssignment, UserTerritoryAssignment, SampleAllocation, SampleBatch, SampleSku } from "../types";
import { handleFirestoreError, OperationType } from "./firebaseError";
import { getValidatedPhysicianAlignedProductIds } from "./productAssignmentService";
import { resolvePhysicianOperationalAssignment } from "./physicianAlignmentUi";
import { getOrCreateDisplayNumberInTransaction } from "./businessDocumentNumberService";
import { sanitizeUserSavePayload, removeUndefinedRecursively, getUndefinedPaths } from "../utils/importNormalization";
import { consumeAllocationsFefo, SampleStockError } from "./sampleStockService";
import { resolveFinancialIdentity } from "./financialIdentity";
import { requireCanonicalAuditMetadata } from "./auditContract";
import { resolveRoleScopePolicy } from "./roleScopePolicy";

let offlineFallbackHandler: any = null;

export function registerOfflineFallbackHandler(handler: any) {
  offlineFallbackHandler = handler;
}

export interface PendingUserActivationInput {
  email: string;
  firstName: string;
  lastName?: string;
  role: Role;
  name?: string;
  username?: string;
  managerId?: string;
  managerEmail?: string;
  active?: boolean;
  employmentStatus?: string;
  status?: string;
  loginAllowed?: boolean;
  securityScope?: string;
  areaIds?: string[];
  areaNames?: string[];
  assignedProductIds?: string[];
  products?: string[];
  sidebarVisibility?: string[];
  country?: string;
  assignedCountries?: string[];
  countryId?: string;
  marketId?: string;
  district?: string;
  city?: string;
  region?: string;
  territory?: string;
  territories?: string[];
  primaryPromotionGroupId?: string;
  targetPromotionGroupIds?: string[];
  authUid?: string;
  assignmentSyncStatus?: string;
}

export interface PendingUserCreationResult {
  userId: string;
  emailKey: string;
  user: User;
}

export function getEmailKey(email: string): string {
  return email.trim().toLowerCase().replace(/@/g, "-").replace(/\./g, "-");
}

function stripUndefinedFields<T extends Record<string, any>>(record: T): T {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined)
  ) as T;
}

export async function createPendingUserWithActivationProfile(
  input: PendingUserActivationInput,
  auditDetails?: string
): Promise<PendingUserCreationResult> {
  const actorUid = auth.currentUser?.uid;
  if (!actorUid) {
    throw new Error("A Firebase Auth session is required to create a pending user.");
  }

  const normalizedEmail = input.email.trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error("Email is required to create a pending user.");
  }

  const emailKey = getEmailKey(normalizedEmail);
  const now = new Date().toISOString();
  const firstName = input.firstName.trim();
  const lastName = (input.lastName || "").trim();
  const name = (input.name || `${firstName} ${lastName}`.trim() || normalizedEmail.split("@")[0]).trim();
  const active = input.active !== undefined ? input.active : true;
  const employmentStatus = input.employmentStatus || (active ? "Active" : "Inactive");
  const assignedProductIds = input.assignedProductIds || input.products || [];
  const areaIds = input.areaIds || [];
  const areaNames = input.areaNames || [];
  const scopePolicy = resolveRoleScopePolicy(input.role);
  const directGeography = !scopePolicy || scopePolicy.geographySource === "SELF";
  if (directGeography && !input.country && !input.countryId && !input.marketId && !(input.assignedCountries || []).length) {
    throw new Error("A canonical country or market is required to create a pending user.");
  }

  const pendingUser: User = {
    id: input.authUid || emailKey,
    uid: input.authUid || emailKey,
    authUid: input.authUid || emailKey,
    email: normalizedEmail,
    name,
    firstName,
    lastName,
    role: input.role,
    managerEmail: input.managerEmail || "",
    managerId: input.managerId || "",
    region: input.region || input.district || "",
    territory: input.territory || "",
    active,
    joinedDate: now.split("T")[0],
    username: input.username || normalizedEmail.split("@")[0],
    sidebarVisibility: input.sidebarVisibility || [],
    areaIds,
    areaNames,
    products: assignedProductIds,
    territories: input.territories || areaNames,
    country: input.country || "",
    assignedCountries: input.assignedCountries || [],
    countryId: input.countryId || "",
    marketId: input.marketId || input.countryId || "",
    district: input.district || "",
    city: input.city || "",
    employmentStatus,
    status: input.status || employmentStatus,
    loginAllowed: input.loginAllowed !== undefined ? input.loginAllowed : active,
    isDeleted: false,
    securityScope: input.securityScope || "Territory Only",
    primaryPromotionGroupId: input.primaryPromotionGroupId || undefined,
    targetPromotionGroupIds: input.targetPromotionGroupIds || undefined,
    assignmentSyncStatus: input.assignmentSyncStatus || "PENDING"
  } as any;

  const activationProfile = {
    emailKey,
    email: normalizedEmail,
    used: !!input.authUid,
    linkedToUid: input.authUid || null,
    createdAt: now,
    createdBy: actorUid,
    role: input.role,
    active,
    employmentStatus,
    firstName,
    lastName,
    name,
    managerId: input.managerId || undefined,
    managerEmail: input.managerEmail || "",
    securityScope: input.securityScope || "Territory Only",
    areaIds,
    areaNames,
    assignedProductIds,
    products: assignedProductIds,
    sidebarVisibility: pendingUser.sidebarVisibility || [],
    country: pendingUser.country || "",
    district: pendingUser.district || "",
    city: pendingUser.city || "",
    region: pendingUser.region,
    territory: pendingUser.territory,
    territories: pendingUser.territories || [],
    status: pendingUser.status,
    loginAllowed: pendingUser.loginAllowed,
    isDeleted: false,
    createdForActivation: true,
    updatedAt: now,
    primaryPromotionGroupId: input.primaryPromotionGroupId || undefined,
    targetPromotionGroupIds: input.targetPromotionGroupIds || undefined,
    updatedBy: actorUid,
    assignmentSyncStatus: input.assignmentSyncStatus || "PENDING"
  };

  const activationProfileDocumentId = input.authUid || emailKey;
  const cleanActivationProfile = removeUndefinedRecursively(
    sanitizeUserSavePayload(activationProfileDocumentId, input.role, {
      ...activationProfile,
      operationalUserId: input.authUid || null,
      legacyEmailKey: input.authUid ? emailKey : null
    })
  );

  const legacyActivationSnapshot = input.authUid && emailKey !== activationProfileDocumentId
    ? await getDoc(doc(db, "userActivationProfiles", emailKey))
    : null;
  const batch = writeBatch(db);
  batch.set(doc(db, "userActivationProfiles", activationProfileDocumentId), cleanActivationProfile);

  // Canonical Auth-linked onboarding retains the email-key document as a linked
  // compatibility pointer. This safely reconciles prior unused import activations.
  if (input.authUid && emailKey !== activationProfileDocumentId && legacyActivationSnapshot?.exists()) {
    batch.set(doc(db, "userActivationProfiles", emailKey), removeUndefinedRecursively({
      emailKey,
      email: normalizedEmail,
      used: true,
      linkedToUid: input.authUid,
      operationalUserId: input.authUid,
      canonicalActivationProfileId: input.authUid,
      role: input.role,
      active,
      loginAllowed: pendingUser.loginAllowed,
      isDeleted: false,
      managerId: input.managerId || "",
      managerEmail: input.managerEmail || "",
      legacyEmailKey: emailKey,
      updatedAt: now,
      updatedBy: actorUid
    }), { merge: true });
  }

  // Only an explicitly resolved Firebase Auth UID may create an operational user.
  if (input.authUid) {
    const cleanPendingUser = removeUndefinedRecursively(
      sanitizeUserSavePayload(input.authUid, input.role, pendingUser)
    );
    batch.set(doc(db, "users", input.authUid), decorateRecord(cleanPendingUser, actorUid, "create"));
  }

  await batch.commit();

  // Interactive Add User passes authUid. Verify its canonical profile before the
  // caller can begin any role-specific synchronization.
  if (input.authUid) {
    const canonicalUserSnapshot = await getDoc(doc(db, "users", input.authUid));
    if (!canonicalUserSnapshot.exists()) {
      throw Object.assign(new Error(`Canonical user document users/${input.authUid} was not found after creation.`), {
        code: "user-creation/canonical-user-verification-failed",
        stage: "VERIFY_CANONICAL_USER",
        authUid: input.authUid
      });
    }
  }

  const auditLogId = `AUD-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const auditLog = removeUndefinedRecursively({
    id: auditLogId,
    timestamp: now.replace("T", " ").substring(0, 19) + " UTC",
    userId: actorUid,
    userName: auth.currentUser?.email || actorUid,
    action: "Create",
    entityType: "Users",
    entityName: "Users",
    entityId: input.authUid || emailKey,
    details: auditDetails || `Created user activation profile for ${normalizedEmail}. Role: ${input.role}. Auth UID: ${input.authUid || "unlinked"}`
  });

  try {
    await setDoc(doc(db, "auditLogs", auditLogId), decorateRecord(auditLog, actorUid, "create"));
  } catch (error) {
    console.warn("[Audit Warning] Activation profile created, but audit log write failed:", error);
  }

  return { userId: input.authUid || emailKey, emailKey, user: pendingUser };
}

export async function syncImportedUserTerritories(params: {
  userId: string;
  userRole: Role;
  areaIds: string[];
  areas: Area[];
  actorUid: string;
}): Promise<string[]> {
  const canonicalAreaIds = Array.from(new Set(params.areaIds.filter(Boolean)));
  const existing = await getDocs(query(collection(db, "userTerritoryAssignments"), where("userId", "==", params.userId)));
  const batch = writeBatch(db);
  for (const snapshot of existing.docs) {
    const data = snapshot.data();
    if (!canonicalAreaIds.includes(data.territoryId || data.areaId)) {
      batch.set(snapshot.ref, { active: false, status: "Inactive", updatedAt: new Date().toISOString(), updatedBy: params.actorUid }, { merge: true });
    }
  }
  const ids: string[] = [];
  for (const areaId of canonicalAreaIds) {
    const area = params.areas.find((candidate) => candidate.id === areaId);
    if (!area || !area.countryId || !area.districtId || !area.cityId) throw new Error(`Canonical Area '${areaId}' does not have a complete parent path.`);
    const assignmentId = `TA_${params.userId}_${areaId}`;
    ids.push(assignmentId);
    batch.set(doc(db, "userTerritoryAssignments", assignmentId), removeUndefinedRecursively({
      assignmentId,
      userId: params.userId,
      userRole: params.userRole,
      countryId: area.countryId,
      districtId: area.districtId,
      cityId: area.cityId,
      territoryId: areaId,
      areaId,
      territoryName: `${area.countryName} / ${area.districtName} / ${area.cityName} / ${area.name}`,
      assignmentType: params.userRole === Role.SALES_REP ? "sales" : "medical",
      effectiveFrom: new Date().toISOString().split("T")[0],
      effectiveTo: "9999-12-31",
      status: "Active",
      active: true,
      assignedBy: params.actorUid,
      assignedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }), { merge: true });
  }
  await batch.commit();
  return ids;
}

export async function verifyCanonicalImportedUser(params: {
  authUid: string;
  email: string;
  managerId: string;
  areaIds: string[];
  territoryAssignmentIds: string[];
  expectNoProducts: boolean;
}): Promise<void> {
  const emailKey = getEmailKey(params.email);
  const [userSnapshot, activationSnapshot, legacyActivationSnapshot, ...territorySnapshots] = await Promise.all([
    getDoc(doc(db, "users", params.authUid)),
    getDoc(doc(db, "userActivationProfiles", params.authUid)),
    getDoc(doc(db, "userActivationProfiles", emailKey)),
    ...params.territoryAssignmentIds.map((id) => getDoc(doc(db, "userTerritoryAssignments", id)))
  ]);
  if (!userSnapshot.exists()) throw new Error(`Canonical user users/${params.authUid} was not persisted.`);
  const user = userSnapshot.data();
  if (user.email !== params.email || user.managerId !== params.managerId) throw new Error("Canonical user identity or manager verification failed.");
  const persistedAreas = Array.isArray(user.areaIds) ? user.areaIds : [];
  if (params.areaIds.some((areaId) => !persistedAreas.includes(areaId))) throw new Error("Canonical user geography verification failed.");
  if (!activationSnapshot.exists() || activationSnapshot.data().linkedToUid !== params.authUid || activationSnapshot.data().used !== true) {
    throw new Error("Canonical activation linkage verification failed.");
  }
  if (legacyActivationSnapshot.exists() && (legacyActivationSnapshot.data().linkedToUid !== params.authUid || legacyActivationSnapshot.data().used !== true)) {
    throw new Error("Email-key activation reconciliation verification failed.");
  }
  if (territorySnapshots.some((snapshot) => !snapshot.exists() || snapshot.data().userId !== params.authUid || snapshot.data().active !== true)) {
    throw new Error("Territory assignment verification failed.");
  }
  if (params.expectNoProducts) {
    const products = await getDocs(query(collection(db, "userProductAssignments"), where("userId", "==", params.authUid)));
    if (products.docs.some((snapshot) => snapshot.data().active !== false)) throw new Error("Unexpected Product assignment was created.");
  }
}


// Save or Update Physician
export async function savePhysician(physician: Physician, userId: string): Promise<void> {
  const docRef = doc(db, "physicians", physician.id);

  // Validate Physician Master alignment independently from representative ownership.
  const productsSnap = await getDocs(collection(db, "products"));
  const productsList = productsSnap.docs.map(item => ({ ...item.data(), id: item.id } as Product));
  const alignedProductIds = getValidatedPhysicianAlignedProductIds({
    selectedProductIds: physician.alignedProductIds || [],
    physician,
    products: productsList,
    userProductAssignments: []
  });

  console.info("[WP710F_ALIGNMENT_JSON]", JSON.stringify({
    physicianId: physician.id,
    requestedProductIds: physician.alignedProductIds || [],
    validatedProductIds: alignedProductIds,
    primaryPromotionGroupId: physician.primaryPromotionGroupId || null,
    targetPromotionGroupIds: physician.targetPromotionGroupIds || []
  }));

  // Representative resolution is a separate post-alignment operation.
  const [usersSnap, territoryAssignmentsSnap, productAssignmentsSnap] = await Promise.all([
    getDocs(collection(db, "users")),
    getDocs(collection(db, "userTerritoryAssignments")),
    getDocs(collection(db, "userProductAssignments"))
  ]);
  const users = usersSnap.docs.map(item => ({ ...item.data(), id: item.id } as User));
  const territoryAssignments = territoryAssignmentsSnap.docs.map(item => ({
    assignmentId: item.id,
    ...item.data()
  } as UserTerritoryAssignment));
  const productAssignments = productAssignmentsSnap.docs.map(item => ({
    assignmentId: item.id,
    ...item.data()
  } as UserProductAssignment));
  const assignmentResolution = resolvePhysicianOperationalAssignment({
    areaId: physician.areaId,
    alignedProductIds,
    requestedRepId: physician.assignedRepId,
    users,
    userTerritoryAssignments: territoryAssignments,
    userProductAssignments: productAssignments
  });

  console.info("[WP710F_REPRESENTATIVE_RESOLUTION_JSON]", JSON.stringify({
    physicianId: physician.id,
    areaId: physician.areaId || null,
    alignedProductIds,
    eligibleRepresentativeIds: assignmentResolution.eligibleRepresentativeIds,
    assignedRepId: assignmentResolution.assignedRepId || null,
    status: assignmentResolution.representativeStatus
  }));
  console.info("[WP710F_ORGANIZATIONAL_CASCADE_JSON]", JSON.stringify({
    physicianId: physician.id,
    assignedRepId: assignmentResolution.assignedRepId || null,
    assignedSupervisorId: assignmentResolution.assignedSupervisorId || null,
    assignedManagerId: assignmentResolution.assignedManagerId || null,
    supervisorStatus: assignmentResolution.supervisorStatus || null,
    managerStatus: assignmentResolution.managerStatus || null
  }));

  const updatedPhysician = {
    ...physician,
    alignedProductIds,
    assignedRepId: assignmentResolution.assignedRepId ?? null,
    assignedSupervisorId: assignmentResolution.assignedSupervisorId ?? null,
    assignedManagerId: assignmentResolution.assignedManagerId ?? null,
    representativeResolutionStatus: assignmentResolution.representativeStatus,
    supervisorResolutionStatus: assignmentResolution.supervisorStatus ?? null,
    managerResolutionStatus: assignmentResolution.managerStatus ?? null,
    lastVisitDate: physician.lastVisitDate ?? null
  };

  console.info("[WP710F_PHYSICIAN_SAVE_JSON]", JSON.stringify({
    physicianId: physician.id,
    areaId: physician.areaId || null,
    alignedProductIds,
    assignedRepId: assignmentResolution.assignedRepId || null,
    assignedSupervisorId: assignmentResolution.assignedSupervisorId || null,
    assignedManagerId: assignmentResolution.assignedManagerId || null
  }));

  // Remove legacy/non-canonical/name-based relationship fields to satisfy:
  // "Persist ONLY assignedRepId, primaryPromotionGroupId, targetPromotionGroupIds, alignedProductIds. All relationships must use canonical IDs."
  const fieldsToRemove = [
    "assignedProducts",
    "primaryBrand",
    "targetBrands",
    "primaryPromotionGroupName",
    "targetPromotionGroupNames",
    "assignedRepName"
  ];

  fieldsToRemove.forEach(field => {
    delete (updatedPhysician as any)[field];
  });

  const decorated = decorateRecord(updatedPhysician, userId, "create");
  
  // Sanitize undefined values
  const sanitized: any = {};
  for (const [key, val] of Object.entries(decorated)) {
    if (val !== undefined) {
      sanitized[key] = val;
    }
  }

  // Ensure fields to remove are explicitly deleted on merge or update in Firestore
  fieldsToRemove.forEach(field => {
    sanitized[field] = null;
  });

  try {
    await setDoc(docRef, sanitized, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `physicians/${physician.id}`, sanitized);
    throw error;
  }
}

// Save or Update Pharmacy
export async function savePharmacy(pharmacy: Pharmacy, userId: string): Promise<void> {
  const docRef = doc(db, "pharmacies", pharmacy.id);
  const snap = await getDoc(docRef);
  let payload: Pharmacy = { ...pharmacy };
  if (!snap.exists()) {
    // New Creation: initialize lifecycle fields
    payload.isDeleted = false;
    payload.active = payload.active ?? true;
    payload.status = payload.status || "Active";
  } else {
    const existing = snap.data();
    if (existing.isDeleted === true && pharmacy.isDeleted !== false) {
      // Ordinary update of soft-deleted pharmacy without explicit reactivation: preserve soft-deleted state
      payload.isDeleted = true;
      payload.active = false;
      payload.status = "Inactive";
    } else if (pharmacy.isDeleted === false) {
      // Explicit reactivation or active update
      payload.isDeleted = false;
      payload.active = true;
      payload.status = "Active";
    }
  }
  const decorated = stripUndefinedFields(decorateRecord(payload, userId, "create"));
  try {
    await setDoc(docRef, decorated, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `pharmacies/${pharmacy.id}`);
  }
}

// Reactivate Pharmacy (Explicit reactivation)
export async function reactivatePharmacyRecord(pharmacyId: string, userId: string): Promise<void> {
  const docRef = doc(db, "pharmacies", pharmacyId);
  const snap = await getDoc(docRef);
  const pharmacyName = snap.exists() ? (snap.data().name || pharmacyId) : pharmacyId;

  await updateDoc(docRef, {
    isDeleted: false,
    active: true,
    status: "Active",
    updatedAt: new Date().toISOString(),
    updatedBy: userId
  });

  const auditLogId = `AUD-REACTIVATE-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
  await saveAuditLogRecord({
    id: auditLogId,
    userId,
    userName: userId,
    action: "Reactivate",
    entityType: "Pharmacies",
    entityName: pharmacyName,
    entityId: pharmacyId,
    details: `Reactivated Pharmacy '${pharmacyName}' (ID: ${pharmacyId}). Set isDeleted = false, active = true, status = 'Active'.`,
    timestamp: new Date().toISOString()
  });
}

// Save or Update Product
export class ProductPersistenceClientError extends Error {
  constructor(public readonly code: string, public readonly status: number, public readonly retryable: boolean) { super(code); this.name = "ProductPersistenceClientError"; }
}

export type ProductPersistenceCommand = { operation: "create" | "edit"; productId: string; product: Product };

async function requestProductPersistence(body: unknown, userId: string): Promise<any> {
  const currentUser = auth.currentUser;
  if (!currentUser || currentUser.uid !== userId) throw new ProductPersistenceClientError("PRODUCT_AUTHENTICATION_REQUIRED", 0, false);
  let token: string;
  try { token = await currentUser.getIdToken(); }
  catch { throw new ProductPersistenceClientError("PRODUCT_TOKEN_ACQUISITION_FAILED", 0, false); }
  let response: Response;
  try {
    response = await fetch("/api/products/mutate", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
  } catch {
    throw new ProductPersistenceClientError("PRODUCT_NETWORK_UNAVAILABLE", 0, true);
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new ProductPersistenceClientError(typeof result.code === "string" ? result.code : "PRODUCT_WRITE_FAILED", response.status, false);
  return result;
}

export async function saveProduct(product: Product, userId: string, operation: "create" | "edit"): Promise<Product> {
  const result = await requestProductPersistence({ operation, productId: product.id, product: canonicalProductClientPayload(product) }, userId);
  if (!result.product) throw new ProductPersistenceClientError("PRODUCT_WRITE_FAILED", 200, false);
  return { ...result.product, id: product.id } as Product;
}

export async function saveProductBatch(commands: ProductPersistenceCommand[], userId: string): Promise<Product[]> {
  const result = await requestProductPersistence({ commands: commands.map(command => ({ ...command, product: canonicalProductClientPayload(command.product) })) }, userId);
  if (!Array.isArray(result.products)) throw new ProductPersistenceClientError("PRODUCT_WRITE_FAILED", 200, false);
  return result.products.map((entry: any) => entry.product as Product);
}

export const isRetryableProductPersistenceError = (error: unknown): boolean => error instanceof ProductPersistenceClientError && error.retryable;

export function canonicalProductClientPayload(product: Product): Product {
  const { productId: _productId, active: _active, createdAt: _createdAt, createdBy: _createdBy, updatedAt: _updatedAt, updatedBy: _updatedBy, importedAt: _importedAt, importedBy: _importedBy, ...business } = product as Product & Record<string, unknown>;
  return business as Product;
}

// Update Product Promotion Profile
export async function updateProductPromotionProfile(productId: string, profile: ProductPromotionProfile, userId: string): Promise<void> {
  const docRef = doc(db, "products", productId);
  try {
    const now = new Date().toISOString();
    const updatedProfile = {
      ...profile,
      updatedAt: now,
      updatedBy: userId
    };
    await updateDoc(docRef, {
      promotionProfile: updatedProfile,
      updatedAt: now,
      updatedBy: userId
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `products/${productId}`);
  }
}

// Delete Product (Soft delete)
export async function deleteProductRecord(productId: string, userId: string): Promise<void> {
  const docRef = doc(db, "products", productId);
  try {
    await updateDoc(docRef, { isDeleted: true, updatedAt: new Date().toISOString(), updatedBy: userId });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `products/${productId}`);
  }
}

// Delete Physician (Soft delete)
export async function deletePhysicianRecord(physicianId: string, userId: string): Promise<void> {
  const docRef = doc(db, "physicians", physicianId);
  try {
    await updateDoc(docRef, { isDeleted: true, updatedAt: new Date().toISOString(), updatedBy: userId });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `physicians/${physicianId}`);
  }
}

// Delete Pharmacy (Soft delete)
export async function deletePharmacyRecord(pharmacyId: string, userId: string): Promise<void> {
  const docRef = doc(db, "pharmacies", pharmacyId);
  try {
    await updateDoc(docRef, { isDeleted: true, active: false, status: "Inactive", updatedAt: new Date().toISOString(), updatedBy: userId });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `pharmacies/${pharmacyId}`);
  }
}

// Complete / Save Physician Visit Detailing inside a Transaction to prevent duplicate completions
export async function savePhysicianVisitRecord(
  visit: PhysicianVisit,
  userId: string,
  userName?: string,
  userRole?: string
): Promise<PhysicianVisitCompletionResult> {
  const visitId = visit.id;
  const visitRef = doc(db, "physicianVisits", visitId);
  const physRef = doc(db, "physicians", visit.physicianId);

  // Proactive Offline Interceptor Check
  if (offlineFallbackHandler && (offlineFallbackHandler.getCurrentConnectivityStatus() === "offline" || !navigator.onLine)) {
    const queuedItem = offlineFallbackHandler.enqueueOfflineWrite("physicianVisit", "create", visit, userId, userName, userRole);
    return { status: "PENDING_SYNC", queueItemId: queuedItem.id };
  }

  // Physician Visit completion is security-sensitive: nested detailing,
  // Key Message, promotion-group, physician-area, and Sample allocation
  // authorization is evaluated atomically by the authenticated backend.
  // Firestore Rules deliberately reject direct representative visit writes.
  try {
    const token = await auth.currentUser?.getIdToken();
    if (!token || auth.currentUser?.uid !== userId) throw new Error("AUTHENTICATED_VISIT_ACTOR_REQUIRED");
    const response = await fetch("/api/physician-visits/complete", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ visit })
    });
    const result = await response.json().catch(() => ({ code: "INVALID_VISIT_COMPLETION_RESPONSE" }));
    if (!response.ok || result.status !== "COMPLETED") throw new Error(result.code || "PHYSICIAN_VISIT_COMPLETION_FAILED");
    return { status: "COMPLETED" };
  } catch (error: any) {
    const message = error?.message || String(error);
    const networkFailure = message.includes("network") || message.includes("offline") || message.includes("unavailable") || !navigator.onLine;
    if (networkFailure && offlineFallbackHandler) {
      const queuedItem = offlineFallbackHandler.enqueueOfflineWrite("physicianVisit", "create", visit, userId, userName, userRole);
      return { status: "PENDING_SYNC", queueItemId: queuedItem.id };
    }
    throw error;
  }

  /* istanbul ignore next -- retained temporarily for legacy-source audit; unreachable after backend cutover */
  if (false) {

  let sanitizedVisitForDiag: any = null;
  let removedPathsForDiag: string[] = [];

  try {
    // 1. Fetch relevant planner visits first
    const plannerVisitsRef = collection(db, "medicalPlannerVisits");
    const q = query(
      plannerVisitsRef,
      where("physicianId", "==", visit.physicianId),
      where("repId", "==", userId),
      where("date", "==", visit.visitDate)
    );
    const querySnapshot = await getDocs(q);
    const plannerVisitRefs: any[] = [];
    querySnapshot.forEach((docSnap) => {
      plannerVisitRefs.push(docSnap.ref);
    });

    // Resolve canonical Sample SKUs and representative allocations before the transaction.
    const sampleProductIds = visit.samples ? visit.samples.map(s => s.productId).filter(Boolean) : [];
    const allocationDocs: any[] = [];
    const sampleSkuByProduct = new Map<string, SampleSku>();
    const sampleBatchesBySku = new Map<string, SampleBatch[]>();
    const monthlyLimitByProduct = new Map<string, number>();
    if (sampleProductIds.length > 0) {
      for (const productId of [...new Set(sampleProductIds)]) {
        const skuSnap = await getDocs(query(collection(db, "sampleCatalog"), where("productId", "==", productId)));
        const activeSkus = skuSnap.docs.map(item => ({ id: item.id, ...item.data() } as SampleSku))
          .filter(item => item.active !== false && item.status === "ACTIVE");
        if (activeSkus.length !== 1) throw new Error(`Sample allocation configuration for product ${productId} is ${activeSkus.length === 0 ? "missing" : "ambiguous"}.`);
        sampleSkuByProduct.set(productId, activeSkus[0]);
        const productSnap = await getDoc(doc(db, "products", productId));
        monthlyLimitByProduct.set(productId, Number(productSnap.data()?.monthlyPhysicianSampleLimit || 0));
      }
      const allocQuery = query(
        collection(db, "sampleAllocations"),
        where("repId", "==", userId),
        where("productId", "in", sampleProductIds)
      );
      const allocSnap = await getDocs(allocQuery);
      allocSnap.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.status !== "ACTIVE" || data.isDeleted === true || Number(data.quantityRemaining || 0) <= 0) return;
        allocationDocs.push({
          id: docSnap.id,
          ref: docSnap.ref,
          data
        });
      });
      if (allocationDocs.length > 0) {
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw new Error("Authentication is required to resolve allocated Sample batches.");
        const batchResponse = await fetch("/api/samples/allocated-batches", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ allocationIds: allocationDocs.map(item => item.id) })
        });
        const batchResult = await batchResponse.json().catch(() => ({ success: false, code: "INVALID_RESPONSE" }));
        if (!batchResponse.ok || !batchResult.success) throw new Error(batchResult.code || "ALLOCATED_BATCH_RESOLUTION_FAILED");
        for (const batch of batchResult.batches as SampleBatch[]) {
          const existing = sampleBatchesBySku.get(batch.sampleSkuId) || [];
          sampleBatchesBySku.set(batch.sampleSkuId, [...existing, batch]);
        }
      }
    }

    // 2. Run Transaction
    await runTransaction(db, async (transaction) => {
      const visitSnap = await transaction.get(visitRef);
      if (visitSnap.exists()) {
        throw new Error(`Physician visit with ID '${visitId}' has already been completed. Double-submission prevented.`);
      }

      // Check and lock physician doc
      const physSnap = await transaction.get(physRef);
      if (!physSnap.exists()) {
        throw new Error(`Physician record with ID '${visit.physicianId}' does not exist.`);
      }

      // Lock planner visit documents
      for (const pRef of plannerVisitRefs) {
        await transaction.get(pRef);
      }

      // Lock and validate sample allocation documents
      for (const allocDoc of allocationDocs) {
        await transaction.get(allocDoc.ref);
      }
      const usageSnapshots = new Map<string, any>();
      for (const sample of visit.samples || []) {
        const usageId = `${visit.physicianId}_${sample.productId}_${visit.visitDate.slice(0, 7)}`;
        usageSnapshots.set(sample.productId, await transaction.get(doc(db, "physicianSampleUsage", usageId)));
      }

      const countryInput = (visit as any).countryId || (visit as any).countryCode || (physSnap.exists() ? (physSnap.data().countryId || physSnap.data().countryCode) : null) || "LY";
      const yearNum = parseInt((visit.visitDate || "").substring(0, 4), 10) || new Date().getFullYear();

      const visitDisplayNumber = await getOrCreateDisplayNumberInTransaction(transaction, {
        docRef: visitRef,
        existingData: (visitSnap as any).exists() ? (visitSnap as any).data() : null,
        documentType: "PHYSICIAN_VISIT",
        countryInput,
        dateOrYear: yearNum,
        userId
      });

      const decoratedVisit = decorateRecord({ ...visit, displayNumber: visitDisplayNumber }, userId, "create");
      removedPathsForDiag = getUndefinedPaths(decoratedVisit);
      sanitizedVisitForDiag = removeUndefinedRecursively(decoratedVisit);
      transaction.set(visitRef, sanitizedVisitForDiag);

      // Update physician info
      transaction.update(physRef, {
        lastVisitDate: visit.visitDate,
        lastVisitStatus: "Completed",
        updatedAt: new Date().toISOString(),
        updatedBy: userId
      });

      // Link and complete planner visits
      for (const pRef of plannerVisitRefs) {
        transaction.update(pRef, {
          completedVisitId: visitId,
          visitStatus: "Completed"
        });
      }

      // Process sample stock decrements and write ledger transactions (Phase F)
      for (const sample of visit.samples || []) {
        const sampleSku = sampleSkuByProduct.get(sample.productId);
        const matchingDocs = allocationDocs.filter(a => a.data.productId === sample.productId && a.data.sampleSkuId === sampleSku?.id && a.data.status === "ACTIVE");
        if (!sampleSku || matchingDocs.length === 0) {
          throw new Error(`Security Violation: No active sample allocation found for product ${sample.productName}. Disbursal blocked.`);
        }
        const qtyDisbursed = Number(sample.quantity) || 0;
        const now = new Date().toISOString();
        const usageSnapshot = usageSnapshots.get(sample.productId);
        const usedQuantity = Number(usageSnapshot?.data()?.usedQuantity || 0);
        const monthlyLimit = monthlyLimitByProduct.get(sample.productId) || 0;
        if (monthlyLimit > 0 && usedQuantity + qtyDisbursed > monthlyLimit) {
          throw new Error(`Physician monthly Sample allowance has been exceeded for ${sample.productName}.`);
        }
        const liveAllocations = matchingDocs.map(item => ({ id: item.id, ...item.data } as SampleAllocation));
        let plan;
        try {
          plan = consumeAllocationsFefo(liveAllocations, sampleBatchesBySku.get(sampleSku.id) || [], userId, sampleSku.id, qtyDisbursed, now);
        } catch (error) {
          if (error instanceof SampleStockError) throw new Error(`Insufficient allocated sample stock for ${sample.productName}.`);
          throw error;
        }
        for (const consumption of plan) {
          const allocDoc = matchingDocs.find(item => item.id === consumption.allocationId)!;
          const currentRem = Number(allocDoc.data.quantityRemaining) || 0;
          const currentDist = Number(allocDoc.data.quantityDistributed) || 0;
          transaction.update(allocDoc.ref, {
            quantityDistributed: currentDist + consumption.quantity,
            quantityRemaining: currentRem - consumption.quantity,
            status: currentRem === consumption.quantity ? "DEPLETED" : "ACTIVE",
            updatedAt: now,
            updatedBy: userId
          });
        }

        const distributionId = `DIST-${visitId.replace(/[^a-zA-Z0-9_-]/g, "_")}-${sampleSku.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
        transaction.set(doc(db, "sampleDisbursedLogs", distributionId), {
          id: distributionId, sampleSkuId: sampleSku.id, productId: sampleSku.productId,
          repId: userId, physicianId: visit.physicianId, quantity: qtyDisbursed,
          allocationId: plan[0].allocationId, allocationIds: plan.map(item => item.allocationId),
          allocationConsumptions: plan, batchId: plan[0].batchId || null, visitId,
          distributedAt: now, createdBy: userId
        });
        const usageId = `${visit.physicianId}_${sample.productId}_${visit.visitDate.slice(0, 7)}`;
        transaction.set(doc(db, "physicianSampleUsage", usageId), {
          physicianId: visit.physicianId, productId: sample.productId, period: visit.visitDate.slice(0, 7),
          usedQuantity: usedQuantity + qtyDisbursed, lastDistributionId: distributionId,
          updatedAt: now, updatedBy: userId
        });

        const txId = `SM-${visitId.replace(/[^a-zA-Z0-9_-]/g, "_")}-${sampleSku.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
        const txRef = doc(db, "sampleTransactions", txId);
        const newTx = {
          id: txId,
          sampleSkuId: sampleSku.id, batchId: plan[0].batchId || null, type: "DISTRIBUTION",
          quantity: -qtyDisbursed, sourceId: distributionId, sourceType: "SAMPLE_DISTRIBUTION",
          actorId: userId, createdAt: now,
          notes: `Disbursed ${qtyDisbursed} units of ${sample.productName} during physician visit ${visitId}.`
        };
        const decoratedTx = removeUndefinedRecursively(decorateRecord(newTx, userId, "create"));
        transaction.set(txRef, decoratedTx);
      }

      // Write Audit Log inside transaction
      const auditLogId = `AUD-${Math.floor(100000 + Math.random() * 900000)}`;
      const auditLogRef = doc(db, "auditLogs", auditLogId);
      const auditData = {
        id: auditLogId,
        userId: userId,
        userName: userName || "Representative",
        userRole: userRole || "Medical Representative",
        action: "Physician Visit Completed",
        entityType: "PhysicianVisit",
        entityId: visitId,
        details: `Booked medical detailing visit with Dr. ${visit.physicianName}. Samples disbursed: ${visit.samples?.map(s => `${s.productName} (${s.quantity})`).join(", ") || "None"}.`,
        timestamp: new Date().toISOString()
      };
      const decoratedAudit = removeUndefinedRecursively(decorateRecord(auditData, userId, "create"));
      transaction.set(auditLogRef, decoratedAudit);
    });
    return { status: "COMPLETED" };
  } catch (error: any) {
    const errMsg = error?.message || String(error);
    const isNetworkError = errMsg.includes("network") || errMsg.includes("offline") || errMsg.includes("unavailable") || errMsg.includes("failed-precondition") || !navigator.onLine;
    if (isNetworkError && offlineFallbackHandler) {
      console.warn(`[Firestore Sync Fallback] Network error. Saving physician visit offline: ${errMsg}`);
      const queuedItem = offlineFallbackHandler.enqueueOfflineWrite("physicianVisit", "create", visit, userId, userName, userRole);
      return { status: "PENDING_SYNC", queueItemId: queuedItem.id };
    }
    handleFirestoreError(
      error,
      OperationType.WRITE,
      `physicianVisits/${visitId}`,
      sanitizedVisitForDiag || removeUndefinedRecursively(visit),
      false,
      "N/A",
      "N/A",
      removedPathsForDiag
    );
    throw error;
  }
  }
}

// Complete / Save Pharmacy Visit inside a Transaction to prevent duplicate completions
export async function savePharmacyVisitRecord(
  visit: PharmacyVisit,
  userId: string,
  userName?: string,
  userRole?: string
): Promise<void> {
  const visitId = visit.id;
  const visitRef = doc(db, "pharmacyVisits", visitId);
  const pharmRef = doc(db, "pharmacies", visit.pharmacyId);

  // Proactive Offline Interceptor Check
  if (offlineFallbackHandler && (offlineFallbackHandler.getCurrentConnectivityStatus() === "offline" || !navigator.onLine)) {
    offlineFallbackHandler.enqueueOfflineWrite("pharmacyVisit", "create", visit, userId, userName, userRole);
    return;
  }

  let sanitizedVisitForDiag: any = null;
  let removedPathsForDiag: string[] = [];

  try {
    // 1. Fetch relevant planner visits first
    const plannerVisitsRef = collection(db, "salesPlannerVisits");
    const q = query(
      plannerVisitsRef,
      where("pharmacyId", "==", visit.pharmacyId),
      where("repId", "==", userId),
      where("date", "==", visit.visitDate)
    );
    const querySnapshot = await getDocs(q);
    const plannerVisitRefs: any[] = [];
    querySnapshot.forEach((docSnap) => {
      plannerVisitRefs.push(docSnap.ref);
    });

    // 2. Run Transaction
    await runTransaction(db, async (transaction) => {
      const visitSnap = await transaction.get(visitRef);
      if (visitSnap.exists()) {
        throw new Error(`Pharmacy visit with ID '${visitId}' has already been completed. Double-submission prevented.`);
      }

      // Check and lock pharmacy doc
      const pharmSnap = await transaction.get(pharmRef);
      if (!pharmSnap.exists()) {
        throw new Error(`Pharmacy record with ID '${visit.pharmacyId}' does not exist.`);
      }

      // Lock planner visit documents
      for (const pRef of plannerVisitRefs) {
        await transaction.get(pRef);
      }

      const countryInput = (visit as any).countryId || (visit as any).countryCode || (pharmSnap.exists() ? (pharmSnap.data().countryId || pharmSnap.data().countryCode) : null) || "LY";
      const yearNum = parseInt((visit.visitDate || "").substring(0, 4), 10) || new Date().getFullYear();

      const visitDisplayNumber = await getOrCreateDisplayNumberInTransaction(transaction, {
        docRef: visitRef,
        existingData: (visitSnap as any).exists() ? (visitSnap as any).data() : null,
        documentType: "PHARMACY_VISIT",
        countryInput,
        dateOrYear: yearNum,
        userId
      });

      const decoratedVisit = decorateRecord({ ...visit, displayNumber: visitDisplayNumber }, userId, "create");
      removedPathsForDiag = getUndefinedPaths(decoratedVisit);
      sanitizedVisitForDiag = removeUndefinedRecursively(decoratedVisit);
      transaction.set(visitRef, sanitizedVisitForDiag);

      // Update pharmacy details
      transaction.update(pharmRef, {
        outstandingBalance: visit.outstandingBalanceAfter,
        lastVisitDate: visit.visitDate,
        updatedAt: new Date().toISOString(),
        updatedBy: userId
      });

      // Link and complete planner visits
      for (const pRef of plannerVisitRefs) {
        transaction.update(pRef, {
          completedVisitId: visitId,
          visitStatus: "Completed"
        });
      }

      // Write Audit Log inside transaction
      const auditLogId = `AUD-${Math.floor(100000 + Math.random() * 900000)}`;
      const auditLogRef = doc(db, "auditLogs", auditLogId);
      const auditData = {
        id: auditLogId,
        userId: userId,
        userName: userName || "Representative",
        userRole: userRole || "Sales Representative",
        action: "Pharmacy Visit Completed",
        entityType: "PharmacyVisit",
        entityId: visitId,
        details: `Booked pharmacy visit with ${visit.pharmacyName}. Outstanding Balance: ${visit.outstandingBalanceAfter} ${resolveFinancialIdentity([visit as any])?.currencyCode || "[CURRENCY_CONFIGURATION_REQUIRED]"}.`,
        timestamp: new Date().toISOString()
      };
      const decoratedAudit = removeUndefinedRecursively(decorateRecord(auditData, userId, "create"));
      transaction.set(auditLogRef, decoratedAudit);
    });
  } catch (error: any) {
    const errMsg = error?.message || String(error);
    const isNetworkError = errMsg.includes("network") || errMsg.includes("offline") || errMsg.includes("unavailable") || errMsg.includes("failed-precondition") || !navigator.onLine;
    if (isNetworkError && offlineFallbackHandler) {
      console.warn(`[Firestore Sync Fallback] Network error. Saving pharmacy visit offline: ${errMsg}`);
      offlineFallbackHandler.enqueueOfflineWrite("pharmacyVisit", "create", visit, userId, userName, userRole);
      return;
    }
    handleFirestoreError(
      error,
      OperationType.WRITE,
      `pharmacyVisits/${visitId}`,
      sanitizedVisitForDiag || removeUndefinedRecursively(visit),
      false,
      "N/A",
      "N/A",
      removedPathsForDiag
    );
  }
}

// In-memory buffer for audit logs when direct Firestore writes are restricted/denied
export const inMemoryAuditLogs: AuditLog[] = [];

// Log a secure Audit entry
export async function saveAuditLogRecord(log: AuditLog): Promise<void> {
  try {
    const metadata = requireCanonicalAuditMetadata(log as unknown as Record<string, unknown>);
    const token = await auth.currentUser?.getIdToken();
    if (!token) {
      throw new Error("No active authenticated user session token available for backend audit persistence.");
    }
    const response = await fetch("/api/audit-events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(metadata)
    });
    if (!response.ok) {
      const resData = await response.json().catch(() => ({}));
      throw new Error(resData.error || `HTTP ${response.status}`);
    }
    const responseData = await response.json();
    const authoritativeLog = responseData.auditLog as AuditLog;
    inMemoryAuditLogs.push(authoritativeLog);
    if (typeof window !== "undefined" && typeof (window as any).onAuditLogCreated === "function") {
      (window as any).onAuditLogCreated(authoritativeLog);
    }
    console.info(`[Audit Service] Trusted backend persistence of audit log ${authoritativeLog.id} succeeded.`);
  } catch (backendError: any) {
    console.error(`[Audit Service] TRUSTED_AUDIT_BACKEND_FAILURE: ${backendError?.message || String(backendError)}`);
    throw backendError;
  }
}

// Save dynamic imported worksheet records
export async function saveImportHistoryRecord(history: ImportHistory, userId: string): Promise<void> {
  const docRef = doc(db, "importHistory", history.id);
  const decorated = decorateRecord(history, userId, "create");
  try {
    await setDoc(docRef, decorated);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `importHistory/${history.id}`);
  }
}

// Get order by ID directly from Firestore orders collection
export async function getOrderById(orderId: string): Promise<any | null> {
  try {
    const docRef = doc(db, "orders", orderId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return { id: docSnap.id, ...docSnap.data() };
    }
    return null;
  } catch (err) {
    console.error("Error fetching order by ID:", err);
    return null;
  }
}

// Save or Update Order securely inside a transaction to prevent race conditions or duplicate actions
export async function saveOrder(
  order: OrderRecord,
  userId: string,
  userRole?: string,
  userName?: string,
  actionDetails?: string
): Promise<void> {
  const orderId = order.id;
  const orderDocRef = doc(db, "orders", orderId);

  // Proactive Offline Interceptor Check
  if (offlineFallbackHandler && (offlineFallbackHandler.getCurrentConnectivityStatus() === "offline" || !navigator.onLine)) {
    offlineFallbackHandler.enqueueOfflineWrite("order", "create", order, userId, userName, userRole);
    return;
  }

  try {
    await runTransaction(db, async (transaction) => {
      const docSnap = await transaction.get(orderDocRef);
      const exists = docSnap.exists();

      let finalRecord: any = { ...order };

      if (exists) {
        const currentData = docSnap.data() as any;

        // Validation 1: Prevent double-submission/modification of an already Delivered/Voided order
        if (currentData.status === "Delivered" || currentData.status === "Voided") {
          throw new Error(`Order ${orderId} is already in terminal state '${currentData.status}' and cannot be modified.`);
        }

        // Validation 2: Prevent duplicate approvals at the same stage
        if (order.status === currentData.status && actionDetails && (actionDetails.includes("Approved") || actionDetails.includes("Cleared"))) {
          throw new Error(`Order ${orderId} has already been approved/processed for state '${order.status}'.`);
        }

        // Validation 3: Ensure Finance cannot approve an already ops-validated or delivered order
        if (currentData.status === "Pending Ops Validation" && order.status === "Pending Financial Review") {
          throw new Error(`Order ${orderId} has already completed financial review and is in Operations validation.`);
        }

        // Preserve original createdAt and createdBy
        finalRecord.createdAt = currentData.createdAt || new Date().toISOString();
        finalRecord.createdBy = currentData.createdBy || userId;
      } else {
        // This is a brand new order creation
        finalRecord.createdAt = new Date().toISOString();
        finalRecord.createdBy = userId;
      }

      // Always update updatedAt and updatedBy
      finalRecord.updatedAt = new Date().toISOString();
      finalRecord.updatedBy = userId;

      const countryInput = (order as any).countryId || (order as any).countryCode || "LY";
      const dateVal = order.date || new Date().toISOString();
      const yearNum = parseInt(dateVal.substring(0, 4), 10) || new Date().getFullYear();

      const orderDisplayNumber = await getOrCreateDisplayNumberInTransaction(transaction, {
        docRef: orderDocRef,
        existingData: exists ? docSnap.data() : null,
        documentType: "SALES_ORDER",
        countryInput,
        dateOrYear: yearNum,
        userId
      });

      finalRecord.displayNumber = orderDisplayNumber;

      const decorated = decorateRecord(finalRecord, userId, exists ? "update" : "create");
      decorated.status = order.status; // Always preserve exact target status
      if (exists) {
        const currentData = docSnap.data() as any;
        if (currentData.createdAt) decorated.createdAt = currentData.createdAt;
        if (currentData.createdBy) decorated.createdBy = currentData.createdBy;
        if (currentData.displayNumber) decorated.displayNumber = currentData.displayNumber;
      }

      const cleanRecord = stripUndefinedFields(decorated);

      // Write the order record inside the transaction
      transaction.set(orderDocRef, cleanRecord, { merge: true });

      // Create and write dynamic Audit Log inside the same transaction
      const auditLogId = `AUD-${Math.floor(100000 + Math.random() * 900000)}`;
      const auditLogRef = doc(db, "auditLogs", auditLogId);
      const auditData = {
        id: auditLogId,
        userId: userId,
        userName: userName || "Representative",
        userRole: userRole || "Sales Representative",
        action: exists ? "Update Order" : "Create Order",
        entityType: "Order",
        entityId: orderId,
        details: actionDetails || (exists 
          ? `Order status transitioned to '${order.status}' by ${userName || userId}.` 
          : `Created sales order ${orderId} for ${order.pharmacyName}. Total: ${order.total} ${resolveFinancialIdentity([order as any])?.currencyCode || "[CURRENCY_CONFIGURATION_REQUIRED]"}.`),
        timestamp: new Date().toISOString()
      };
      const decoratedAudit = decorateRecord(auditData, userId, "create");
      transaction.set(auditLogRef, decoratedAudit);
    });

  } catch (error: any) {
    const errMsg = error?.message || String(error);
    const isNetworkError = errMsg.includes("network") || errMsg.includes("offline") || errMsg.includes("unavailable") || errMsg.includes("failed-precondition") || !navigator.onLine;
    if (isNetworkError && offlineFallbackHandler) {
      console.warn(`[Firestore Sync Fallback] Network error. Saving order offline: ${errMsg}`);
      offlineFallbackHandler.enqueueOfflineWrite("order", "create", order, userId, userName, userRole);
      return;
    }
    handleFirestoreError(error, OperationType.WRITE, `orders/${orderId}`);
  }
}

// Delete Order (Soft delete)
export async function deleteOrderRecord(orderId: string, userId: string): Promise<void> {
  const docRef = doc(db, "orders", orderId);
  try {
    await updateDoc(docRef, { isDeleted: true, updatedAt: new Date().toISOString(), updatedBy: userId });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `orders/${orderId}`);
  }
}

// Secure Planner submissions & approvals under strict status lock transaction
export async function savePlannerApprovalTransactional(
  approvalData: any,
  collectionName: "medicalPlannerApprovals" | "salesPlannerApprovals",
  userId: string,
  userRole: string,
  userName: string,
  actionDetails: string
): Promise<void> {
  const approvalId = approvalData.id;
  const approvalRef = doc(db, collectionName, approvalId);

  // Proactive Offline Interceptor Check
  if (offlineFallbackHandler && (offlineFallbackHandler.getCurrentConnectivityStatus() === "offline" || !navigator.onLine)) {
    const module = collectionName === "medicalPlannerApprovals" ? "medicalPlanner" : "salesPlanner";
    offlineFallbackHandler.enqueueOfflineWrite(module, "create", approvalData, userId, userName, userRole);
    return;
  }

  try {
    await runTransaction(db, async (transaction) => {
      const docSnap = await transaction.get(approvalRef);
      const exists = docSnap.exists();

      if (exists) {
        const currentData = docSnap.data() as any;

        // Prevent double submission
        if (approvalData.status === "Pending Approval" && (currentData.status === "Pending Approval" || currentData.status === "Approved")) {
          throw new Error(`Planner plan for ${approvalData.period} has already been submitted or approved. Action blocked.`);
        }

        // Prevent double approval/rejection
        if (currentData.status === "Approved" || currentData.status === "Rejected") {
          if (approvalData.status === "Approved" || approvalData.status === "Rejected") {
            throw new Error(`Planner plan for ${approvalData.period} has already been '${currentData.status}'. Double action prevented.`);
          }
        }
      }

      const decorated = decorateRecord(approvalData, userId, exists ? "update" : "create");
      transaction.set(approvalRef, decorated);

      // Write Audit Log in same transaction
      const auditLogId = `AUD-${Math.floor(100000 + Math.random() * 900000)}`;
      const auditLogRef = doc(db, "auditLogs", auditLogId);
      const auditData = {
        id: auditLogId,
        userId: userId,
        userName: userName,
        userRole: userRole,
        action: approvalData.status === "Pending Approval" ? "Plan Submitted" : `Plan ${approvalData.status}`,
        entityType: collectionName === "medicalPlannerApprovals" ? "MedicalPlannerApproval" : "SalesPlannerApproval",
        entityId: approvalId,
        details: actionDetails,
        timestamp: new Date().toISOString()
      };
      const decoratedAudit = decorateRecord(auditData, userId, "create");
      transaction.set(auditLogRef, decoratedAudit);
    });
  } catch (error: any) {
    const errMsg = error?.message || String(error);
    const isNetworkError = errMsg.includes("network") || errMsg.includes("offline") || errMsg.includes("unavailable") || errMsg.includes("failed-precondition") || !navigator.onLine;
    if (isNetworkError && offlineFallbackHandler) {
      console.warn(`[Firestore Sync Fallback] Network error. Saving planner approval offline: ${errMsg}`);
      const module = collectionName === "medicalPlannerApprovals" ? "medicalPlanner" : "salesPlanner";
      offlineFallbackHandler.enqueueOfflineWrite(module, "create", approvalData, userId, userName, userRole);
      return;
    }
    handleFirestoreError(error, OperationType.WRITE, `${collectionName}/${approvalId}`);
  }
}

// Disburse sample and deduct allocation atomically inside a Transaction with negative inventory checks
export async function disburseSampleTransactional(
  newLog: any,
  prodName: string,
  disQty: number,
  currentUser: any
): Promise<void> {
  void prodName;
  if (!navigator.onLine) throw new Error("SAMPLE_DISTRIBUTION_REQUIRES_ONLINE_AUTHORITY");
  const firebaseUser = auth.currentUser;
  if (!firebaseUser || firebaseUser.uid !== currentUser.id) throw new Error("AUTHENTICATED_SAMPLE_ACTOR_REQUIRED");
  const physicianId = String(newLog.physicianId || "").trim(); const productId = String(newLog.productId || "").trim(); const sampleSkuId = String(newLog.sampleSkuId || "").trim();
  if (!physicianId || !productId || !sampleSkuId) throw new Error("CANONICAL_SAMPLE_IDENTIFIERS_REQUIRED");
  const token = await firebaseUser.getIdToken();
  const response = await fetch("/api/samples/distribute", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ id: newLog.id, physicianId, productId, sampleSkuId, quantity: disQty, notes: newLog.notes }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success !== true) throw new Error(result.code || "SAMPLE_DISTRIBUTION_FAILED");
}

// Receive sample stock securely in a transaction to prevent race conditions or negative inventory
export async function receiveSampleStockTransactional(
  receiptProductId: string,
  receiptQty: number,
  receiptFile: { name: string } | null,
  selectedSampleName: string,
  currentUser: any
): Promise<void> {
  const amount = Number(receiptQty);
  if (amount <= 0) throw new Error("Receipt quantity must be greater than zero.");

  // Proactive Offline Interceptor Check
  if (offlineFallbackHandler && (offlineFallbackHandler.getCurrentConnectivityStatus() === "offline" || !navigator.onLine)) {
    offlineFallbackHandler.enqueueOfflineWrite("stock", "receive", { receiptProductId, receiptQty, receiptFile, selectedSampleName }, currentUser.id, currentUser.name, currentUser.role);
    return;
  }

  try {
    // 1. Find warehouse item first
    const whSnap = await getDocs(collection(db, "sampleInventory"));
    let foundWhId: string | null = null;
    whSnap.forEach((doc) => {
      const data = doc.data();
      if (!data.isDeleted && data.sampleId === receiptProductId) {
        foundWhId = doc.id;
      }
    });

    const whId = foundWhId || `WH-${receiptProductId}`;
    const whRef = doc(db, "sampleInventory", whId);

    await runTransaction(db, async (transaction) => {
      let currentQty = 0;
      let currentAvail = 0;
      let brand = "—";
      let repsStock = 0;
      let reorder = 100;
      let exists = false;

      const whDocSnap = await transaction.get(whRef);
      if (whDocSnap.exists()) {
        const data = whDocSnap.data() as any;
        currentQty = Number(data.qty) || 0;
        currentAvail = Number(data.available) || 0;
        brand = data.brand || "—";
        repsStock = Number(data.repsStock) || 0;
        reorder = Number(data.reorder) || 100;
        exists = true;
      }

      const updatedWarehouseItem = {
        id: whId,
        sampleId: receiptProductId,
        name: selectedSampleName,
        brand: brand,
        batch: "—",
        qty: currentQty + amount,
        available: currentAvail + amount,
        repsStock: repsStock,
        reorder: reorder,
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser.id
      };

      const decoratedWh = decorateRecord(updatedWarehouseItem, currentUser.id, exists ? "update" : "create");
      transaction.set(whRef, decoratedWh, { merge: true });

      // Add transaction log
      const txId = `TX${Math.floor(1000 + Math.random() * 9000)}`;
      const txRef = doc(db, "sampleTransactions", txId);
      const newTx = {
        id: txId,
        datetime: new Date().toLocaleString(),
        type: "Warehouse Receipt",
        product: selectedSampleName,
        brand: brand,
        qty: amount,
        change: `${currentQty} -> ${currentQty + amount}`,
        source: "—",
        reason: "—",
        notes: `Receipt uploaded: Added ${amount} units. Filename: ${receiptFile ? receiptFile.name : "invoice_import.pdf"}`
      };
      const decoratedTx = decorateRecord(newTx, currentUser.id, "create");
      transaction.set(txRef, decoratedTx);

      // Save Audit Log
      const auditLogId = `AUD-${Math.floor(100000 + Math.random() * 900000)}`;
      const auditLogRef = doc(db, "auditLogs", auditLogId);
      const auditData = {
        id: auditLogId,
        userId: currentUser.id,
        userName: currentUser.name,
        userRole: currentUser.role,
        action: "Warehouse Receipt Processed",
        entityType: "SampleInventory",
        entityId: whId,
        details: `Processed warehouse receipt of ${amount} units of ${selectedSampleName}.`,
        timestamp: new Date().toISOString()
      };
      const decoratedAudit = decorateRecord(auditData, currentUser.id, "create");
      transaction.set(auditLogRef, decoratedAudit);
    });
  } catch (error: any) {
    const errMsg = error?.message || String(error);
    const isNetworkError = errMsg.includes("network") || errMsg.includes("offline") || errMsg.includes("unavailable") || errMsg.includes("failed-precondition") || !navigator.onLine;
    if (isNetworkError && offlineFallbackHandler) {
      console.warn(`[Firestore Sync Fallback] Network error. Saving warehouse receipt offline: ${errMsg}`);
      offlineFallbackHandler.enqueueOfflineWrite("stock", "receive", { receiptProductId, receiptQty, receiptFile, selectedSampleName }, currentUser.id, currentUser.name, currentUser.role);
      return;
    }
    handleFirestoreError(error, OperationType.WRITE, `sampleInventory/${receiptProductId}`);
  }
}

// Adjust sample stock securely in a transaction to prevent negative values
export async function adjustSampleStockTransactional(
  selectedAdjustProductId: string,
  selectedAdjustProductName: string,
  selectedAdjustProductBrand: string,
  targetQty: number,
  targetAvail: number,
  adjustReason: string,
  adjustNotes: string,
  currentUser: any
): Promise<void> {
  const whRef = doc(db, "sampleInventory", selectedAdjustProductId);

  // Proactive Offline Interceptor Check
  if (offlineFallbackHandler && (offlineFallbackHandler.getCurrentConnectivityStatus() === "offline" || !navigator.onLine)) {
    offlineFallbackHandler.enqueueOfflineWrite("stock", "adjust", { selectedAdjustProductId, selectedAdjustProductName, selectedAdjustProductBrand, targetQty, targetAvail, adjustReason, adjustNotes }, currentUser.id, currentUser.name, currentUser.role);
    return;
  }

  try {
    await runTransaction(db, async (transaction) => {
      const whDocSnap = await transaction.get(whRef);
      if (!whDocSnap.exists()) {
        throw new Error(`Sample inventory record with ID ${selectedAdjustProductId} does not exist.`);
      }

      const currentData = whDocSnap.data() as any;
      const oldQty = Number(currentData.qty) || 0;

      if (targetQty < 0 || targetAvail < 0) {
        throw new Error("Adjusted quantities cannot be negative. Adjustment blocked.");
      }

      const updatedWarehouseItem = {
        ...currentData,
        qty: targetQty,
        available: targetAvail,
        isWarning: targetQty === 0,
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser.id
      };

      const decoratedWh = decorateRecord(updatedWarehouseItem, currentUser.id, "update");
      transaction.set(whRef, decoratedWh, { merge: true });

      // Add transaction log
      const txId = `TX${Math.floor(1000 + Math.random() * 9000)}`;
      const txRef = doc(db, "sampleTransactions", txId);
      const newTx = {
        id: txId,
        datetime: new Date().toLocaleString(),
        type: "Adjustment",
        product: selectedAdjustProductName,
        brand: selectedAdjustProductBrand || "—",
        qty: targetQty - oldQty,
        change: `${oldQty} -> ${targetQty}`,
        source: "Physical Audit",
        reason: adjustReason,
        notes: adjustNotes || `Stock manually adjusted via admin console: ${adjustReason}`
      };
      const decoratedTx = decorateRecord(newTx, currentUser.id, "create");
      transaction.set(txRef, decoratedTx);

      // Save Audit Log
      const auditLogId = `AUD-${Math.floor(100000 + Math.random() * 900000)}`;
      const auditLogRef = doc(db, "auditLogs", auditLogId);
      const auditData = {
        id: auditLogId,
        userId: currentUser.id,
        userName: currentUser.name,
        userRole: currentUser.role,
        action: "Warehouse Stock Adjusted",
        entityType: "SampleInventory",
        entityId: selectedAdjustProductId,
        details: `Manually adjusted stock of ${selectedAdjustProductName}: Qty ${oldQty} -> ${targetQty}. Reason: ${adjustReason}`,
        timestamp: new Date().toISOString()
      };
      const decoratedAudit = decorateRecord(auditData, currentUser.id, "create");
      transaction.set(auditLogRef, decoratedAudit);
    });
  } catch (error: any) {
    const errMsg = error?.message || String(error);
    const isNetworkError = errMsg.includes("network") || errMsg.includes("offline") || errMsg.includes("unavailable") || errMsg.includes("failed-precondition") || !navigator.onLine;
    if (isNetworkError && offlineFallbackHandler) {
      console.warn(`[Firestore Sync Fallback] Network error. Saving warehouse adjustment offline: ${errMsg}`);
      offlineFallbackHandler.enqueueOfflineWrite("stock", "adjust", { selectedAdjustProductId, selectedAdjustProductName, selectedAdjustProductBrand, targetQty, targetAvail, adjustReason, adjustNotes }, currentUser.id, currentUser.name, currentUser.role);
      return;
    }
    handleFirestoreError(error, OperationType.WRITE, `sampleInventory/${selectedAdjustProductId}`);
  }
}

export async function createAuthUserViaAdminApi(params: {
  email: string;
  name: string;
  password?: string;
  disabled?: boolean;
  role: Role;
}): Promise<{ success: boolean; authUid: string; email: string; existing: boolean }> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error("A valid authentication session is required.");
  }

  const idToken = await currentUser.getIdToken();
  const response = await fetch("/api/admin/create-auth-user", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${idToken}`
    },
    body: JSON.stringify(params)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP error ${response.status} calling create-auth-user API.`);
  }

  return await response.json();
}
