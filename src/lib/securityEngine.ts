import { Role, User, UserTerritoryAssignment, UserProductAssignment, Product, ProductPromotionGroup } from "../types";
import { findManager, getReadiness } from "./userPolicyEngine";
import { getActiveCanonicalAssignmentsForUser } from "./productAssignmentService";

export interface SecurityScope {
  level: "national" | "regional" | "personal";
  regions: string[];
  territories: string[]; // Stores territory IDs and complete paths (e.g. Country / District / City / Area)
  userId: string;
}

// Helper to normalize and compute full cascading geographic hierarchy path
export function getFullGeographicPath(record: {
  country?: string;
  district?: string;
  city?: string;
  area?: string;
  territory?: string;
  region?: string;
}): string {
  if (record.country && record.district && record.city && record.area) {
    return `${record.country} / ${record.district} / ${record.city} / ${record.area}`.toLowerCase().trim();
  }
  if (record.territory && record.territory.includes("/")) {
    return record.territory.toLowerCase().trim();
  }
  
  // Construct path with fallback
  const parts = [
    record.country || "",
    record.district || record.region || "",
    record.city || "",
    record.area || record.territory || ""
  ].filter(p => p && p !== "-");

  if (parts.length >= 3) {
    return parts.join(" / ").toLowerCase().trim();
  }

  return (record.territory || "").toLowerCase().trim();
}

// Check if a record geographic path matches an allowed territory path exactly with robust whitespace and casing comparison
export function isGeographicPathMatch(allowed: string, record: string): boolean {
  const normAllowed = allowed.toLowerCase().replace(/\s+/g, " ").trim();
  const normRecord = record.toLowerCase().replace(/\s+/g, " ").trim();
  
  return normAllowed === normRecord;
}

// Global variables for caching current state to support parameterless and single-argument security helpers
let globalCurrentUser: User | null = null;
let globalUsersList: User[] = [];
let globalUserTerritoryAssignments: UserTerritoryAssignment[] = [];
let globalUserProductAssignments: UserProductAssignment[] = [];
let globalProductsList: Product[] = [];
let globalPromotionGroupsList: ProductPromotionGroup[] = [];

// Helper to set the global security context upon user session initialization
export function setGlobalSecurityContext(
  currentUser: User,
  users: User[] = [],
  userTerritoryAssignments: UserTerritoryAssignment[] = [],
  userProductAssignments: UserProductAssignment[] = [],
  products: Product[] = [],
  promotionGroups: ProductPromotionGroup[] = []
) {
  globalCurrentUser = currentUser;
  globalUsersList = users;
  globalUserTerritoryAssignments = userTerritoryAssignments;
  globalUserProductAssignments = userProductAssignments;
  globalProductsList = products;
  if (promotionGroups && promotionGroups.length > 0) {
    globalPromotionGroupsList = promotionGroups;
  }
}

export function getGlobalCurrentUser() { return globalCurrentUser; }
export function getGlobalUsersList() { return globalUsersList; }
export function getGlobalUserTerritoryAssignments() { return globalUserTerritoryAssignments; }
export function getGlobalUserProductAssignments() { return globalUserProductAssignments; }
export function getGlobalProductsList() { return globalProductsList; }
export function getGlobalPromotionGroupsList() { return globalPromotionGroupsList; }

/** Canonical customer-listener geography scope shared across modules. */
export function resolveCanonicalAreaIds(
  user: User,
  territoryAssignments: UserTerritoryAssignment[] = []
): string[] {
  const areaIds = new Set<string>();
  (user.areaIds || []).forEach((areaId) => {
    if (typeof areaId === "string" && areaId.trim()) areaIds.add(areaId.trim());
  });
  territoryAssignments.forEach((assignment) => {
    if (assignment.userId !== user.id || assignment.status !== "Active" || (assignment as any).active === false) return;
    const areaId = assignment.territoryId || (assignment as any).areaId;
    if (typeof areaId === "string" && areaId.trim()) areaIds.add(areaId.trim());
  });
  return Array.from(areaIds).sort();
}

