import { db } from "./firebase";
import { collection, getDocs, setDoc, doc } from "firebase/firestore";
import { 
  Country, District, City, Territory, 
  UserTerritoryAssignment, ProductGroup, UserProductAssignment,
  PhysicianAssignment, PharmacyAssignment, Role, User, Physician, Pharmacy, Product
} from "../types";
import { 
  applySecurityScope, 
  getCurrentUserScope, 
  getAllSubordinates, 
  getFullGeographicPath, 
  SecurityScope,
  getGlobalUserTerritoryAssignments,
  getGlobalUserProductAssignments,
  getGlobalUsersList
} from "./securityEngine";

// Seed/Mock Data for cascading geographic hierarchy
export const INITIAL_COUNTRIES: Country[] = [
  { id: "C-LIB", name: "Libya", code: "LY" },
  { id: "C-JOR", name: "Jordan", code: "JO" },
  { id: "C-IRQ", name: "Iraq", code: "IQ" },
  { id: "C-KSA", name: "Saudi Arabia", code: "SA" }
];

export const INITIAL_DISTRICTS: District[] = [
  { id: "D-LIB-WST", name: "West", countryId: "C-LIB", countryName: "Libya" },
  { id: "D-LIB-EST", name: "East", countryId: "C-LIB", countryName: "Libya" },
  { id: "D-LIB-CTR", name: "Centre", countryId: "C-LIB", countryName: "Libya" },
  { id: "D-LIB-STH", name: "South", countryId: "C-LIB", countryName: "Libya" },
  { id: "D-JOR-AMN", name: "Amman", countryId: "C-JOR", countryName: "Jordan" }
];

export const INITIAL_CITIES: City[] = [
  { id: "CT-TRI", name: "Tripoli", districtId: "D-LIB-WST", districtName: "West", countryId: "C-LIB", countryName: "Libya" },
  { id: "CT-GHY", name: "Gharyan", districtId: "D-LIB-WST", districtName: "West", countryId: "C-LIB", countryName: "Libya" },
  { id: "CT-BGH", name: "Benghazi", districtId: "D-LIB-EST", districtName: "East", countryId: "C-LIB", countryName: "Libya" },
  { id: "CT-JUF", name: "Al Jufra", districtId: "D-LIB-EST", districtName: "East", countryId: "C-LIB", countryName: "Libya" },
  { id: "CT-KHM", name: "Al Khums", districtId: "D-LIB-CTR", districtName: "Centre", countryId: "C-LIB", countryName: "Libya" },
  { id: "CT-AMM", name: "Amman", districtId: "D-JOR-AMN", districtName: "Amman", countryId: "C-JOR", countryName: "Jordan" }
];

export const INITIAL_TERRITORIES: Territory[] = [
  {
    territoryId: "T-TRI-DWT",
    territoryName: "Libya / West / Tripoli / Downtown",
    areaName: "Downtown",
    cityId: "CT-TRI",
    cityName: "Tripoli",
    districtId: "D-LIB-WST",
    districtName: "West",
    countryId: "C-LIB",
    countryName: "Libya",
    status: "Active",
    createdAt: "2026-01-01",
    createdBy: "admin",
    updatedAt: "2026-01-01",
    updatedBy: "admin"
  },
  {
    territoryId: "T-TRI-ASL",
    territoryName: "Libya / West / Tripoli / Abu Salim",
    areaName: "Abu Salim",
    cityId: "CT-TRI",
    cityName: "Tripoli",
    districtId: "D-LIB-WST",
    districtName: "West",
    countryId: "C-LIB",
    countryName: "Libya",
    status: "Active",
    createdAt: "2026-01-01",
    createdBy: "admin",
    updatedAt: "2026-01-01",
    updatedBy: "admin"
  },
  {
    territoryId: "T-JUF-HUN",
    territoryName: "Libya / East / Al Jufra / Hun",
    areaName: "Hun",
    cityId: "CT-JUF",
    cityName: "Al Jufra",
    districtId: "D-LIB-EST",
    districtName: "East",
    countryId: "C-LIB",
    countryName: "Libya",
    status: "Active",
    createdAt: "2026-01-01",
    createdBy: "admin",
    updatedAt: "2026-01-01",
    updatedBy: "admin"
  },
  {
    territoryId: "T-JUF-WDD",
    territoryName: "Libya / East / Al Jufra / Waddan",
    areaName: "Waddan",
    cityId: "CT-JUF",
    cityName: "Al Jufra",
    districtId: "D-LIB-EST",
    districtName: "East",
    countryId: "C-LIB",
    countryName: "Libya",
    status: "Active",
    createdAt: "2026-01-01",
    createdBy: "admin",
    updatedAt: "2026-01-01",
    updatedBy: "admin"
  }
];

