import { 
  User, 
  UserTerritoryAssignment, 
  UserProductAssignment, 
  PhysicianAssignment, 
  PharmacyAssignment, 
  Physician, 
  Pharmacy, 
  Product, 
  Role,
  AnalyticsFilters,
  SecuredAnalyticsScope,
  AnalyticsDbState
} from "../types";
import { getFullGeographicPath } from "./securityEngine";

/**
 * 1. Computes the list of all subordinate user IDs recursively (Reporting Hierarchy Line)
 */
export function getSubordinatesRecursive(currentUser: User, allUsers: User[]): string[] {
  const subordinates: string[] = [];
  const visited = new Set<string>();

  function recurse(managerId: string) {
    if (!managerId) return;
    
    const directReports = allUsers.filter(
      u => u.managerId === managerId
    );

    for (const report of directReports) {
      if (!visited.has(report.id)) {
        visited.add(report.id);
        subordinates.push(report.id);
        recurse(report.id);
      }
    }
  }

  recurse(currentUser.id);

  return subordinates;
}

/**
 * 2. Main builder that calculates the mathematically secure analytics boundary for a user
 */
export function calculateSecuredAnalyticsScope(
  currentUser: User,
  dbState: AnalyticsDbState
): SecuredAnalyticsScope {
  const { 
    users, 
    userTerritoryAssignments, 
    userProductAssignments, 
    physicians,
    pharmacies,
    products
  } = dbState;

  const role = currentUser.role;

  // National roles bypass local restrictions and see all
  const isNational = [
    Role.SUPER_ADMIN,
    Role.ADMIN,
    Role.GENERAL_MANAGER,
    Role.SALES_MARKETING_MANAGER,
    Role.MARKETING_MANAGER,
    Role.FINANCE,
    Role.MARKETING_OFFICER,
    Role.PRODUCT_MANAGER,
    Role.ORDER_OPS_OFFICER
  ].includes(role);

  // Regional/Supervisor roles see their assigned region & all subordinates
  const isRegional = [
    Role.REGIONAL_MANAGER,
    Role.COUNTRY_MANAGER,
    Role.AREA_SALES_MANAGER,
    Role.MEDICAL_SUPERVISOR,
    Role.SALES_SUPERVISOR
  ].includes(role);

  const level = isNational ? "national" : isRegional ? "regional" : "personal";

  // Compute reporting subordinates
  const subordinateUserIds = isNational 
    ? users.map(u => u.id).filter(id => id !== currentUser.id)
    : getSubordinatesRecursive(currentUser, users);

  // Collect direct territory assignments
  const activeAssignments = userTerritoryAssignments.filter(
    (a) => (a.userId === currentUser.id || subordinateUserIds.includes(a.userId)) && a.status === "Active"
  );

  const allowedCountries = new Set<string>();
  const allowedDistricts = new Set<string>();
  const allowedCities = new Set<string>();
  const allowedTerritories = new Set<string>();

  if (isNational) {
    // Fill all based on DB
    physicians.forEach(p => p.country && allowedCountries.add(p.country));
    physicians.forEach(p => p.district && allowedDistricts.add(p.district));
    physicians.forEach(p => p.city && allowedCities.add(p.city));
    physicians.forEach(p => {
      const path = getFullGeographicPath(p);
      if (path) allowedTerritories.add(path);
      if (p.territory) allowedTerritories.add(p.territory.toLowerCase().trim());
    });
  } else {
    // Populate from assignments
    activeAssignments.forEach((assign) => {
      if (assign.countryId) allowedCountries.add(assign.countryId);
      if (assign.districtId) allowedDistricts.add(assign.districtId);
      if (assign.cityId) allowedCities.add(assign.cityId);
      if (assign.territoryName) allowedTerritories.add(assign.territoryName.toLowerCase().trim());
      if (assign.territoryId) allowedTerritories.add(assign.territoryId.toLowerCase().trim());
    });

    // Fallback to direct user properties
    if (currentUser.country) allowedCountries.add(currentUser.country);
    if (currentUser.district) allowedDistricts.add(currentUser.district);
    if (currentUser.city) allowedCities.add(currentUser.city);
    if (currentUser.region) {
      allowedDistricts.add(currentUser.region);
      allowedCities.add(currentUser.region);
    }
    if (currentUser.territory) {
      allowedTerritories.add(currentUser.territory.toLowerCase().trim());
    }
    if (currentUser.territories) {
      currentUser.territories.forEach(t => t && allowedTerritories.add(t.toLowerCase().trim()));
    }
  }

  // Collect product assignments
  const allowedProducts = new Set<string>();
  const allowedProductGroups = new Set<string>();

  if (isNational) {
    products.forEach(p => {
      allowedProducts.add(p.id);
      if (p.promotionGroupId) allowedProductGroups.add(p.promotionGroupId);
    });
  } else {
    // Collect from assignments for current user and subordinates
    const activeProductAssignments = userProductAssignments.filter(
      (pa) => (pa.userId === currentUser.id || subordinateUserIds.includes(pa.userId)) && pa.status === "Active"
    );

    activeProductAssignments.forEach((pa) => {
      if (pa.productId) allowedProducts.add(pa.productId);
      if (pa.productGroupId) allowedProductGroups.add(pa.productGroupId);
    });

    // Direct user properties fallback
    if (currentUser.products) {
      currentUser.products.forEach(p => p && allowedProducts.add(p));
    }
  }

  // Collect assigned physicians and pharmacies (important for personal/rep scope)
  const allowedPhysicians = new Set<string>();
  const allowedPharmacies = new Set<string>();

  if (isNational || isRegional) {
    // Managers and Admins see all customers in their allowed territories/regions
    physicians.forEach((p) => {
      const path = getFullGeographicPath(p);
      const territoryMatch = Array.from(allowedTerritories).some(
        t => path.includes(t) || t.includes(path) || p.territory?.toLowerCase().trim() === t
      );
      const canonicalAreaMatch = Boolean(p.areaId && allowedTerritories.has(p.areaId.toLowerCase().trim()));
      const physicianGroups = [p.primaryPromotionGroupId, ...(p.targetPromotionGroupIds || [])].filter(Boolean) as string[];
      const productMatch = physicianGroups.some((groupId) => allowedProductGroups.has(groupId));
      if ((canonicalAreaMatch || territoryMatch || allowedCities.has(p.city || "") || allowedDistricts.has(p.district || "")) && productMatch) {
        allowedPhysicians.add(p.id);
      }
    });

    pharmacies.forEach((ph) => {
      const path = getFullGeographicPath(ph);
      const territoryMatch = Array.from(allowedTerritories).some(
        t => path.includes(t) || t.includes(path) || ph.territory?.toLowerCase().trim() === t
      );
      const canonicalAreaMatch = Boolean(ph.areaId && allowedTerritories.has(ph.areaId.toLowerCase().trim()));
      if (canonicalAreaMatch || territoryMatch || allowedCities.has(ph.city || "") || allowedDistricts.has(ph.district || "")) {
        allowedPharmacies.add(ph.id);
      }
    });
  } else {
    // Representative physician access requires canonical geography and
    // promotion-group overlap; an assignedRepId alone never grants access.
    physicians.forEach(p => {
      const areaMatch = Boolean(p.areaId && allowedTerritories.has(p.areaId.toLowerCase().trim()));
      const physicianGroups = [p.primaryPromotionGroupId, ...(p.targetPromotionGroupIds || [])].filter(Boolean) as string[];
      if (areaMatch && physicianGroups.some((groupId) => allowedProductGroups.has(groupId))) {
        allowedPhysicians.add(p.id);
      }
    });
    // Sales customer eligibility follows canonical geography. Explicit
    // customer assignment may be represented elsewhere, but is not inferred
    // from a free-standing display-name or owner field here.
    pharmacies.forEach(ph => {
      if (ph.areaId && allowedTerritories.has(ph.areaId.toLowerCase().trim())) {
        allowedPharmacies.add(ph.id);
      }
    });
  }

  return {
    userId: currentUser.id,
    role,
    level,
    allowedCountries: Array.from(allowedCountries),
    allowedDistricts: Array.from(allowedDistricts),
    allowedCities: Array.from(allowedCities),
    allowedTerritories: Array.from(allowedTerritories),
    allowedProducts: Array.from(allowedProducts),
    allowedProductGroups: Array.from(allowedProductGroups),
    allowedPhysicians: Array.from(allowedPhysicians),
    allowedPharmacies: Array.from(allowedPharmacies),
    subordinateUserIds
  };
}