// Internal helper for recursive subordinates to prevent circular imports
function getSubordinatesRecursiveInternal(currentUser: User, allUsers: User[]): string[] {
  const subordinates: string[] = [];
  const visited = new Set<string>();

  function recurse(user: User) {
    if (!user) return;
    
    const directReports = allUsers.filter(u => {
      const mgr = findManager(u, allUsers);
      return mgr && mgr.id === user.id;
    });

    for (const report of directReports) {
      if (!visited.has(report.id)) {
        visited.add(report.id);
        subordinates.push(report.id);
        recurse(report);
      }
    }
  }

  recurse(currentUser);
  return subordinates;
}

// 1. Get current user's security scope, incorporating explicit database assignments
export function getCurrentUserScope(
  currentUser?: User,
  userTerritoryAssignments?: UserTerritoryAssignment[]
): SecurityScope {
  const activeUser = currentUser || globalCurrentUser;
  if (!activeUser) {
    return {
      level: "personal",
      regions: [],
      territories: [],
      userId: "anonymous"
    };
  }

  const role = activeUser.role;
  const regions: string[] = [];
  const territories: string[] = [];

  // Super Admin, Admin, General Manager, Sales & Marketing Manager, Marketing Manager, and Finance see all
  const isNational = [
    Role.SUPER_ADMIN,
    Role.ADMIN,
    Role.GENERAL_MANAGER,
    Role.SALES_MARKETING_MANAGER,
    Role.MARKETING_MANAGER,
    Role.FINANCE
  ].includes(role);

  if (isNational) {
    return {
      level: "national",
      regions: [],
      territories: [],
      userId: activeUser.id
    };
  }

  const activeAssignments = (userTerritoryAssignments || globalUserTerritoryAssignments || []).filter(
    (a) => a.userId === activeUser.id && a.status === "Active"
  );

  activeAssignments.forEach((assign) => {
    if (assign.territoryName && !territories.includes(assign.territoryName)) {
      territories.push(assign.territoryName);
    }
    if (assign.territoryId && !territories.includes(assign.territoryId)) {
      territories.push(assign.territoryId);
    }
    if (assign.cityId && !regions.includes(assign.cityId)) {
      regions.push(assign.cityId);
    }
    if (assign.districtId && !regions.includes(assign.districtId)) {
      regions.push(assign.districtId);
    }
  });

  // Fallback to direct properties on User if assignments are absent or empty
  if (activeUser.region && activeUser.region !== "-" && !regions.includes(activeUser.region)) {
    regions.push(activeUser.region);
  }
  if (activeUser.territory && activeUser.territory !== "-") {
    if (!territories.includes(activeUser.territory)) {
      territories.push(activeUser.territory);
    }
  }
  if (activeUser.territories) {
    activeUser.territories.forEach(t => {
      if (t && t !== "-" && !territories.includes(t)) {
        territories.push(t);
      }
    });
  }
  if (activeUser.areaIds) {
    activeUser.areaIds.forEach(id => {
      if (id && id !== "-" && !territories.includes(id)) {
        territories.push(id);
      }
    });
  }

  // Regional Managers & Country Managers have regional access
  const isRegional = [
    Role.REGIONAL_MANAGER,
    Role.COUNTRY_MANAGER,
    Role.AREA_SALES_MANAGER,
    Role.MEDICAL_SUPERVISOR,
    Role.SALES_SUPERVISOR
  ].includes(role);

  return {
    level: isRegional ? "regional" : "personal",
    regions,
    territories,
    userId: activeUser.id
  };
}

