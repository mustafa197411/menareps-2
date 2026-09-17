"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFullGeographicPath = getFullGeographicPath;
exports.getSubordinatesRecursive = getSubordinatesRecursive;
exports.resolveSecuredAnalyticsScope = resolveSecuredAnalyticsScope;
exports.filterRecordByScopeAndFilters = filterRecordByScopeAndFilters;
exports.paginateResults = paginateResults;
const types_1 = require("./types");
/**
 * Normalizes and computes full cascading geographic hierarchy path
 */
function getFullGeographicPath(record) {
    if (record.country && record.district && record.city && record.area) {
        return `${record.country} / ${record.district} / ${record.city} / ${record.area}`.toLowerCase().trim();
    }
    if (record.territory && record.territory.includes("/")) {
        return record.territory.toLowerCase().trim();
    }
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
/**
 * Computes subordinate user IDs recursively (Reporting Hierarchy Line)
 */
function getSubordinatesRecursive(currentUser, allUsers) {
    const subordinates = [];
    const visited = new Set();
    function recurse(managerEmail) {
        if (!managerEmail)
            return;
        const directReports = allUsers.filter(u => u.managerEmail?.toLowerCase().trim() === managerEmail.toLowerCase().trim());
        for (const report of directReports) {
            if (!visited.has(report.id)) {
                visited.add(report.id);
                subordinates.push(report.id);
                if (report.email) {
                    recurse(report.email);
                }
            }
        }
    }
    if (currentUser.email) {
        recurse(currentUser.email);
    }
    return subordinates;
}
/**
 * Resolves a secure analytics scope for a user by reading live alignment records
 */
async function resolveSecuredAnalyticsScope(uid, db) {
    // 1. Fetch current user doc
    const userSnap = await db.collection("users").doc(uid).get();
    if (!userSnap.exists) {
        throw new Error(`User record with ID ${uid} does not exist in the database.`);
    }
    const currentUser = userSnap.data();
    currentUser.id = uid;
    // 2. Load all users (required for recursive hierarchy traversal)
    const usersSnap = await db.collection("users").get();
    const allUsers = [];
    usersSnap.forEach((doc) => {
        const d = doc.data();
        d.id = doc.id;
        allUsers.push(d);
    });
    // 3. Load active assignments
    const territoryAssignsSnap = await db.collection("userTerritoryAssignments").get();
    const userTerritoryAssignments = [];
    territoryAssignsSnap.forEach((doc) => {
        const a = doc.data();
        a.id = doc.id;
        if (a.status === "Active") {
            userTerritoryAssignments.push(a);
        }
    });
    const productAssignsSnap = await db.collection("userProductAssignments").get();
    const userProductAssignments = [];
    productAssignsSnap.forEach((doc) => {
        const p = doc.data();
        p.id = doc.id;
        if (p.status === "Active") {
            userProductAssignments.push(p);
        }
    });
    const role = currentUser.role;
    // National roles bypass local restrictions and see all
    const isNational = [
        types_1.Role.SUPER_ADMIN,
        types_1.Role.ADMIN,
        types_1.Role.GENERAL_MANAGER,
        types_1.Role.SALES_MARKETING_MANAGER,
        types_1.Role.MARKETING_MANAGER,
        types_1.Role.FINANCE,
        types_1.Role.MARKETING,
        types_1.Role.PRODUCT_MANAGER,
        types_1.Role.ORDER_OPS_OFFICER
    ].includes(role);
    // Regional roles see their assigned region & all subordinates
    const isRegional = [
        types_1.Role.REGIONAL_MANAGER,
        types_1.Role.COUNTRY_MANAGER,
        types_1.Role.AREA_SALES_MANAGER,
        types_1.Role.MEDICAL_SUPERVISOR,
        types_1.Role.SALES_SUPERVISOR
    ].includes(role);
    const level = isNational ? "national" : isRegional ? "regional" : "personal";
    // Compute reporting subordinates
    const subordinateUserIds = isNational
        ? allUsers.map(u => u.id).filter(id => id !== currentUser.id)
        : getSubordinatesRecursive(currentUser, allUsers);
    // Collect direct territory assignments
    const activeAssignments = userTerritoryAssignments.filter((a) => (a.userId === currentUser.id || subordinateUserIds.includes(a.userId)));
    const allowedCountries = new Set();
    const allowedDistricts = new Set();
    const allowedCities = new Set();
    const allowedTerritories = new Set();
    if (isNational) {
        // Fill all based on the alignment options
        allUsers.forEach(u => {
            if (u.country)
                allowedCountries.add(u.country);
            if (u.district)
                allowedDistricts.add(u.district);
            if (u.city)
                allowedCities.add(u.city);
            if (u.territory)
                allowedTerritories.add(u.territory.toLowerCase().trim());
        });
    }
    else {
        // Populate from active assignments
        activeAssignments.forEach((assign) => {
            if (assign.countryId)
                allowedCountries.add(assign.countryId);
            if (assign.districtId)
                allowedDistricts.add(assign.districtId);
            if (assign.cityId)
                allowedCities.add(assign.cityId);
            if (assign.territoryName)
                allowedTerritories.add(assign.territoryName.toLowerCase().trim());
            if (assign.territoryId)
                allowedTerritories.add(assign.territoryId.toLowerCase().trim());
        });
        // Fallback to direct user properties
        if (currentUser.country)
            allowedCountries.add(currentUser.country);
        if (currentUser.district)
            allowedDistricts.add(currentUser.district);
        if (currentUser.city)
            allowedCities.add(currentUser.city);
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
    const allowedProducts = new Set();
    const allowedProductGroups = new Set();
    if (!isNational) {
        const activeProductAssignments = userProductAssignments.filter((pa) => (pa.userId === currentUser.id || subordinateUserIds.includes(pa.userId)));
        activeProductAssignments.forEach((pa) => {
            if (pa.productId)
                allowedProducts.add(pa.productId);
            if (pa.productGroupId)
                allowedProductGroups.add(pa.productGroupId);
        });
        if (currentUser.products) {
            currentUser.products.forEach(p => p && allowedProducts.add(p));
        }
    }
    // Fetch doctors and pharmacies to index allowed IDs for personal scoping
    const allowedPhysicians = [];
    const allowedPharmacies = [];
    // In real cloud context, for memory efficiency, we query physician IDs
    // based on scope.
    const physiciansSnap = await db.collection("physicians").get();
    physiciansSnap.forEach((doc) => {
        const p = doc.data();
        const pId = doc.id;
        const path = getFullGeographicPath(p);
        const territoryMatch = Array.from(allowedTerritories).some(t => path.includes(t) || t.includes(path) || p.territory?.toLowerCase().trim() === t);
        const isAssigned = p.assignedRepId === currentUser.id ||
            subordinateUserIds.includes(p.assignedRepId || "") ||
            isNational;
        if (isNational || territoryMatch || allowedCities.has(p.city || "") || allowedDistricts.has(p.district || "") || isAssigned) {
            allowedPhysicians.push(pId);
        }
    });
    const pharmaciesSnap = await db.collection("pharmacies").get();
    pharmaciesSnap.forEach((doc) => {
        const ph = doc.data();
        const phId = doc.id;
        const path = getFullGeographicPath(ph);
        const territoryMatch = Array.from(allowedTerritories).some(t => path.includes(t) || t.includes(path) || ph.territory?.toLowerCase().trim() === t);
        const isAssigned = ph.assignedRepId === currentUser.id ||
            subordinateUserIds.includes(ph.assignedRepId || "") ||
            isNational;
        if (isNational || territoryMatch || allowedCities.has(ph.city || "") || allowedDistricts.has(ph.district || "") || isAssigned) {
            allowedPharmacies.push(phId);
        }
    });
    return {
        currentUser,
        scope: {
            userId: uid,
            role,
            level,
            allowedCountries: Array.from(allowedCountries),
            allowedDistricts: Array.from(allowedDistricts),
            allowedCities: Array.from(allowedCities),
            allowedTerritories: Array.from(allowedTerritories),
            allowedProducts: Array.from(allowedProducts),
            allowedProductGroups: Array.from(allowedProductGroups),
            allowedPhysicians,
            allowedPharmacies,
            subordinateUserIds
        }
    };
}
/**
 * Filter individual records on the server based on analytics scope and applied filters
 */
function filterRecordByScopeAndFilters(rec, scope, filters) {
    // 1. Check Security Scope first if level is not national
    if (scope.level !== "national") {
        const isOwner = rec.userId === scope.userId ||
            rec.createdBy === scope.userId ||
            rec.repId === scope.userId;
        if (!isOwner) {
            // Subordinate Check
            const isSubordinateRecord = (rec.repId && scope.subordinateUserIds.includes(rec.repId)) ||
                (rec.userId && scope.subordinateUserIds.includes(rec.userId)) ||
                (rec.createdBy && scope.subordinateUserIds.includes(rec.createdBy));
            // Territory check
            const recordPath = getFullGeographicPath(rec);
            const recordTerritory = (rec.territory || rec.territoryId || rec.area || "").toLowerCase().trim();
            const hasTerritoryAccess = scope.allowedTerritories.some((allowed) => {
                const tName = allowed.toLowerCase().trim();
                return (recordPath === tName ||
                    recordPath.includes(tName) ||
                    tName.includes(recordPath) ||
                    recordTerritory === tName);
            });
            // Customer check
            if (rec.physicianId && !scope.allowedPhysicians.includes(rec.physicianId)) {
                return false;
            }
            if (rec.pharmacyId && !scope.allowedPharmacies.includes(rec.pharmacyId)) {
                return false;
            }
            // Product check
            const prodId = rec.productId || rec.productSku || rec.sku;
            if (prodId && scope.allowedProducts.length > 0 && !scope.allowedProducts.includes(prodId)) {
                return false;
            }
            if (!isSubordinateRecord && !hasTerritoryAccess) {
                return false;
            }
        }
    }
    // 2. Filter selections
    if (filters.selectedCountry && filters.selectedCountry !== "All") {
        if (rec.country !== filters.selectedCountry)
            return false;
    }
    if (filters.selectedDistrict && filters.selectedDistrict !== "All") {
        if (rec.district !== filters.selectedDistrict)
            return false;
    }
    if (filters.selectedCity && filters.selectedCity !== "All") {
        if (rec.city !== filters.selectedCity)
            return false;
    }
    if (filters.selectedTerritory && filters.selectedTerritory !== "All") {
        const recTerritory = rec.territory || rec.territoryId || rec.area || "";
        const path = getFullGeographicPath(rec);
        const filterT = filters.selectedTerritory.toLowerCase().trim();
        const match = recTerritory.toLowerCase().trim() === filterT ||
            path.includes(filterT) ||
            filterT.includes(path);
        if (!match)
            return false;
    }
    if (filters.selectedProduct && filters.selectedProduct !== "All") {
        const pId = rec.productId || rec.productSku || rec.sku || "";
        if (pId !== filters.selectedProduct)
            return false;
    }
    // Date Range Filters
    const dateStr = rec.visitDate || rec.createdAt;
    if (dateStr) {
        const recTime = new Date(dateStr).getTime();
        if (filters.startDate) {
            const startTime = new Date(filters.startDate).getTime();
            if (recTime < startTime)
                return false;
        }
        if (filters.endDate) {
            const endTime = new Date(filters.endDate).getTime();
            if (recTime > endTime)
                return false;
        }
    }
    return true;
}
/**
 * Paginates and formats result consistently
 */
function paginateResults(items, page = 1, pageSize = 10) {
    const totalCount = items.length;
    const totalPages = Math.ceil(totalCount / pageSize);
    const p = Math.max(1, page);
    const size = Math.max(1, pageSize);
    const startIndex = (p - 1) * size;
    const paginatedItems = items.slice(startIndex, startIndex + size);
    return {
        items: paginatedItems,
        totals: totalCount,
        pagination: {
            totalCount,
            page: p,
            pageSize: size,
            totalPages
        }
    };
}
//# sourceMappingURL=analyticsScopeEngine.js.map