/**
 * MENAREPS 2.0 - Import Normalization Utility
 * Recursively removes all keys with undefined values from an object, array, or nested structure.
 * This guarantees that WriteBatch.set() never encounters illegal undefined values,
 * while preserving valid null, false, empty strings, and complex objects.
 */
export function isPlainObject(item: any): boolean {
  if (item === null || typeof item !== "object") return false;
  if (Array.isArray(item)) return false;
  if (item instanceof Date) return false;
  const proto = Object.getPrototypeOf(item);
  return proto === null || proto.constructor === Object || proto.constructor?.name === "Object";
}

export function getUndefinedPaths(obj: any, path = ""): string[] {
  if (obj === null || obj === undefined || typeof obj !== "object") {
    return [];
  }

  const paths: string[] = [];

  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      const currentPath = `${path}[${index}]`;
      paths.push(...getUndefinedPaths(item, currentPath));
    });
  } else if (isPlainObject(obj)) {
    for (const key of Object.keys(obj)) {
      const val = (obj as any)[key];
      const currentPath = path ? `${path}.${key}` : key;
      if (val === undefined) {
        paths.push(currentPath);
      } else if (val !== null && typeof val === "object") {
        paths.push(...getUndefinedPaths(val, currentPath));
      }
    }
  }

  return paths;
}

/**
 * MENAREPS 2.0 - Import Normalization Utility
 * Recursively removes all keys with undefined values from an object, array, or nested structure.
 * This guarantees that WriteBatch.set() or Transaction.set() never encounters illegal undefined values,
 * while preserving valid null, false, 0, empty strings, empty arrays, and complex objects like Timestamp or Date.
 */
export function removeUndefinedRecursively<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => removeUndefinedRecursively(item)) as any;
  }

  if (isPlainObject(obj)) {
    const cleaned: any = {};
    for (const key of Object.keys(obj)) {
      const val = (obj as any)[key];
      if (val !== undefined) {
        cleaned[key] = removeUndefinedRecursively(val);
      }
    }
    return cleaned as T;
  }

  return obj;
}

export function sanitizeAndAuditPayload<T>(
  entityType: string,
  documentId: string,
  rawPayload: T,
  validateFn?: (payload: any) => string[]
): T {
  const removedUndefinedPaths = getUndefinedPaths(rawPayload);
  const requiredFieldErrors = validateFn ? validateFn(rawPayload) : [];
  const safeForFirestore = requiredFieldErrors.length === 0;

  console.info("[FIRESTORE_PAYLOAD_SANITIZATION_JSON]", JSON.stringify({
    entityType,
    documentId,
    removedUndefinedPaths,
    requiredFieldErrors,
    safeForFirestore
  }));

  if (requiredFieldErrors.length > 0) {
    throw new Error(`Required field validation failed for ${entityType} (${documentId}): ${requiredFieldErrors.join("; ")}`);
  }

  return removeUndefinedRecursively(rawPayload);
}

export function isRepresentativeRole(role?: string | null): boolean {
  if (!role) return false;
  const trimmed = role.trim();
  return (
    trimmed === "Sales Representative" ||
    trimmed === "Medical Representative" ||
    trimmed === "SALES_REP" ||
    trimmed === "MEDICAL_REP"
  );
}

export function sanitizeUserSavePayload(
  userId: string,
  role: string,
  rawPayload: any
): any {
  const isRep = isRepresentativeRole(role);
  const clone = { ...rawPayload };
  const omittedRepresentativeFields: string[] = [];

  const representativeOnlyKeys = [
    "primaryPromotionGroupId",
    "targetPromotionGroupIds",
    "assignedProductIds",
    "products",
    "productAssignments"
  ];

  if (!isRep) {
    for (const key of representativeOnlyKeys) {
      if (key in clone || clone[key] !== undefined) {
        delete clone[key];
        omittedRepresentativeFields.push(key);
      }
    }
  }

  const removedUndefinedPaths = getUndefinedPaths(rawPayload);
  const sanitized = removeUndefinedRecursively(clone);

  console.info("[ORDER_OFFICER_USER_SAVE_SANITIZATION_JSON]", JSON.stringify({
    userId: userId || "",
    role: role || "",
    representativeRole: isRep,
    removedUndefinedPaths,
    omittedRepresentativeFields,
    safeForFirestore: true
  }));

  return sanitized;
}

