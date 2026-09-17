import { CANONICAL_USER_ROLES, Role, normalizeRole, type User } from "../src/types";
import { validateManager } from "../src/lib/userPolicyEngine";
import { validateBusinessDocumentCode, validateMarketSettings, type MarketBusinessSettings } from "../src/lib/marketSettings";
import { isRuntimeOrderWorkflowTemplate } from "../src/features/orders/orderWorkflowTemplate";

export type ReadinessSeverity = "FAIL" | "WARN";
export interface ReadinessIssue { severity: ReadinessSeverity; category: string; code: string; recordId?: string }
export interface ReadinessRow extends Record<string, unknown> { id: string }
export interface ProductionReadinessSnapshot {
  metadata: { projectId: string; databaseId: string; mode: "PRODUCTION_READ_ONLY_EXPORT" };
  authUsers: Array<{ uid: string; email?: string; disabled?: boolean }>;
  collections: Record<string, ReadinessRow[]>;
  external: {
    firestorePitrConfigured: boolean;
    verifiedBackupExport: boolean;
    storageBucketConfigured: boolean;
    storageProtectionConfigured: boolean;
    schedulerAudienceConfigured: boolean;
    schedulerServiceAccountConfigured: boolean;
  };
}
export interface ProductionReadinessReport { status: "PASS" | "FAIL"; failures: number; warnings: number; issues: ReadinessIssue[] }

const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const active = (row: ReadinessRow): boolean => row.active !== false && row.isActive !== false && row.isDeleted !== true && text(row.status).toUpperCase() !== "INACTIVE";
const rows = (snapshot: ProductionReadinessSnapshot, name: string): ReadinessRow[] => snapshot.collections[name] || [];
const ids = (values: ReadinessRow[]): Set<string> => new Set(values.map(value => value.id).filter(Boolean));
const obviousCertificationRecord = (row: ReadinessRow): boolean => row.isTestData === true
  || /^(uat|demo|synthetic)[-_]/i.test(row.id)
  || [row.source, row.assignmentSource].some(value => /^(uat|demo|mock|synthetic)([-_]|$)/i.test(text(value)));

export function assertProductionSnapshotIdentity(metadata: ProductionReadinessSnapshot["metadata"], expectedProjectId: string, expectedDatabaseId: string, env: Record<string, string | undefined> = process.env): void {
  if (!expectedProjectId.trim() || !expectedDatabaseId.trim()) throw new Error("PRODUCTION_VALIDATION_IDENTITY_REQUIRED");
  if (metadata.mode !== "PRODUCTION_READ_ONLY_EXPORT" || metadata.projectId !== expectedProjectId || metadata.databaseId !== expectedDatabaseId) throw new Error("PRODUCTION_VALIDATION_IDENTITY_MISMATCH");
  if (/^(demo-|uat-|test-)/i.test(metadata.projectId) || [env.FIRESTORE_EMULATOR_HOST, env.FIREBASE_AUTH_EMULATOR_HOST, env.FIREBASE_STORAGE_EMULATOR_HOST].some(value => Boolean(value?.trim()))) throw new Error("PRODUCTION_VALIDATION_ISOLATION_REQUIRED");
}