/**
 * 3. Airtight Double-Filter:
 * Enforces security boundaries first, then applies requested UI filter selections
 */
export function filterDatasetByScopeAndFilters<T extends {
  country?: string;
  district?: string;
  city?: string;
  territory?: string;
  territoryId?: string;
  area?: string;
  productId?: string;
  productSku?: string;
  sku?: string;
  physicianId?: string;
  pharmacyId?: string;
  repId?: string;
  userId?: string;
  createdBy?: string;
  visitDate?: string;
  createdAt?: string;
  name?: string;
  brand?: string;
}>(
  dataset: T[],
  scope: SecuredAnalyticsScope,
  filters: AnalyticsFilters,
  productsList: Product[] = []
): T[] {
  return dataset.filter((rec) => {
    // ==========================================
    // STEP 1: ENFORCE SECURITY SCOPE BOUNDARIES
    // ==========================================
    if (scope.level !== "national") {
      // Owner/Author Bypass
      const isOwner = 
        rec.userId === scope.userId || 
        rec.createdBy === scope.userId || 
        rec.repId === scope.userId;

      if (!isOwner) {
        // A) Subordinate Check (Reporting hierarchy)
        const isSubordinateRecord = 
          (rec.repId && scope.subordinateUserIds.includes(rec.repId)) ||
          (rec.userId && scope.subordinateUserIds.includes(rec.userId)) ||
          (rec.createdBy && scope.subordinateUserIds.includes(rec.createdBy));

        // B) Territory Check (Cascading path checks to prevent non-unique area names)
        const recordPath = getFullGeographicPath(rec);
        const recordTerritory = (rec.territory || rec.territoryId || rec.area || "").toLowerCase().trim();
        
        const hasTerritoryAccess = scope.allowedTerritories.some((allowed) => {
          const tName = allowed.toLowerCase().trim();
          return (
            recordPath === tName || 
            recordPath.includes(tName) || 
            tName.includes(recordPath) ||
            recordTerritory === tName
          );
        });

        // C) Customer Check (Physicians or Pharmacies must be within their explicit assignments)
        if (rec.physicianId && !scope.allowedPhysicians.includes(rec.physicianId)) {
          return false;
        }
        if (rec.pharmacyId && !scope.allowedPharmacies.includes(rec.pharmacyId)) {
          return false;
        }

        // D) Product Check
        const prodId = rec.productId || rec.productSku || rec.sku;
        if (prodId && scope.allowedProducts.length > 0 && !scope.allowedProducts.includes(prodId)) {
          return false;
        }

        // If neither owner, subordinate nor authorized territory, deny access
        if (!isSubordinateRecord && !hasTerritoryAccess) {
          return false;
        }
      }
    }

    // ==========================================
    // STEP 2: APPLY USER-SELECTED FILTERS (UI)
    // ==========================================
    
    // Country Filter
    if (filters.selectedCountry !== "All") {
      const recCountry = rec.country || "";
      if (recCountry !== filters.selectedCountry) return false;
    }

    // District Filter
    if (filters.selectedDistrict !== "All") {
      const recDistrict = rec.district || "";
      if (recDistrict !== filters.selectedDistrict) return false;
    }

    // City Filter
    if (filters.selectedCity !== "All") {
      const recCity = rec.city || "";
      if (recCity !== filters.selectedCity) return false;
    }

    // Territory / Area Filter
    if (filters.selectedTerritory !== "All") {
      const recTerritory = rec.territory || rec.territoryId || rec.area || "";
      const path = getFullGeographicPath(rec);
      const filterT = filters.selectedTerritory.toLowerCase().trim();
      
      const match = 
        recTerritory.toLowerCase().trim() === filterT ||
        path.includes(filterT) ||
        filterT.includes(path);

      if (!match) return false;
    }

    // Product Sku / Product ID Filter
    if (filters.selectedProduct !== "All") {
      const pId = rec.productId || rec.productSku || rec.sku || "";
      if (pId !== filters.selectedProduct) return false;
    }

    // Product Group Filter (Map product to its product group first)
    if (filters.selectedProductGroup !== "All") {
      const pId = rec.productId || rec.productSku || rec.sku;
      if (pId) {
        const matchingProd = productsList.find(p => p.id === pId || p.sku === pId || p.brand === pId);
        // If product's brand/category/therapeuticArea doesn't match, or custom group check
        if (matchingProd) {
          // Compare group mapping (simple fallback: therapeuticArea as group name or category)
          const belongsToGroup = 
            matchingProd.therapeuticArea === filters.selectedProductGroup ||
            matchingProd.promotionGroupName === filters.selectedProductGroup ||
            matchingProd.brand === filters.selectedProductGroup;
          
          if (!belongsToGroup) return false;
        }
      }
    }

    // Date Range Filters
    const dateStr = rec.visitDate || rec.createdAt;
    if (dateStr) {
      const recTime = new Date(dateStr).getTime();
      if (filters.startDate) {
        const startTime = new Date(filters.startDate).getTime();
        if (recTime < startTime) return false;
      }
      if (filters.endDate) {
        const endTime = new Date(filters.endDate).getTime();
        if (recTime > endTime) return false;
      }
    }

    // Search Query Filter
    if (filters.searchQuery) {
      const query = filters.searchQuery.toLowerCase().trim();
      const recName = (rec.name || "").toLowerCase();
      const recBrand = (rec.brand || "").toLowerCase();
      
      const matchesSearch = 
        recName.includes(query) || 
        recBrand.includes(query) || 
        (rec.repId || "").toLowerCase().includes(query);

      if (!matchesSearch) return false;
    }

    return true;
  });
}