// 2. Get direct reports based on region & role hierarchy
export function getDirectReports(first?: User[] | string, second?: User): User[] {
  // Overload: getDirectReports(userId)
  if (typeof first === "string") {
    const userId = first;
    const targetUser = globalUsersList.find(u => u.id === userId);
    if (!targetUser) return [];
    return globalUsersList.filter(u => {
      const mgr = findManager(u, globalUsersList);
      return mgr && mgr.id === targetUser.id;
    });
  }

  // Overload: getDirectReports(users, currentUser)
  if (Array.isArray(first) && second) {
    const users = first;
    const currentUser = second;
    const scope = getCurrentUserScope(currentUser);
    
    if (scope.level === "national") {
      // National managers see everyone except themselves
      return users.filter(u => u.id !== currentUser.id);
    }

    if (scope.level === "regional") {
      // Regional/Supervisor see people in their region who are below them in the hierarchy
      const regionalRoles = [Role.REGIONAL_MANAGER, Role.COUNTRY_MANAGER];
      const supervisorRoles = [Role.AREA_SALES_MANAGER, Role.MEDICAL_SUPERVISOR, Role.SALES_SUPERVISOR];
      
      return users.filter(u => {
        if (u.id === currentUser.id) return false;
        
        // Must match region
        const matchRegion = scope.regions.includes(u.region);
        if (!matchRegion) return false;

        // Hierarchy check:
        if (regionalRoles.includes(currentUser.role)) {
          // Regional managers manage supervisors and reps
          return [...supervisorRoles, Role.MEDICAL_REP, Role.SALES_REP].includes(u.role);
        }
        
        if (supervisorRoles.includes(currentUser.role)) {
          // Supervisors manage reps
          return [Role.MEDICAL_REP, Role.SALES_REP].includes(u.role);
        }

        return false;
      });
    }

    return [];
  }

  // Overload: getDirectReports() (default to current user)
  if (!first && globalCurrentUser) {
    return getDirectReports(globalCurrentUser.id);
  }

  return [];
}

// 3. Get all subordinates
export function getAllSubordinates(first?: User[] | string, second?: User): User[] {
  // Overload: getAllSubordinates(userId)
  if (typeof first === "string") {
    const userId = first;
    const targetUser = globalUsersList.find(u => u.id === userId);
    if (!targetUser) return [];
    const subordinateIds = getSubordinatesRecursiveInternal(targetUser, globalUsersList);
    return globalUsersList.filter(u => subordinateIds.includes(u.id));
  }

  // Overload: getAllSubordinates(users, currentUser)
  if (Array.isArray(first) && second) {
    const users = first;
    const currentUser = second;
    const subordinateIds = getSubordinatesRecursiveInternal(currentUser, users);
    return users.filter(u => subordinateIds.includes(u.id));
  }

  // Overload: getAllSubordinates() (default to current user)
  if (!first && globalCurrentUser) {
    return getAllSubordinates(globalCurrentUser.id);
  }

  return [];
}

// 4. Can view a target user
export function canViewUser(first: string | User, second?: User, third?: User[]): boolean {
  // Overload: canViewUser(targetUserId)
  if (typeof first === "string") {
    const targetUserId = first;
    const currentUser = globalCurrentUser;
    if (!currentUser) return false;
    if (currentUser.id === targetUserId) return true;
    
    const targetUser = globalUsersList.find(u => u.id === targetUserId);
    if (!targetUser) return false;
    
    return canViewUser(currentUser, targetUser, globalUsersList);
  }

  // Overload: canViewUser(currentUser, targetUser, users)
  if (typeof first !== "string" && second && third) {
    const currentUser = first;
    const targetUser = second;
    const users = third;

    if (currentUser.id === targetUser.id) return true;
    
    const scope = getCurrentUserScope(currentUser);
    if (scope.level === "national") return true;

    const reports = getDirectReports(users, currentUser);
    return reports.some(r => r.id === targetUser.id);
  }

  return false;
}

// 5. Can view record based on security scope
export function canViewRecord(
  first: any,
  second?: any,
  third: UserTerritoryAssignment[] = [],
  fourth: UserProductAssignment[] = []
): boolean {
  // Overload: canViewRecord(currentUser, record, userTerritoryAssignments, userProductAssignments)
  if (first && typeof first === "object" && "role" in first && second) {
    const currentUser = first as User;
    const record = second;
    const result = applySecurityScope(currentUser, [record], third, fourth);
    return result.length > 0;
  }

  // Overload: canViewRecord(record)
  const record = first;
  const currentUser = globalCurrentUser;
  if (!currentUser) return false;
  const result = applySecurityScope(
    currentUser,
    [record],
    globalUserTerritoryAssignments,
    globalUserProductAssignments
  );
  return result.length > 0;
}