export function validateProductionReadiness(snapshot: ProductionReadinessSnapshot): ProductionReadinessReport {
  const issues: ReadinessIssue[] = [];
  const add = (severity: ReadinessSeverity, category: string, code: string, recordId?: string) => issues.push({ severity, category, code, ...(recordId ? { recordId } : {}) });
  const requireRows = (name: string) => { if (!rows(snapshot, name).length) add("FAIL", name, "REQUIRED_COLLECTION_EMPTY"); };

  for (const name of ["users", "rolePermissions", "countries", "districts", "cities", "areas", "marketSettings", "productPromotionGroups", "products", "physicianSpecialties", "physicians", "pharmacies", "keyMessages", "orderWorkflowTemplates"]) requireRows(name);
  if (!snapshot.authUsers.length) add("FAIL", "identity", "AUTH_USERS_REQUIRED");

  const authByUid = new Map<string, number>();
  const authRecordByUid = new Map(snapshot.authUsers.map(user => [user.uid, user]));
  const authEmail = new Map<string, string>();
  snapshot.authUsers.forEach(user => {
    authByUid.set(user.uid, (authByUid.get(user.uid) || 0) + 1);
    const email = text(user.email).toLowerCase();
    if (email && authEmail.has(email) && authEmail.get(email) !== user.uid) add("FAIL", "identity", "DUPLICATE_AUTH_EMAIL", user.uid);
    if (email) authEmail.set(email, user.uid);
  });
  const userRows = rows(snapshot, "users");
  const userIds = ids(userRows);
  const userEmail = new Map<string, string>();
  const permissionIds = ids(rows(snapshot, "rolePermissions").filter(active));
  userRows.forEach(user => {
    if (user.id !== text(user.uid)) add("FAIL", "identity", "USER_DOCUMENT_UID_MISMATCH", user.id);
    if (authByUid.get(user.id) !== 1) add("FAIL", "identity", "AUTH_UID_CARDINALITY_INVALID", user.id);
    if (active(user) && authRecordByUid.get(user.id)?.disabled === true) add("FAIL", "identity", "OPERATIONAL_AUTH_USER_DISABLED", user.id);
    const email = text(user.email).toLowerCase();
    if (email && userEmail.has(email) && userEmail.get(email) !== user.id) add("FAIL", "identity", "DUPLICATE_PROFILE_EMAIL", user.id);
    if (email) userEmail.set(email, user.id);
    const role = normalizeRole(text(user.role));
    if (!CANONICAL_USER_ROLES.includes(role as Role)) add("FAIL", "roles", "NON_CANONICAL_ROLE", user.id);
    else if (!permissionIds.has(String(role))) add("FAIL", "roles", "ACTIVE_ROLE_PERMISSION_REQUIRED", user.id);
  });
  snapshot.authUsers.forEach(user => { if (!userIds.has(user.uid)) add("FAIL", "identity", "AUTH_PROFILE_REQUIRED", user.uid); });
  const typedUsers = userRows as unknown as User[];
  userRows.filter(active).forEach(user => {
    const manager = validateManager(user as unknown as Partial<User>, typedUsers);
    if (!manager.isValid) add("FAIL", "hierarchy", "INVALID_MANAGER_RELATIONSHIP", user.id);
  });

  const countries = new Map(rows(snapshot, "countries").map(row => [row.id, row]));
  const districts = new Map(rows(snapshot, "districts").map(row => [row.id, row]));
  const cities = new Map(rows(snapshot, "cities").map(row => [row.id, row]));
  const areas = new Map(rows(snapshot, "areas").map(row => [row.id, row]));
  areas.forEach(area => {
    const district = districts.get(text(area.districtId)), city = cities.get(text(area.cityId)), country = countries.get(text(area.countryId));
    if (!country || !district || !city || text(district.countryId) !== area.countryId || text(city.countryId) !== area.countryId || text(city.districtId) !== area.districtId) add("FAIL", "geography", "INVALID_GEOGRAPHY_ANCESTRY", area.id);
  });

  const territoryRows = rows(snapshot, "userTerritoryAssignments").filter(active);
  territoryRows.forEach(assignment => {
    const area = areas.get(text(assignment.areaId || assignment.territoryId));
    if (!userIds.has(text(assignment.userId)) || !area || !active(area) || (text(assignment.countryId) && assignment.countryId !== area.countryId) || (text(assignment.districtId) && assignment.districtId !== area.districtId) || (text(assignment.cityId) && assignment.cityId !== area.cityId)) add("FAIL", "assignments", "ORPHAN_OR_MISMATCHED_TERRITORY_ASSIGNMENT", assignment.id);
  });

  const groups = new Map(rows(snapshot, "productPromotionGroups").map(row => [row.id, row]));
  const products = new Map(rows(snapshot, "products").map(row => [row.id, row]));
  products.forEach(product => { const group = groups.get(text(product.promotionGroupId)); if (active(product) && (!group || !active(group))) add("FAIL", "products", "ACTIVE_PRODUCT_GROUP_REQUIRED", product.id); });
  const productRows = rows(snapshot, "userProductAssignments").filter(active);
  productRows.forEach(assignment => {
    const product = products.get(text(assignment.productId)), group = groups.get(text(assignment.productGroupId));
    if (!userIds.has(text(assignment.userId)) || !product || !active(product) || !group || !active(group) || text(product.promotionGroupId) !== assignment.productGroupId) add("FAIL", "assignments", "ORPHAN_OR_MISMATCHED_PRODUCT_ASSIGNMENT", assignment.id);
  });
  userRows.filter(user => active(user) && [Role.MEDICAL_REP, Role.SALES_REP].includes(normalizeRole(text(user.role)) as Role)).forEach(user => {
    const primary = groups.get(text(user.primaryPromotionGroupId));
    if (!primary || !active(primary)) add("FAIL", "assignments", "ACTIVE_PRIMARY_PROMOTION_GROUP_REQUIRED", user.id);
    if (!territoryRows.some(row => row.userId === user.id)) add("FAIL", "assignments", "ACTIVE_TERRITORY_ASSIGNMENT_REQUIRED", user.id);
    if (!productRows.some(row => row.userId === user.id)) add("FAIL", "assignments", "ACTIVE_PRODUCT_ASSIGNMENT_REQUIRED", user.id);
    if (user.assignmentSyncStatus !== "COMPLETE") add("FAIL", "assignments", "ASSIGNMENT_SYNC_INCOMPLETE", user.id);
  });

  const specialtyIds = ids(rows(snapshot, "physicianSpecialties").filter(active));
  rows(snapshot, "physicians").filter(active).forEach(physician => {
    if (!areas.has(text(physician.areaId))) add("FAIL", "physicians", "PHYSICIAN_AREA_REQUIRED", physician.id);
    if (!specialtyIds.has(text(physician.specialtyId))) add("FAIL", "physicians", "PHYSICIAN_SPECIALTY_REQUIRED", physician.id);
    const primary = groups.get(text(physician.primaryPromotionGroupId));
    if (!primary || !active(primary)) add("FAIL", "physicians", "PHYSICIAN_PRIMARY_GROUP_REQUIRED", physician.id);
    const aligned = Array.isArray(physician.alignedProductIds) ? physician.alignedProductIds.map(text) : [];
    if (!aligned.length || aligned.some(id => !products.has(id) || !active(products.get(id)!))) add("FAIL", "physicians", "PHYSICIAN_PRODUCT_ALIGNMENT_INVALID", physician.id);
    const targets = Array.isArray(physician.targetPromotionGroupIds) ? physician.targetPromotionGroupIds.map(text) : [];
    if (targets.some(id => !groups.has(id) || !active(groups.get(id)!))) add("FAIL", "physicians", "PHYSICIAN_TARGET_GROUP_INVALID", physician.id);
  });
  rows(snapshot, "keyMessages").filter(active).forEach(message => { if (!products.has(text(message.productId)) || !active(products.get(text(message.productId))!)) add("FAIL", "keyMessages", "KEY_MESSAGE_PRODUCT_INVALID", message.id); });

  const markets = rows(snapshot, "marketSettings");
  const marketByCountry = new Map<string, ReadinessRow[]>();
  markets.filter(active).forEach(market => {
    if (validateMarketSettings(market as unknown as MarketBusinessSettings).length || !validateBusinessDocumentCode(market.businessDocumentCode)) add("FAIL", "markets", "MARKET_CONFIGURATION_INVALID", market.id);
    const countryId = text(market.countryId); marketByCountry.set(countryId, [...(marketByCountry.get(countryId) || []), market]);
  });
  marketByCountry.forEach((countryMarkets, countryId) => { if (countryMarkets.length !== 1) add("FAIL", "markets", "ACTIVE_MARKET_CARDINALITY_INVALID", countryId); });
  countries.forEach(country => { if (active(country) && marketByCountry.get(country.id)?.length !== 1) add("FAIL", "markets", "ACTIVE_COUNTRY_MARKET_REQUIRED", country.id); });
  rows(snapshot, "businessCalendarExceptions").filter(active).forEach(exception => {
    if (!markets.some(market => market.id === exception.marketId && active(market)) || !/^\d{4}-\d{2}-\d{2}$/.test(text(exception.date))) add("FAIL", "attendance", "CALENDAR_EXCEPTION_INVALID", exception.id);
  });
  rows(snapshot, "pharmacies").filter(active).forEach(pharmacy => {
    const area = areas.get(text(pharmacy.areaId));
    const market = area ? marketByCountry.get(text(area.countryId)) : undefined;
    if (!area || !active(area)) add("FAIL", "pharmacies", "PHARMACY_AREA_REQUIRED", pharmacy.id);
    if (!market || market.length !== 1) add("FAIL", "pharmacies", "PHARMACY_FINANCIAL_IDENTITY_UNRESOLVED", pharmacy.id);
  });
  const profiles = new Map(rows(snapshot, "customerFinancialProfiles").map(row => [text(row.pharmacyId) || row.id, row]));
  rows(snapshot, "pharmacies").filter(active).forEach(pharmacy => {
    const profile = profiles.get(pharmacy.id);
    if (!profile) add("WARN", "financial", "CUSTOMER_PROFILE_WILL_INITIALIZE_ON_FIRST_POSTING", pharmacy.id);
    else {
      const area = areas.get(text(pharmacy.areaId)), market = area ? marketByCountry.get(text(area.countryId))?.[0] : undefined;
      if (!market || text(profile.marketId) !== market.id || text(profile.currencyCode || profile.currency) !== market.currencyCode) add("FAIL", "financial", "CUSTOMER_PROFILE_FINANCIAL_IDENTITY_INVALID", pharmacy.id);
    }
  });

  const template = rows(snapshot, "orderWorkflowTemplates").find(row => row.id === "ENTERPRISE_V1");
  if (!template || !isRuntimeOrderWorkflowTemplate(template)) add("FAIL", "commercial", "ENTERPRISE_WORKFLOW_REQUIRED", "ENTERPRISE_V1");
  else {
    const stages = new Set((template.stages as Array<{ stage?: string; active?: boolean }>).filter(stage => stage.active).map(stage => stage.stage));
    for (const stage of ["SUBMISSION", "FINANCE_REVIEW", "OPERATIONS_REVIEW", "STORE_PREPARATION", "DELIVERY"]) if (!stages.has(stage)) add("FAIL", "commercial", "ENTERPRISE_WORKFLOW_STAGE_REQUIRED", stage);
  }
  const sequences = rows(snapshot, "businessDocumentSequences");
  if (!sequences.length) add("WARN", "documentSequences", "SEQUENCES_WILL_INITIALIZE_TRANSACTIONALLY");
  sequences.forEach(sequence => { if (!/^[A-Z0-9]{2,8}$/.test(text(sequence.countryCode)) || !/^[A-Z]{2,3}$/.test(text(sequence.documentPrefix)) || !Number.isInteger(sequence.year) || !Number.isSafeInteger(sequence.lastSequence) || Number(sequence.lastSequence) < 0) add("FAIL", "documentSequences", "DOCUMENT_SEQUENCE_INVALID", sequence.id); });

  const skus = rows(snapshot, "sampleCatalog").filter(active), batches = rows(snapshot, "sampleBatches").filter(active), allocations = rows(snapshot, "sampleAllocations").filter(active);
  if (!skus.length) add("WARN", "samples", "SAMPLE_DISTRIBUTION_NOT_CONFIGURED");
  skus.forEach(sku => { if (!products.has(text(sku.productId))) add("FAIL", "samples", "SAMPLE_SKU_PRODUCT_INVALID", sku.id); });
  batches.forEach(batch => { if (!skus.some(sku => sku.id === batch.sampleSkuId) || !/^\d{4}-\d{2}-\d{2}$/.test(text(batch.expiryDate)) || !Number.isFinite(Date.parse(`${text(batch.expiryDate)}T00:00:00Z`)) || !Number.isFinite(Number(batch.availableQuantity)) || Number(batch.availableQuantity) < 0 || Number(batch.availableQuantity) > Number(batch.receivedQuantity)) add("FAIL", "samples", "SAMPLE_BATCH_INVALID", batch.id); });
  allocations.forEach(allocation => { if (!userIds.has(text(allocation.repId)) || !skus.some(sku => sku.id === allocation.sampleSkuId) || !batches.some(batch => batch.id === allocation.batchId && batch.sampleSkuId === allocation.sampleSkuId) || !Number.isFinite(Number(allocation.quantityRemaining)) || Number(allocation.quantityRemaining) < 0 || Number(allocation.quantityRemaining) > Number(allocation.quantityAllocated)) add("FAIL", "samples", "SAMPLE_ALLOCATION_INVALID", allocation.id); });

  Object.entries(snapshot.external).forEach(([name, configured]) => { if (!configured) add("FAIL", "externalConfiguration", `${name.replace(/[A-Z]/g, letter => `_${letter}`).toUpperCase()}_REQUIRED`); });
  Object.entries(snapshot.collections).forEach(([name, collection]) => collection.forEach(row => { if (obviousCertificationRecord(row)) add("FAIL", "dataHygiene", "CERTIFICATION_RECORD_IN_AUTHORITATIVE_COLLECTION", `${name}/${row.id}`); }));

  const failures = issues.filter(issue => issue.severity === "FAIL").length;
  return { status: failures ? "FAIL" : "PASS", failures, warnings: issues.filter(issue => issue.severity === "WARN").length, issues };
}