/**
 * Sanitizes and strips undefined fields, nulls, and empty string fallbacks recursively,
 * ensuring no empty/null fields are written for optional fields.
 */
export function stripUndefinedFields<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => stripUndefinedFields(item)) as any;
  }

  if (typeof obj === "object") {
    if (obj instanceof Date) {
      return obj;
    }

    const cleaned: any = {};
    for (const key of Object.keys(obj)) {
      const val = (obj as any)[key];
      // Do not write undefined, null, or empty string/whitespace fallbacks
      if (val !== undefined && val !== null && (typeof val !== "string" || val.trim() !== "")) {
        cleaned[key] = stripUndefinedFields(val);
      }
    }
    return cleaned as T;
  }

  return obj;
}

export interface GeographyResolutionResult {
  isValid: boolean;
  error?: string;
  countryId?: string;
  countryName?: string;
  districtId?: string;
  districtName?: string;
  cityId?: string;
  cityName?: string;
  areaId?: string;
  areaName?: string;
  areaCode?: string;
}

export function normText(str: string): string {
  return (str || "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Checks if a geographic registry record is a canonical/active master area
 */
export function isCanonical(record: any): boolean {
  if (!record || !record.id || record.active === false || record.isDeleted === true) return false;
  const status = String(record.status || "").trim().toLowerCase();
  return !["inactive", "deleted", "archived", "legacy"].includes(status);
}

export interface GeographyRegistries {
  countries: any[];
  districts: any[];
  cities: any[];
  areas: any[];
}

/**
 * Shared case and spelling normalizer for geography labels
 */
export function normalizeGeoLabel(str: string): string {
  const trimmed = (str || "").trim().toLowerCase().replace(/\s+/g, " ");
  // Support approved spelling aliases
  if (trimmed === "tajura") {
    return "tajoura";
  }
  if (trimmed === "janzour") {
    return "janzur";
  }
  return trimmed;
}

/**
 * Resolves geography tuple strictly and deterministically using the Country > District > City > Area hierarchy.
 * Never performs unsafe global area-name-only fallback resolution.
 */
export function resolveGeographyTuple(
  country: string,
  district: string,
  city: string,
  area: string,
  registriesOrAreas: GeographyRegistries | any[]
): GeographyResolutionResult {
  const normC = normalizeGeoLabel(country);
  const normD = normalizeGeoLabel(district);
  const normCt = normalizeGeoLabel(city);
  const normA = normalizeGeoLabel(area);

  if (!normC || !normD || !normCt || !normA) {
    return {
      isValid: false,
      error: `Missing geography fields. Got Country: "${country || "empty"}", District: "${district || "empty"}", City: "${city || "empty"}", Area: "${area || "empty"}".`
    };
  }

  const submittedPath = `${country} > ${district} > ${city} > ${area}`;
  const registries: GeographyRegistries = Array.isArray(registriesOrAreas)
    ? {
        areas: registriesOrAreas,
        countries: registriesOrAreas.map(a => ({ id: a.countryId, name: a.countryName })).filter(a => a.id),
        districts: registriesOrAreas.map(a => ({ id: a.districtId, name: a.districtName, countryId: a.countryId })).filter(a => a.id),
        cities: registriesOrAreas.map(a => ({ id: a.cityId, name: a.cityName, districtId: a.districtId, countryId: a.countryId })).filter(a => a.id),
      }
    : registriesOrAreas;
  const uniqueById = (records: any[]) => Array.from(new Map(records.map(record => [record.id, record])).values());
  const active = (records: any[]) => uniqueById(records).filter(isCanonical);
  const countries = active(registries.countries).filter(record => normalizeGeoLabel(record.name) === normC);
  if (countries.length !== 1) return { isValid: false, error: countries.length > 1 ? `Ambiguous geography path. Multiple active Country records matched: ${submittedPath}.` : `Invalid geography hierarchy: Submitted path: ${submittedPath}. Country was not found.` };
  const countryMatch = countries[0];
  const districts = active(registries.districts).filter(record => record.countryId === countryMatch.id && normalizeGeoLabel(record.name) === normD);
  if (districts.length !== 1) return { isValid: false, error: districts.length > 1 ? `Ambiguous geography path. Multiple active District records matched: ${submittedPath}.` : `Invalid geography hierarchy: Submitted path: ${submittedPath}. District does not belong to Country.` };
  const districtMatch = districts[0];
  const cities = active(registries.cities).filter(record => record.districtId === districtMatch.id && record.countryId === countryMatch.id && normalizeGeoLabel(record.name) === normCt);
  if (cities.length !== 1) return { isValid: false, error: cities.length > 1 ? `Ambiguous geography path. Multiple active City records matched: ${submittedPath}.` : `Invalid geography hierarchy: Submitted path: ${submittedPath}. City does not belong to District.` };
  const cityMatch = cities[0];
  const areas = active(registries.areas).filter(record => record.cityId === cityMatch.id && record.districtId === districtMatch.id && record.countryId === countryMatch.id && normalizeGeoLabel(record.name) === normA);
  if (areas.length !== 1) {
    const error = areas.length > 1
      ? `Ambiguous geography path. Multiple active Area records matched the hierarchy: ${submittedPath}.`
      : `Area ${area.toUpperCase()} does not exist in the active geographic master registry for the submitted hierarchy: ${submittedPath}.`;
    return { isValid: false, error };
  }
  const areaMatch = areas[0];
  return {
    isValid: true,
    countryId: countryMatch.id,
    countryName: countryMatch.name,
    districtId: districtMatch.id,
    districtName: districtMatch.name,
    cityId: cityMatch.id,
    cityName: cityMatch.name,
    areaId: areaMatch.id,
    areaName: areaMatch.name,
    areaCode: areaMatch.code || areaMatch.id,
  };
}

export interface ResolvedGeography {
  countryName: string;
  countryId: string;
  districtName: string;
  districtId: string;
  cityName: string;
  cityId: string;
  areaName: string;
  areaId: string;
  source: 'canonical' | 'registry_fallback' | 'literal_fallback';
}

/**
 * Resolves the geography fields for existing records from the database.
 * First uses areaId for deterministic canonical lookup, otherwise falls back to full hierarchy.
 */
export function resolveRecordGeography(
  record: any,
  allAreas: any[]
): ResolvedGeography {
  const cId = record?.countryId;
  const cName = record?.countryName || record?.country;
  const dId = record?.districtId;
  const dName = record?.districtName || record?.district;
  const ctId = record?.cityId;
  const ctName = record?.cityName || record?.city || record?.region;
  const aId = record?.areaId;
  const aName = record?.areaName || record?.area || record?.territory;

  // 1. If valid canonical area ID is stored, fetch its properties
  if (aId) {
    const areaMatch = allAreas.find(a => a.id === aId);
    if (areaMatch) {
      return {
        countryId: areaMatch.countryId || cId || "",
        countryName: areaMatch.countryName || cName || "",
        districtId: areaMatch.districtId || dId || "",
        districtName: areaMatch.districtName || dName || "",
        cityId: areaMatch.cityId || ctId || "",
        cityName: areaMatch.cityName || ctName || "",
        areaId: areaMatch.id,
        areaName: areaMatch.name,
        source: 'canonical'
      };
    }
  }

  // 2. Otherwise, resolve strictly using the complete Country > District > City > Area hierarchy
  const normC = normalizeGeoLabel(cName || "");
  const normD = normalizeGeoLabel(dName || "");
  const normCt = normalizeGeoLabel(ctName || "");
  const normA = normalizeGeoLabel(aName || "");

  if (normC && normD && normCt && normA) {
    const candidates = allAreas.filter(a => 
      normalizeGeoLabel(a.countryName) === normC &&
      normalizeGeoLabel(a.districtName) === normD &&
      normalizeGeoLabel(a.cityName) === normCt &&
      normalizeGeoLabel(a.name) === normA
    );

    const canonicalCandidates = candidates.filter(isCanonical);

    if (canonicalCandidates.length === 1) {
      const match = canonicalCandidates[0];
      return {
        countryId: match.countryId || "",
        countryName: match.countryName || "",
        districtId: match.districtId || "",
        districtName: match.districtName || "",
        cityId: match.cityId || "",
        cityName: match.cityName || "",
        areaId: match.id,
        areaName: match.name,
        source: 'registry_fallback'
      };
    } else if (candidates.length === 1) {
      const match = candidates[0];
      return {
        countryId: match.countryId || "",
        countryName: match.countryName || "",
        districtId: match.districtId || "",
        districtName: match.districtName || "",
        cityId: match.cityId || "",
        cityName: match.cityName || "",
        areaId: match.id,
        areaName: match.name,
        source: 'registry_fallback'
      };
    }
  }

  // 3. Keep existing fields as fallback
  return {
    countryId: cId || "",
    countryName: cName || "",
    districtId: dId || "",
    districtName: dName || "",
    cityId: ctId || "",
    cityName: ctName || "",
    areaId: aId || "",
    areaName: aName || "",
    source: 'literal_fallback'
  };
}

export interface ClassificationResult {
  classification: "CANONICAL" | "ALIAS_RESOLVABLE" | "LEGACY_RESOLVABLE" | "CONFLICTING_IDS_AND_LABELS" | "INVALID_HIERARCHY" | "AMBIGUOUS" | "UNRESOLVED";
  proposedGeo?: {
    countryId: string;
    countryName: string;
    districtId: string;
    districtName: string;
    cityId: string;
    cityName: string;
    areaId: string;
    areaName: string;
    areaCode: string;
  };
  fieldsToChange?: string[];
  reason?: string;
}

/**
 * Classifies an existing Physician record's geography status.
 */
export function classifyPhysicianGeography(p: any, allAreas: any[]): ClassificationResult {
  const cName = p.countryName || p.country || "";
  const dName = p.districtName || p.district || "";
  const ctName = p.cityName || p.city || p.region || "";
  const aName = p.areaName || p.area || p.territory || "";
  const aId = p.areaId || "";

  const normC = normalizeGeoLabel(cName);
  const normD = normalizeGeoLabel(dName);
  const normCt = normalizeGeoLabel(ctName);
  const normA = normalizeGeoLabel(aName);

  // 1. Check for CONFLICTING_IDS_AND_LABELS
  if (aId) {
    const areaRecord = allAreas.find(a => a.id === aId);
    if (areaRecord) {
      const canonicalRecord = isCanonical(areaRecord) ? areaRecord : allAreas.find(a => isCanonical(a) && normalizeGeoLabel(a.name) === normalizeGeoLabel(areaRecord.name));
      const targetRecord = canonicalRecord || areaRecord;

      const recordNormC = normalizeGeoLabel(targetRecord.countryName);
      const recordNormD = normalizeGeoLabel(targetRecord.districtName);
      const recordNormCt = normalizeGeoLabel(targetRecord.cityName);
      const recordNormA = normalizeGeoLabel(targetRecord.name);

      // If the stored labels differ from the Area ID's actual hierarchy
      if (normC && normD && normCt && normA && (
        normC !== recordNormC ||
        normD !== recordNormD ||
        normCt !== recordNormCt ||
        normA !== recordNormA
      )) {
        return {
          classification: "CONFLICTING_IDS_AND_LABELS",
          reason: `Stored areaId "${aId}" maps to "${targetRecord.countryName} > ${targetRecord.districtName} > ${targetRecord.cityName} > ${targetRecord.name}", which conflicts with stored labels "${cName} > ${dName} > ${ctName} > ${aName}".`
        };
      }
    }
  }

  // 2. Resolve the stored labels using resolveGeographyTuple
  const geoResult = resolveGeographyTuple(cName, dName, ctName, aName, allAreas);

  if (geoResult.isValid) {
    const matchArea = allAreas.find(a => a.id === geoResult.areaId);
    
    // Check if the current record is fully CANONICAL
    const hasCorrectIds = 
      p.countryId === geoResult.countryId &&
      p.districtId === geoResult.districtId &&
      p.cityId === geoResult.cityId &&
      p.areaId === geoResult.areaId;

    const hasCorrectLabels = 
      p.countryName === geoResult.countryName &&
      p.districtName === geoResult.districtName &&
      p.cityName === geoResult.cityName &&
      (p.areaName === geoResult.areaName || p.area === geoResult.areaName);

    if (hasCorrectIds && hasCorrectLabels && matchArea && isCanonical(matchArea)) {
      return {
        classification: "CANONICAL",
        reason: "All IDs and text labels match active canonical master record."
      };
    }

    // Determine if it is ALIAS_RESOLVABLE or LEGACY_RESOLVABLE
    // It is an ALIAS_RESOLVABLE if the original labels used an alias (e.g. "TAJURA" vs "TAJOURA")
    // or didn't match the canonical casing/spelling.
    const usedAlias = 
      (cName !== geoResult.countryName) ||
      (dName !== geoResult.districtName) ||
      (ctName !== geoResult.cityName) ||
      (aName !== geoResult.areaName);

    const classification = usedAlias ? "ALIAS_RESOLVABLE" : "LEGACY_RESOLVABLE";

    // Build proposed geo fields to change
    const proposedGeo = {
      countryId: geoResult.countryId || "",
      countryName: geoResult.countryName || "",
      districtId: geoResult.districtId || "",
      districtName: geoResult.districtName || "",
      cityId: geoResult.cityId || "",
      cityName: geoResult.cityName || "",
      areaId: geoResult.areaId || "",
      areaName: geoResult.areaName || "",
      areaCode: geoResult.areaCode || ""
    };

    const fieldsToChange: string[] = [];
    if (p.countryId !== proposedGeo.countryId) fieldsToChange.push("countryId");
    if (p.countryName !== proposedGeo.countryName) fieldsToChange.push("countryName");
    if (p.country !== proposedGeo.countryName) fieldsToChange.push("country");
    if (p.districtId !== proposedGeo.districtId) fieldsToChange.push("districtId");
    if (p.districtName !== proposedGeo.districtName) fieldsToChange.push("districtName");
    if (p.district !== proposedGeo.districtName) fieldsToChange.push("district");
    if (p.cityId !== proposedGeo.cityId) fieldsToChange.push("cityId");
    if (p.cityName !== proposedGeo.cityName) fieldsToChange.push("cityName");
    if (p.city !== proposedGeo.cityName) fieldsToChange.push("city");
    if (p.region !== proposedGeo.cityName) fieldsToChange.push("region");
    if (p.areaId !== proposedGeo.areaId) fieldsToChange.push("areaId");
    if (p.areaName !== proposedGeo.areaName) fieldsToChange.push("areaName");
    if (p.area !== proposedGeo.areaName) fieldsToChange.push("area");
    if (p.territory !== proposedGeo.areaName) fieldsToChange.push("territory");
    if (p.areaCode !== proposedGeo.areaCode) fieldsToChange.push("areaCode");

    return {
      classification,
      proposedGeo,
      fieldsToChange,
      reason: `Successfully resolved to canonical Area "${geoResult.countryName} > ${geoResult.districtName} > ${geoResult.cityName} > ${geoResult.areaName}" via hierarchy.`
    };
  }

  // 3. Fallbacks when resolveGeographyTuple fails
  const errMsg = geoResult.error || "";
  
  if (errMsg.includes("Invalid geography hierarchy") || errMsg.includes("belongs to City")) {
    return {
      classification: "INVALID_HIERARCHY",
      reason: errMsg
    };
  } else if (errMsg.includes("Ambiguous")) {
    return {
      classification: "AMBIGUOUS",
      reason: errMsg
    };
  } else {
    return {
      classification: "UNRESOLVED",
      reason: errMsg || `Cannot find any Area record matching labels: "${cName} > ${dName} > ${ctName} > ${aName}".`
    };
  }
}