export interface PhysicianEligibilityParams {
  physician: any;
  user: User;
  userTerritoryAssignments?: UserTerritoryAssignment[];
  userProductAssignments?: UserProductAssignment[];
  products?: Product[];
  productPromotionGroups?: ProductPromotionGroup[];
  allUsers?: User[];
  representativeOperational?: boolean;
}

export function isPhysicianEligibleForUser(params: PhysicianEligibilityParams): { eligible: boolean; reason?: string } {
  const { physician, user } = params;
  if (!physician || !user) {
    return { eligible: false, reason: "MISSING_CONTEXT" };
  }

  // Effective context resolution
  const effectiveTerritoryAssignments = params.userTerritoryAssignments || globalUserTerritoryAssignments || [];
  const effectiveProductAssignments = params.userProductAssignments || globalUserProductAssignments || [];
  const effectiveProducts = params.products || globalProductsList || [];
  const effectivePromotionGroups = params.productPromotionGroups || globalPromotionGroupsList || [];
  const effectiveUsers = params.allUsers || globalUsersList || [];

  const isRep = user.role === Role.MEDICAL_REP || user.role === Role.SALES_REP;
  const subordinateIds = isRep ? [] : getSubordinatesRecursiveInternal(user, effectiveUsers);
  const authorizedSubjectIds = new Set(isRep ? [user.id] : [user.id, ...subordinateIds]);

  const physicianId = physician.id || "";
  const physicianName = physician.name || physician.physicianName || "";
  const physicianAreaId = (physician.areaId || "").trim();
  const physicianPrimaryPromotionGroupId = physician.primaryPromotionGroupId || "";
  const physicianTargetPromotionGroupIds = Array.isArray(physician.targetPromotionGroupIds) ? physician.targetPromotionGroupIds : [];
  const representativeId = user.id || user.uid || "";

  const physicianActive = physician.active !== false && physician.status !== "Inactive";
  const physicianDeleted = physician.isDeleted === true;

  // Rep authorized area IDs
  const authorizedAreaIds = new Set<string>();
  effectiveTerritoryAssignments.forEach(ta => {
    if (authorizedSubjectIds.has(ta.userId) && ta.status === "Active" && (ta as any).active !== false) {
      const areaId = ta.territoryId || (ta as any).areaId;
      if (areaId && typeof areaId === "string" && areaId.trim() !== "") {
        authorizedAreaIds.add(areaId.trim());
      }
    }
  });

  // Rep active product assignments & promo groups
  const activeProductAssignments = effectiveProductAssignments.filter(a =>
    authorizedSubjectIds.has(a.userId) && a.status === "Active" && (a as any).active !== false
  );
  const assignedProductIds = new Set(activeProductAssignments.map(a => a.productId));

  const activeAssignedProducts = effectiveProducts.filter(p =>
    assignedProductIds.has(p.id) &&
    p.isActive !== false &&
    (p as any).active !== false &&
    (p as any).status !== "Inactive"
  );

  const activeRepPromoGroupIds = new Set<string>();
  activeAssignedProducts.forEach(p => {
    if (p.promotionGroupId && typeof p.promotionGroupId === "string" && p.promotionGroupId.trim() !== "") {
      const pgId = p.promotionGroupId.trim();
      if (effectivePromotionGroups.length > 0) {
        const pg = effectivePromotionGroups.find(g => g.id === pgId);
        if (pg && (pg.isActive === false || (pg as any).active === false || (pg as any).status === "Inactive")) {
          return;
        }
      }
      activeRepPromoGroupIds.add(pgId);
    }
  });

  // Physician Promotion Groups (Primary + Target)
  const physicianPromoGroupIds = new Set<string>();
  if (physicianPrimaryPromotionGroupId) {
    physicianPromoGroupIds.add(physicianPrimaryPromotionGroupId.trim());
  }
  physicianTargetPromotionGroupIds.forEach(id => {
    if (id && typeof id === "string" && id.trim() !== "") {
      physicianPromoGroupIds.add(id.trim());
    }
  });

  const evaluateEligibility = (): { eligible: boolean; reason: string } => {
    // 1. Inactive / Deleted Physician Check
    if (physicianDeleted) {
      return { eligible: false, reason: "PHYSICIAN_DELETED" };
    }
    if (!physicianActive) {
      return { eligible: false, reason: "PHYSICIAN_INACTIVE" };
    }

    // 2. Super Admin bypass
    if (user.role === Role.SUPER_ADMIN) {
      return { eligible: true, reason: "ELIGIBLE" };
    }

    // 3. Operational Readiness check for Reps
    if (isRep) {
      const isOp = typeof params.representativeOperational === "boolean"
        ? params.representativeOperational
        : isUserOperational(user, effectiveTerritoryAssignments, effectiveProductAssignments, effectiveUsers, effectiveProducts);
      if (!isOp) {
        return { eligible: false, reason: "REP_NOT_OPERATIONAL" };
      }
    }

    // 4. Canonical Area ID Filter
    if (!physicianAreaId) {
      return { eligible: false, reason: "PHYSICIAN_MISSING_AREA_ID" };
    }

    if (!authorizedAreaIds.has(physicianAreaId)) {
      return { eligible: false, reason: "AREA_NOT_ELIGIBLE" };
    }

    // 5. Canonical Product & Promotion Group Filter
    if (activeAssignedProducts.length === 0 && isRep) {
      return { eligible: false, reason: "NO_ACTIVE_PRODUCT_ASSIGNMENTS" };
    }

    if (physicianPromoGroupIds.size === 0) {
      return { eligible: false, reason: "PHYSICIAN_NO_PROMOTION_GROUPS" };
    }

    let productMatch = false;
    for (const gid of physicianPromoGroupIds) {
      if (activeRepPromoGroupIds.has(gid)) {
        productMatch = true;
        break;
      }
    }

    if (!productMatch) {
      return { eligible: false, reason: "PRODUCT_NOT_ELIGIBLE" };
    }

    return { eligible: true, reason: "ELIGIBLE" };
  };

  const evalRes = evaluateEligibility();

  console.info(
    "[MEDREP_PHYSICIAN_ELIGIBILITY_JSON]",
    JSON.stringify({
      physicianId,
      physicianName,
      physicianAreaId,
      physicianPrimaryPromotionGroupId,
      physicianTargetPromotionGroupIds,
      representativeId,
      representativeAreaIds: Array.from(authorizedAreaIds),
      representativeAssignedProductIds: Array.from(assignedProductIds),
      representativePromotionGroupIds: Array.from(activeRepPromoGroupIds),
      physicianPromotionGroupIds: Array.from(physicianPromoGroupIds),
      physicianActive,
      physicianDeleted,
      eligibilityResult: evalRes.eligible,
      eligibilityReason: evalRes.reason
    })
  );

  return { eligible: evalRes.eligible, reason: evalRes.reason };
}