export const INITIAL_PRODUCT_GROUPS: ProductGroup[] = [
  { id: "PG-CARDIO", name: "Cardiology Line", description: "Hypertension, stroke and cardiac therapeutics" },
  { id: "PG-DERMA", name: "Dermatology Line", description: "Anti-acne and skincare formulations" },
  { id: "PG-VIT", name: "Vitamins & Pediatrics", description: "Chewables and health supplements" }
];

export const INITIAL_USER_TERRITORY_ASSIGNMENTS: UserTerritoryAssignment[] = [
  {
    assignmentId: "UTA-001",
    userId: "USR-REP1", // Anas Al-Dajani (Medical Rep)
    userRole: "Medical Representative",
    countryId: "C-LIB",
    districtId: "D-LIB-WST",
    cityId: "CT-TRI",
    territoryId: "T-TRI-DWT",
    territoryName: "Libya / West District / Tripoli / Downtown",
    assignmentType: "medical",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2027-12-31",
    status: "Active",
    assignedBy: "admin",
    assignedAt: "2026-01-01"
  },
  {
    assignmentId: "UTA-002",
    userId: "USR-REP2", // Yasmine Belkacem (Sales Rep)
    userRole: "Sales Representative",
    countryId: "C-LIB",
    districtId: "D-LIB-WST",
    cityId: "CT-TRI",
    territoryId: "T-TRI-DWT",
    territoryName: "Libya / West District / Tripoli / Downtown",
    assignmentType: "sales",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2027-12-31",
    status: "Active",
    assignedBy: "admin",
    assignedAt: "2026-01-01"
  }
];

export const INITIAL_USER_PRODUCT_ASSIGNMENTS: UserProductAssignment[] = [
  {
    assignmentId: "UPA-001",
    userId: "USR-REP1",
    productId: "PRD-001", // CardioMax
    productGroupId: "PG-CARDIO",
    therapeuticArea: "Cardiology",
    assignmentType: "medical",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2027-12-31",
    status: "Active",
    assignedBy: "admin",
    assignedAt: "2026-01-01"
  },
  {
    assignmentId: "UPA-002",
    userId: "USR-REP2",
    productId: "PRD-001",
    productGroupId: "PG-CARDIO",
    therapeuticArea: "Cardiology",
    assignmentType: "sales",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2027-12-31",
    status: "Active",
    assignedBy: "admin",
    assignedAt: "2026-01-01"
  }
];

// Helper to filter data based on user security constraints
export function filterBySecurity(
  currentUser: User,
  items: any[],
  territoryIdField = "territoryId",
  productIdField = "productId",
  repIdField = "repId",
  userTerritoryAssignments: UserTerritoryAssignment[] = [],
  userProductAssignments: UserProductAssignment[] = []
) {
  // Normalize fields so applySecurityScope can read them seamlessly
  const normalizedItems = items.map((item, index) => {
    return {
      ...item,
      _originalIndex: index,
      // map the custom field names to standard ones if needed
      territory: item[territoryIdField] || item.territory || item.area || item.territoryId,
      productId: item[productIdField] || item.productId || item.id,
      repId: item[repIdField] || item.repId || item.assignedRepId || item.userId || item.createdBy
    };
  });

  const filteredNormalized = applySecurityScope(
    currentUser,
    normalizedItems,
    userTerritoryAssignments,
    userProductAssignments
  );

  // Map back to original items by keeping their index or matching their ID
  return items.filter((item, index) => {
    return filteredNormalized.some((f) => f._originalIndex === index);
  });
}

