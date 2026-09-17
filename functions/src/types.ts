/**
 * Shared Backend Types for MENAREPS 2.0 Cloud Functions
 */

export enum Role {
  SUPER_ADMIN = "Super Admin",
  ADMIN = "Admin",
  GENERAL_MANAGER = "General Manager",
  REGIONAL_MANAGER = "Regional Manager",
  COUNTRY_MANAGER = "Country Manager",
  AREA_SALES_MANAGER = "Area Sales Manager",
  MEDICAL_SUPERVISOR = "Medical Supervisor",
  SALES_SUPERVISOR = "Sales Supervisor",
  MEDICAL_REP = "Medical Representative",
  SALES_REP = "Sales Representative",
  FINANCE = "Finance Officer",
  WAREHOUSE_INVENTORY = "Warehouse / Inventory",
  MARKETING = "Marketing",
  PRODUCT_MANAGER = "Product Manager",
  DELIVERY_OFFICER = "Delivery Officer",
  ORDER_OPS_OFFICER = "Order Operations Officer",
  SALES_MARKETING_MANAGER = "Sales & Marketing Manager",
  MARKETING_MANAGER = "Marketing Manager"
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  territory: string;
  region: string;
  active: boolean;
  territories?: string[];
  products?: string[];
  joinedDate?: string;
  managerEmail?: string;
  country?: string;
  district?: string;
  city?: string;
  status?: string;
}

export interface UserTerritoryAssignment {
  id: string;
  userId: string;
  userName: string;
  countryId: string;
  districtId: string;
  cityId: string;
  territoryId?: string;
  territoryName: string;
  status: "Active" | "Inactive" | string;
}

export interface UserProductAssignment {
  id: string;
  userId: string;
  productId: string;
  productGroupId: string;
  status: "Active" | "Inactive" | string;
}

export interface AnalyticsFilters {
  selectedCountry?: string;
  selectedDistrict?: string;
  selectedCity?: string;
  selectedTerritory?: string;
  selectedProductGroup?: string;
  selectedProduct?: string;
  startDate?: string;
  endDate?: string;
  searchQuery?: string;
  page?: number;
  pageSize?: number;
}

export interface SecuredAnalyticsScope {
  userId: string;
  role: Role;
  level: "national" | "regional" | "personal";
  allowedCountries: string[];
  allowedDistricts: string[];
  allowedCities: string[];
  allowedTerritories: string[];
  allowedProducts: string[];
  allowedProductGroups: string[];
  allowedPhysicians: string[];
  allowedPharmacies: string[];
  subordinateUserIds: string[];
}