// 6. Generic filter function to enforce security scope on any array of records
export function applySecurityScope<
  T extends {
    region?: string;
    territory?: string;
    userId?: string;
    createdBy?: string;
    userName?: string;
    productId?: string;
    productGroupId?: string;
    country?: string;
    district?: string;
    city?: string;
    area?: string;
    repId?: string;
    areaId?: string;
  } | Record<string, any>
>(
  first: User | T[],
  second: T[] | SecurityScope,
  third: UserTerritoryAssignment[] = [],
  fourth: UserProductAssignment[] = []
): T[] {
  // Overload: applySecurityScope(query/records, userScope)
  if (Array.isArray(first)) {
    const records = first;
    const scope = second as SecurityScope;
    if (!scope || scope.level === "national") return records;

    const userProducts = globalUserProductAssignments
      .filter((a) => a.userId === scope.userId && a.status === "Active")
      .map((a) => a.productId);

    const subordinates = getSubordinatesRecursiveInternal(
      globalUsersList.find(u => u.id === scope.userId) || { id: scope.userId, role: "" } as any,
      globalUsersList
    );

    return records.filter((rec) => {
      const isProduct = ("sku" in rec) || ("brand" in rec) || ("price" in rec) || ("promotionGroupId" in rec);
      if (isProduct) {
        if (scope.level === "national" || scope.level === "regional") {
          return true;
        }
        const targetUser = globalUsersList.find(u => u.id === scope.userId);
        const isRep = targetUser && (targetUser.role === Role.MEDICAL_REP || targetUser.role === Role.SALES_REP);
        if (isRep) {
          return userProducts.includes((rec as any).id) || ((rec as any).sku && userProducts.includes((rec as any).sku));
        }
        return true;
      }

      // Explicit Physician Record Handling
      const isPhysicianRecord = ("specialty" in rec) || ("specialtyId" in rec) || ("classification" in rec) || ("primaryPromotionGroupId" in rec) || ("clinic" in rec) || ("physicianName" in rec);
      if (isPhysicianRecord) {
        const targetUser = globalUsersList.find(u => u.id === scope.userId) || (globalCurrentUser?.id === scope.userId ? globalCurrentUser : null);
        if (!targetUser) return false;

        const evalResult = isPhysicianEligibleForUser({
          physician: rec,
          user: targetUser,
          userTerritoryAssignments: globalUserTerritoryAssignments,
          userProductAssignments: globalUserProductAssignments,
          products: globalProductsList,
          productPromotionGroups: globalPromotionGroupsList,
          allUsers: globalUsersList
        });
        if (!evalResult.eligible) {
          console.info("[PHYSICIAN_ELIGIBILITY_EXCLUSION]", { physicianId: (rec as any).id, reason: evalResult.reason, userId: targetUser.id });
        }
        return evalResult.eligible;
      }

      // Explicit Pharmacy Record Handling
      const isPharmacyRecord = !isPhysicianRecord && (
        ("outstandingBalance" in rec) ||
        ("licenseNumber" in rec) ||
        ("creditLimit" in rec) ||
        ("commercialRegister" in rec) ||
        ("pharmacyName" in rec) ||
        (("type" in rec) && !("sku" in rec) && !("promotionGroupId" in rec))
      );

      if (isPharmacyRecord) {
        if ((rec as any).isDeleted === true) return false;
        
        const targetUser = globalUsersList.find(u => u.id === scope.userId) || (globalCurrentUser?.id === scope.userId ? globalCurrentUser : null);
        if (targetUser?.role === Role.SUPER_ADMIN || scope.level === "national") return true;
        if (targetUser?.role === Role.MEDICAL_REP) return false; // Medical Reps DENIED all Pharmacy records
        
        if (targetUser?.role === Role.SALES_REP) {
          if ((rec as any).active === false || (rec as any).status === "Inactive") return false;
          
          let areaMatch = false;
          if (rec.areaId && targetUser?.areaIds && targetUser.areaIds.includes(rec.areaId)) {
            areaMatch = true;
          } else if (rec.areaId && scope.territories && scope.territories.includes(rec.areaId)) {
            areaMatch = true;
          } else {
            const recordPath = getFullGeographicPath(rec);
            if (recordPath && scope.territories.length > 0) {
              areaMatch = scope.territories.some((t) => isGeographicPathMatch(t, recordPath));
            } else if (rec.territory && scope.territories.includes(rec.territory)) {
              areaMatch = true;
            }
          }
          // Area-based visibility for Sales Representatives (assignedRepId is not required for territorial Pharmacy visibility)
          return areaMatch;
        }
      }

      const isOwnerOrSubordinate = 
        rec.userId === scope.userId ||
        rec.createdBy === scope.userId ||
        rec.repId === scope.userId ||
        (rec as any).assignedRepId === scope.userId ||
        (rec.repId && subordinates.includes(rec.repId)) ||
        ((rec as any).assignedRepId && subordinates.includes((rec as any).assignedRepId)) ||
        (rec.userId && subordinates.includes(rec.userId));

      if (isOwnerOrSubordinate) {
        return true;
      }

      if (scope.level === "personal") {
        // Enforce strict Dual-Alignment (assigned territory AND assigned products)
        const targetUser = globalUsersList.find(u => u.id === scope.userId);
        let matchesTerritory = false;
        
        if (rec.areaId && targetUser?.areaIds && targetUser.areaIds.includes(rec.areaId)) {
          matchesTerritory = true;
        } else {
          const recordPath = getFullGeographicPath(rec);
          if (recordPath && scope.territories.length > 0) {
            matchesTerritory = scope.territories.some((t) => {
              return isGeographicPathMatch(t, recordPath);
            });
          } else if (rec.territory && scope.territories.includes(rec.territory)) {
            matchesTerritory = true;
          }
        }

        const itemProductId = (rec as any).productId || (rec as any).primaryBrand || (rec as any).brand;
        let matchesProduct = false;
        if (itemProductId && userProducts.length > 0) {
          matchesProduct = userProducts.includes(itemProductId);
        } else {
          matchesProduct = true; // default match if no product metadata is specified
        }

        return matchesTerritory && matchesProduct;
      }

      if (scope.level === "regional") {
        if (rec.region && scope.regions.includes(rec.region)) {
          return true;
        }

        const recordPath = getFullGeographicPath(rec);
        if (recordPath) {
          const match = scope.territories.some((t) => {
            return isGeographicPathMatch(t, recordPath);
          });
          if (match) return true;
        }

        if (rec.territory && scope.territories.includes(rec.territory)) {
          return true;
        }
      }

      return false;
    });
  }

  // Overload: applySecurityScope(currentUser, records, userTerritoryAssignments, userProductAssignments)
  const currentUser = first as User;
  const records = second as T[];
  const userTerritoryAssignments = third;
  const userProductAssignments = fourth;

  // Enforce Operational Readiness Guard
  if (currentUser && (currentUser.role === Role.MEDICAL_REP || currentUser.role === Role.SALES_REP)) {
    if (!isUserOperational(currentUser, userTerritoryAssignments, userProductAssignments)) {
      return [];
    }
  }

  const scope = getCurrentUserScope(currentUser, userTerritoryAssignments);
  if (scope.level === "national") return records.filter(rec => (rec as any).isDeleted !== true);

  const activeReport = getActiveCanonicalAssignmentsForUser({
    assignments: userProductAssignments || [],
    userId: currentUser.id,
    products: globalProductsList
  });
  const userProducts = activeReport.productIds;

  const subordinates = getSubordinatesRecursiveInternal(currentUser, globalUsersList);

  return records.filter((rec) => {
    const isProduct = ("sku" in rec) || ("brand" in rec) || ("price" in rec) || ("promotionGroupId" in rec);
    if (isProduct) {
      if (scope.level === "national" || scope.level === "regional") {
        return true;
      }
      const isRep = currentUser && (currentUser.role === Role.MEDICAL_REP || currentUser.role === Role.SALES_REP);
      if (isRep) {
        return userProducts.includes((rec as any).id);
      }
      return true;
    }

    // Explicit Physician Record Handling
    const isPhysicianRecord = ("specialty" in rec) || ("specialtyId" in rec) || ("classification" in rec) || ("primaryPromotionGroupId" in rec) || ("clinic" in rec) || ("physicianName" in rec);
    if (isPhysicianRecord) {
      const evalResult = isPhysicianEligibleForUser({
        physician: rec,
        user: currentUser,
        userTerritoryAssignments,
        userProductAssignments,
        products: globalProductsList,
        productPromotionGroups: globalPromotionGroupsList,
        allUsers: globalUsersList
      });
      if (!evalResult.eligible) {
        console.info("[PHYSICIAN_ELIGIBILITY_EXCLUSION]", { physicianId: (rec as any).id, reason: evalResult.reason, userId: currentUser.id });
      }
      return evalResult.eligible;
    }

    // Explicit Pharmacy Record Handling
    const isPharmacyRecord = !isPhysicianRecord && (
      ("outstandingBalance" in rec) ||
      ("licenseNumber" in rec) ||
      ("creditLimit" in rec) ||
      ("commercialRegister" in rec) ||
      ("pharmacyName" in rec) ||
      (("type" in rec) && !("sku" in rec) && !("promotionGroupId" in rec))
    );

    if (isPharmacyRecord) {
      if ((rec as any).isDeleted === true) return false;

      if (currentUser?.role === Role.SUPER_ADMIN || scope.level === "national") return true;
      if (currentUser?.role === Role.MEDICAL_REP) return false; // Medical Reps DENIED all Pharmacy records

      if (currentUser?.role === Role.SALES_REP) {
        if ((rec as any).active === false || (rec as any).status === "Inactive") return false;

        let areaMatch = false;
        if (rec.areaId && currentUser.areaIds && currentUser.areaIds.includes(rec.areaId)) {
          areaMatch = true;
        } else {
          const recordPath = getFullGeographicPath(rec);
          if (recordPath && scope.territories.length > 0) {
            areaMatch = scope.territories.some((t) => isGeographicPathMatch(t, recordPath));
          } else if (rec.territory && scope.territories.includes(rec.territory)) {
            areaMatch = true;
          }
        }
        // Area-based visibility for Sales Representatives (assignedRepId is not required for territorial Pharmacy visibility)
        return areaMatch;
      }
    }

    const isOwnerOrSubordinate = 
      rec.userId === currentUser.id ||
      rec.createdBy === currentUser.id ||
      rec.repId === currentUser.id ||
      (rec as any).assignedRepId === currentUser.id ||
      (rec.repId && subordinates.includes(rec.repId)) ||
      ((rec as any).assignedRepId && subordinates.includes((rec as any).assignedRepId)) ||
      (rec.userId && subordinates.includes(rec.userId));

    if (isOwnerOrSubordinate) {
      return true;
    }

    if (scope.level === "personal") {
      // Enforce strict Dual-Alignment (assigned territory AND assigned products)
      let matchesTerritory = false;
      
      if (rec.areaId && currentUser.areaIds && currentUser.areaIds.includes(rec.areaId)) {
        matchesTerritory = true;
      } else {
        const recordPath = getFullGeographicPath(rec);
        if (recordPath && scope.territories.length > 0) {
          matchesTerritory = scope.territories.some((t) => {
            return isGeographicPathMatch(t, recordPath);
          });
        } else if (rec.territory && scope.territories.includes(rec.territory)) {
          matchesTerritory = true;
        }
      }

      const itemProductId = (rec as any).productId || (rec as any).primaryBrand || (rec as any).brand;
      let matchesProduct = false;
      if (itemProductId && userProducts.length > 0) {
        matchesProduct = userProducts.includes(itemProductId);
      } else {
        matchesProduct = true; // default match if no product metadata is specified
      }

      return matchesTerritory && matchesProduct;
    }

    if (scope.level === "regional") {
      if (rec.region && scope.regions.includes(rec.region)) {
        return true;
      }

      const recordPath = getFullGeographicPath(rec);
      if (recordPath) {
        const match = scope.territories.some((t) => {
          return isGeographicPathMatch(t, recordPath);
        });
        if (match) return true;
      }

      if (rec.territory && scope.territories.includes(rec.territory)) {
        return true;
      }
    }

    return false;
  });
}

export function isUserOperational(
  user: User | null | undefined,
  territoryAssignments: UserTerritoryAssignment[] = [],
  productAssignments: UserProductAssignment[] = [],
  allUsers?: User[],
  productsList?: Product[]
): boolean {
  if (!user) return false;
  
  const effectiveUsers = (allUsers && allUsers.length > 0) ? allUsers : globalUsersList;
  const report = getReadiness(user, effectiveUsers, {
    territoryAssignments,
    productAssignments,
    assignmentsHydrated: true,
  });
  return report.status === "Operational";
}

export function isLinkedPendingRecord(user: User, allUsers: User[]): boolean {
  if (!user || !user.email) return false;
  const email = user.email.trim().toLowerCase();
  
  // An operational user is one that has authLinked === true, uid, or firstLoginAt
  const isOperational = (user as any).authLinked === true || (user as any).uid || (user as any).firstLoginAt;
  if (isOperational) return false;
  
  // Check if there's any other profile for the same email that is operational
  return allUsers.some(u => 
    u.id !== user.id && 
    (u.email || "").trim().toLowerCase() === email && 
    ((u as any).authLinked === true || (u as any).uid || (u as any).firstLoginAt)
  );
}