// Generates high fidelity Synergy Metrics for the dashboard and 8 reports
export function getSynergyReportData(lang: "en" | "ar") {
  const isRtl = lang === "ar";
  
  // 1. Territory Medical-Sales Synergy Report Data
  const synergyReport = [
    {
      territory: "Libya / West / Tripoli / Downtown",
      medicalRep: "Anas Al-Dajani",
      salesRep: "Yasmine Belkacem",
      medicalVisits: 142,
      pharmacyVisits: 98,
      avgPrescriptionIntent: 8.4,
      ordersPlaced: 65,
      totalSalesUSD: 48500,
      samplesDistributed: 310,
      marketingBudgetUSD: 5000,
      synergyScore: 92 // Out of 100 based on call coordination & product sharing
    },
    {
      territory: "Libya / East / Al Jufra / Hun",
      medicalRep: "Omar Al-Mokhtar",
      salesRep: "Abulmhaimen Dloly",
      medicalVisits: 88,
      pharmacyVisits: 62,
      avgPrescriptionIntent: 6.9,
      ordersPlaced: 40,
      totalSalesUSD: 24200,
      samplesDistributed: 180,
      marketingBudgetUSD: 1500,
      synergyScore: 81
    },
    {
      territory: "Libya / Centre / Al Khums / Centre",
      medicalRep: "Sarah Al-Sharif",
      salesRep: "Tarek Abu-Zeid",
      medicalVisits: 110,
      pharmacyVisits: 114,
      avgPrescriptionIntent: 7.2,
      ordersPlaced: 72,
      totalSalesUSD: 39100,
      samplesDistributed: 220,
      marketingBudgetUSD: 3000,
      synergyScore: 87
    }
  ];

  // 2. Product Performance by Territory
  const productPerformance = [
    { territory: "Tripoli Downtown", product: "CardioMax 10mg", detailingCalls: 85, pharmacySalesUnits: 1200, totalValueUSD: 24000, physicianSentiment: "Highly Favorable" },
    { territory: "Tripoli Downtown", product: "AcneCare Lotion", detailingCalls: 57, pharmacySalesUnits: 950, totalValueUSD: 14250, physicianSentiment: "Favorable" },
    { territory: "Al Jufra Hun", product: "CardioMax 10mg", detailingCalls: 48, pharmacySalesUnits: 650, totalValueUSD: 13000, physicianSentiment: "Neutral" },
    { territory: "Al Jufra Hun", product: "KidVits Chewables", detailingCalls: 40, pharmacySalesUnits: 800, totalValueUSD: 11200, physicianSentiment: "Favorable" }
  ];

  // 3. Medical Activity vs Pharmacy Sales Report
  const activityVsSales = [
    { week: "W1", medicalVisits: 30, salesUSD: 8500 },
    { week: "W2", medicalVisits: 45, salesUSD: 12400 },
    { week: "W3", medicalVisits: 55, salesUSD: 15900 },
    { week: "W4", medicalVisits: 65, salesUSD: 19800 }
  ];

  // 4. Physician Coverage vs Pharmacy Sales Report
  const coverageVsSales = [
    { coveragePct: 40, salesUSD: 5000, territory: "Al Jufra" },
    { coveragePct: 60, salesUSD: 12000, territory: "Gharyan" },
    { coveragePct: 80, salesUSD: 28000, territory: "Al Khums" },
    { coveragePct: 98, salesUSD: 48500, territory: "Tripoli Downtown" }
  ];

  // 5. Prescription Intent vs Sales Trend Report
  const intentVsSales = [
    { month: "Jan", avgIntent: 5.2, salesUSD: 18000 },
    { month: "Feb", avgIntent: 6.1, salesUSD: 22000 },
    { month: "Mar", avgIntent: 7.0, salesUSD: 29000 },
    { month: "Apr", avgIntent: 7.8, salesUSD: 36000 },
    { month: "May", avgIntent: 8.4, salesUSD: 48500 }
  ];

  // 6. Samples vs Sales Impact Report
  const samplesVsSales = [
    { month: "Jan", samplesGiven: 100, salesNextMonth: 15000 },
    { month: "Feb", samplesGiven: 150, salesNextMonth: 21000 },
    { month: "Mar", samplesGiven: 220, salesNextMonth: 32000 },
    { month: "Apr", samplesGiven: 310, salesNextMonth: 48500 }
  ];

  // 7. Marketing Activities vs Sales Report
  const marketingVsSales = [
    { activityType: "Round Table Seminar", budget: 1500, salesLiftPct: 15 },
    { activityType: "KOL Sponsorship Program", budget: 3500, salesLiftPct: 28 },
    { activityType: "Clinics Visual Brochure Launch", budget: 800, salesLiftPct: 8 },
    { activityType: "Symposium Partnership", budget: 5000, salesLiftPct: 42 }
  ];

  // 8. Representative Pair Performance Report
  const repPairPerformance = [
    { pair: "Anas (Med) + Yasmine (Sales)", territory: "Tripoli Downtown", synergyScore: 92, alignmentLevel: "Excellent", combinedTargetAchPct: 114 },
    { pair: "Omar (Med) + Abulmhaimen (Sales)", territory: "Al Jufra Hun", synergyScore: 81, alignmentLevel: "Good", combinedTargetAchPct: 98 },
    { pair: "Sarah (Med) + Tarek (Sales)", territory: "Al Khums Centre", synergyScore: 87, alignmentLevel: "Excellent", combinedTargetAchPct: 105 }
  ];

  return {
    synergyReport,
    productPerformance,
    activityVsSales,
    coverageVsSales,
    intentVsSales,
    samplesVsSales,
    marketingVsSales,
    repPairPerformance
  };
}

// Helper to look up cascading path for a territory ID or path
export function getTerritoryFullPath(tIdOrPath: string): string {
  if (!tIdOrPath) return "";
  if (tIdOrPath.includes("/")) {
    return tIdOrPath.toLowerCase().trim();
  }
  const found = INITIAL_TERRITORIES.find(t => t.territoryId === tIdOrPath);
  if (found) {
    return found.territoryName.toLowerCase().trim();
  }
  const assign = (getGlobalUserTerritoryAssignments() || []).find(a => a.territoryId === tIdOrPath);
  if (assign) {
    const parts = [
      assign.countryId,
      assign.districtId,
      assign.cityId,
      assign.territoryId || assign.territoryName
    ].filter(Boolean);
    return parts.join(" / ").toLowerCase().trim();
  }
  return tIdOrPath.toLowerCase().trim();
}

// 1. Get active territory assignments for a user
export function getUserTerritories(userId: string): UserTerritoryAssignment[] {
  const assignments = getGlobalUserTerritoryAssignments() || [];
  return assignments.filter(a => a.userId === userId && a.status === "Active");
}

// 2. Get active product assignments for a user
export function getUserProducts(userId: string): UserProductAssignment[] {
  const assignments = getGlobalUserProductAssignments() || [];
  return assignments.filter(a => a.userId === userId && a.status === "Active");
}

// 3. Check if user has access to a specific territory (enforcing Country > District > City > Territory / Area)
export function canAccessTerritory(userId: string, territoryId: string): boolean {
  if (!territoryId) return false;
  const user = getGlobalUsersList().find(u => u.id === userId);
  if (!user) return false;

  const scope = getCurrentUserScope(user, getGlobalUserTerritoryAssignments());
  if (scope.level === "national") return true;

  const targetPath = getTerritoryFullPath(territoryId);

  // If regional, check if target territory falls under one of the user's assigned regions
  if (scope.level === "regional") {
    const inRegion = scope.regions.some(r => targetPath.includes(r.toLowerCase().trim()));
    if (inRegion) return true;
  }

  // Check explicit assignments
  return scope.territories.some(t => {
    const allowedPath = t.toLowerCase().trim();
    return targetPath === allowedPath || targetPath.includes(allowedPath) || allowedPath.includes(targetPath);
  });
}

// 4. Check if user has access to a specific product
export function canAccessProduct(userId: string, productId: string): boolean {
  if (!productId) return false;
  const user = getGlobalUsersList().find(u => u.id === userId);
  if (!user) return false;

  const scope = getCurrentUserScope(user, getGlobalUserTerritoryAssignments());
  if (scope.level === "national") return true;

  const activeProducts = getUserProducts(userId);
  if (activeProducts.length === 0) {
    if (user.role === Role.MEDICAL_REP || user.role === Role.SALES_REP) {
      return false; // Reps must have explicit assignments
    }
    return true; // Managers fallback to true if no specific restrictions
  }

  return activeProducts.some(p => p.productId === productId);
}

// 5. Check if user can access a specific customer (physician or pharmacy)
export function canAccessCustomer(userId: string, customerRecord: any): boolean {
  if (!customerRecord) return false;
  const user = getGlobalUsersList().find(u => u.id === userId);
  if (!user) return false;

  // Medical reps cannot access pharmacies
  if (user.role === Role.MEDICAL_REP && customerRecord.type === "pharmacy") {
    return false;
  }
  // Sales reps cannot access physicians
  if (user.role === Role.SALES_REP && customerRecord.type === "physician") {
    return false;
  }

  // Hierarchy checks for Managers/Supervisors
  const recordRepId = customerRecord.repId || customerRecord.assignedRepId || customerRecord.userId || customerRecord.createdBy;
  if (recordRepId && recordRepId !== userId) {
    const subordinates = getAllSubordinates(userId);
    const managesRep = subordinates.some(sub => sub.id === recordRepId);
    if (!managesRep) {
      const scope = getCurrentUserScope(user, getGlobalUserTerritoryAssignments());
      if (scope.level !== "national") {
        const territoryId = customerRecord.territoryId || customerRecord.territory || customerRecord.area;
        if (!territoryId || !canAccessTerritory(userId, territoryId)) {
          return false;
        }
      }
    }
  }

  // Geographic territory alignment
  const territoryId = customerRecord.territoryId || customerRecord.territory || customerRecord.area;
  if (territoryId && !canAccessTerritory(userId, territoryId)) {
    return false;
  }

  // Product alignment (if customer has a specific assigned product line/ID)
  if (customerRecord.productId && !canAccessProduct(userId, customerRecord.productId)) {
    return false;
  }

  return true;
}

// 6. Filter an array of records to include only those within the user's territory scope
export function applyTerritoryScope<T>(records: T[], userScope: SecurityScope): T[] {
  if (!userScope || userScope.level === "national") return records;

  return records.filter((rec: any) => {
    if (rec.userId === userScope.userId || rec.createdBy === userScope.userId || rec.repId === userScope.userId) {
      return true;
    }

    if (userScope.level === "regional" && rec.region && userScope.regions.includes(rec.region)) {
      return true;
    }

    const recordPath = getFullGeographicPath(rec);
    if (recordPath) {
      const match = userScope.territories.some((t) => {
        const allowedPath = t.toLowerCase().trim();
        return recordPath === allowedPath || recordPath.includes(allowedPath) || allowedPath.includes(recordPath);
      });
      if (match) return true;
    }

    if (rec.territory && userScope.territories.includes(rec.territory)) {
      return true;
    }

    const territoryId = rec.territoryId || rec.territory || rec.area;
    if (territoryId) {
      const path = getTerritoryFullPath(territoryId);
      const match = userScope.territories.some((t) => {
        const allowedPath = t.toLowerCase().trim();
        return path === allowedPath || path.includes(allowedPath) || allowedPath.includes(path);
      });
      if (match) return true;
    }

    return false;
  });
}

// 7. Filter an array of records to include only those within the user's product scope
export function applyProductScope<T>(records: T[], userScope: SecurityScope): T[] {
  if (!userScope || userScope.level === "national") return records;

  const userProducts = (getGlobalUserProductAssignments() || [])
    .filter((a) => a.userId === userScope.userId && a.status === "Active")
    .map((a) => a.productId);

  if (userProducts.length === 0) {
    const user = getGlobalUsersList().find(u => u.id === userScope.userId);
    if (user && (user.role === Role.MEDICAL_REP || user.role === Role.SALES_REP)) {
      return []; // Reps must have explicit assignments
    }
    return records;
  }

  return records.filter((rec: any) => {
    if (rec.userId === userScope.userId || rec.createdBy === userScope.userId || rec.repId === userScope.userId) {
      return true;
    }

    if (rec.productId && userProducts.includes(rec.productId)) {
      return true;
    }

    if (rec.productIdField && userProducts.includes(rec.productIdField)) {
      return true;
    }

    return false;
  });
}

// 8. Filter an array of records to include only those within both territory and product scopes
export function applyTerritoryProductScope<T>(records: T[], userScope: SecurityScope): T[] {
  const territoryFiltered = applyTerritoryScope(records, userScope);
  return applyProductScope(territoryFiltered, userScope);
}

export const INITIAL_AREAS = [
  { id: "A-TRI-DWT", name: "Downtown", cityId: "CT-TRI", cityName: "Tripoli", districtId: "D-LIB-WST", districtName: "West", countryId: "C-LIB", countryName: "Libya" },
  { id: "A-TRI-ASL", name: "Abu Salim", cityId: "CT-TRI", cityName: "Tripoli", districtId: "D-LIB-WST", districtName: "West", countryId: "C-LIB", countryName: "Libya" },
  { id: "A-TRI-GAR", name: "Gargaresh", cityId: "CT-TRI", cityName: "Tripoli", districtId: "D-LIB-WST", districtName: "West", countryId: "C-LIB", countryName: "Libya" },
  { id: "A-TRI-SIY", name: "Siyahiya Area", cityId: "CT-TRI", cityName: "Tripoli", districtId: "D-LIB-WST", districtName: "West", countryId: "C-LIB", countryName: "Libya" },
  { id: "A-TRI-HDB", name: "Al-Hadba", cityId: "CT-TRI", cityName: "Tripoli", districtId: "D-LIB-WST", districtName: "West", countryId: "C-LIB", countryName: "Libya" },
  { id: "A-JUF-HUN", name: "Hun", cityId: "CT-JUF", cityName: "Al Jufra", districtId: "D-LIB-EST", districtName: "East", countryId: "C-LIB", countryName: "Libya" },
  { id: "A-JUF-WDD", name: "Waddan", cityId: "CT-JUF", cityName: "Al Jufra", districtId: "D-LIB-EST", districtName: "East", countryId: "C-LIB", countryName: "Libya" },
  { id: "A-JUF-SNA", name: "Sokna", cityId: "CT-JUF", cityName: "Al Jufra", districtId: "D-LIB-EST", districtName: "East", countryId: "C-LIB", countryName: "Libya" },
  { id: "A-JUF-ZAL", name: "Zalla", cityId: "CT-JUF", cityName: "Al Jufra", districtId: "D-LIB-EST", districtName: "East", countryId: "C-LIB", countryName: "Libya" },
  { id: "A-GHY-THN", name: "Gharyan - Thani", cityId: "CT-GHY", cityName: "Gharyan", districtId: "D-LIB-WST", districtName: "West", countryId: "C-LIB", countryName: "Libya" },
  { id: "A-KHM-KHM", name: "Al Khums Centre", cityId: "CT-KHM", cityName: "Al Khums", districtId: "D-LIB-CTR", districtName: "Centre", countryId: "C-LIB", countryName: "Libya" },
  { id: "A-BGH-CST", name: "Benghazi Coast", cityId: "CT-BGH", cityName: "Benghazi", districtId: "D-LIB-EST", districtName: "East", countryId: "C-LIB", countryName: "Libya" },
  { id: "A-BGH-HQT", name: "Hay Al Qatar", cityId: "CT-BGH", cityName: "Benghazi", districtId: "D-LIB-EST", districtName: "East", countryId: "C-LIB", countryName: "Libya" },
  { id: "A-BGH-LTH", name: "Al-Laithi", cityId: "CT-BGH", cityName: "Benghazi", districtId: "D-LIB-EST", districtName: "East", countryId: "C-LIB", countryName: "Libya" },
  { id: "A-BGH-VNC", name: "Venicia", cityId: "CT-BGH", cityName: "Benghazi", districtId: "D-LIB-EST", districtName: "East", countryId: "C-LIB", countryName: "Libya" }
];
