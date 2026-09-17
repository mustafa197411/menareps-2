import { db } from "./firebase";
import { 
  collection, 
  doc, 
  getDocs, 
  setDoc, 
  addDoc, 
  updateDoc, 
  query, 
  where,
  runTransaction
} from "firebase/firestore";
import { decorateRecord } from "./firebaseSync";

export interface TemplateField {
  fieldName: string;
  displayName: string;
  columnOrder: number;
  dataType: "string" | "number" | "boolean" | "enum" | "date" | "array";
  required: boolean;
  unique: boolean;
  defaultValue?: any;
  lookupCollection?: string;
  validationRule?: string;
  searchable: boolean;
  filterable: boolean;
  sortable: boolean;
  editable: boolean;
  visibleInList: boolean;
  visibleInForm: boolean;
  visibleInImport: boolean;
  visibleInExport: boolean;
  visibleInReports: boolean;
  visibleInDashboard: boolean;
  options?: string[];
}

export interface Template {
  templateId: string;
  templateCode: string;
  templateName: string;
  moduleName: string;
  category: "MASTER DATA" | "COMMERCIAL" | "FIELD FORCE" | "LOGISTICS" | "FINANCIAL" | "REPORTING";
  version: string;
  status: "Active" | "Archived" | "Draft";
  active: boolean;
  description: string;
  ownerRole: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  fields: TemplateField[];
}

export interface TemplateHistory {
  id: string;
  templateId: string;
  version: string;
  updatedAt: string;
  updatedBy: string;
  changeLog: string;
  fields: TemplateField[];
}

// 1. Users Default Fields
const defaultUsersFields: TemplateField[] = [
  { fieldName: "username", displayName: "Username", columnOrder: 1, dataType: "string", required: true, unique: true, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "firstName", displayName: "First Name", columnOrder: 2, dataType: "string", required: true, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "lastName", displayName: "Last Name", columnOrder: 3, dataType: "string", required: true, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "email", displayName: "Email", columnOrder: 4, dataType: "string", required: true, unique: true, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "managerEmail", displayName: "Manager Email", columnOrder: 5, dataType: "string", required: false, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true, lookupCollection: "users" },
  { fieldName: "role", displayName: "Role", columnOrder: 6, dataType: "enum", required: true, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true, options: ["Super Admin", "Admin", "General Manager", "Country Manager", "Regional Manager", "Area Sales Manager", "Medical Supervisor", "Sales Supervisor", "Medical Representative", "Sales Representative", "Finance Officer", "Warehouse / Inventory", "Marketing Manager", "Sales & Marketing Manager", "Product Manager", "Marketing", "Delivery Officer", "Order Operations Officer"] },
  { fieldName: "country", displayName: "Country", columnOrder: 7, dataType: "string", required: false, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "district", displayName: "District", columnOrder: 8, dataType: "string", required: false, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "city", displayName: "City", columnOrder: 9, dataType: "string", required: false, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "area", displayName: "Area", columnOrder: 10, dataType: "string", required: false, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "territory", displayName: "Territory", columnOrder: 11, dataType: "string", required: false, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "active", displayName: "Active", columnOrder: 12, dataType: "boolean", required: false, unique: false, defaultValue: true, searchable: false, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true }
];

// 2. Products Default Fields
const defaultProductsFields: TemplateField[] = [
  { fieldName: "sku", displayName: "SKU", columnOrder: 1, dataType: "string", required: true, unique: true, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "name", displayName: "Product Name", columnOrder: 2, dataType: "string", required: true, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "nameAr", displayName: "Arabic Product Name", columnOrder: 3, dataType: "string", required: false, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "brand", displayName: "Product Promotion Group", columnOrder: 4, dataType: "string", required: true, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "productFamily", displayName: "Product Family", columnOrder: 5, dataType: "string", required: false, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "therapeuticArea", displayName: "Therapeutic Area", columnOrder: 6, dataType: "string", required: true, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "productType", displayName: "Product Type", columnOrder: 7, dataType: "string", required: false, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "manufacturer", displayName: "Manufacturer", columnOrder: 8, dataType: "string", required: false, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "price", displayName: "Price", columnOrder: 9, dataType: "number", required: true, unique: false, defaultValue: 0, searchable: false, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "stockQuantity", displayName: "Initial Stock", columnOrder: 10, dataType: "number", required: true, unique: false, defaultValue: 0, searchable: false, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "strength", displayName: "Strength", columnOrder: 11, dataType: "string", required: false, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "packageSize", displayName: "Package Size", columnOrder: 12, dataType: "string", required: false, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "atcClassification", displayName: "ATC Classification", columnOrder: 13, dataType: "string", required: false, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "prescriptionStatus", displayName: "Prescription Status", columnOrder: 14, dataType: "enum", required: false, unique: false, options: ["Prescription", "OTC", "Medical Device", "Cosmetic", "Dermocosmetic"], searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "marketingStatus", displayName: "Marketing Status", columnOrder: 15, dataType: "enum", required: false, unique: false, options: ["Pre-launch", "Active", "Phase-out", "Discontinued"], searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "parentProductSku", displayName: "Parent Product SKU", columnOrder: 16, dataType: "string", required: false, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true, lookupCollection: "products" },
  { fieldName: "isSample", displayName: "Sample SKU", columnOrder: 17, dataType: "enum", required: false, unique: false, options: ["Yes", "No"], searchable: false, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "isSampleable", displayName: "Can Generate Samples", columnOrder: 18, dataType: "enum", required: false, unique: false, options: ["Yes", "No"], searchable: false, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "monthlyRepSampleLimit", displayName: "Monthly Rep Sample Limit", columnOrder: 19, dataType: "number", required: false, unique: false, defaultValue: 50, searchable: false, filterable: false, sortable: true, editable: true, visibleInList: false, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: false, visibleInDashboard: false },
  { fieldName: "monthlyPhysicianSampleLimit", displayName: "Monthly Physician Sample Limit", columnOrder: 20, dataType: "number", required: false, unique: false, defaultValue: 10, searchable: false, filterable: false, sortable: true, editable: true, visibleInList: false, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: false, visibleInDashboard: false },
  { fieldName: "productImageUrl", displayName: "Product Image", columnOrder: 21, dataType: "string", required: false, unique: false, searchable: false, filterable: false, sortable: false, editable: true, visibleInList: false, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: false, visibleInDashboard: false },
  { fieldName: "description", displayName: "Description", columnOrder: 22, dataType: "string", required: false, unique: false, searchable: true, filterable: true, sortable: false, editable: true, visibleInList: false, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: false, visibleInDashboard: false },
  { fieldName: "isActive", displayName: "Active", columnOrder: 23, dataType: "boolean", required: false, unique: false, defaultValue: true, searchable: false, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true }
];

// 3. Physicians Default Fields
const defaultPhysiciansFields: TemplateField[] = [
  { fieldName: "name", displayName: "Physician Name", columnOrder: 1, dataType: "string", required: true, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "nameAr", displayName: "Physician Name (Arabic)", columnOrder: 2, dataType: "string", required: false, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "specialty", displayName: "Specialty", columnOrder: 3, dataType: "string", required: true, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "segment", displayName: "Segment", columnOrder: 4, dataType: "enum", required: true, unique: false, options: ["A", "B", "C"], searchable: false, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "keyOpinionLeader", displayName: "Key Opinion Leader", columnOrder: 5, dataType: "enum", required: false, unique: false, options: ["Yes", "No"], searchable: false, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "country", displayName: "Country", columnOrder: 6, dataType: "string", required: true, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "district", displayName: "District", columnOrder: 7, dataType: "string", required: true, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "city", displayName: "City", columnOrder: 8, dataType: "string", required: true, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "area", displayName: "Area", columnOrder: 9, dataType: "string", required: true, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "address", displayName: "Address", columnOrder: 10, dataType: "string", required: true, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "clinic", displayName: "Clinic/Hospital Name", columnOrder: 11, dataType: "string", required: false, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "sector", displayName: "Sector", columnOrder: 12, dataType: "enum", required: false, unique: false, options: ["Private", "Public", "NGO", "Military"], searchable: false, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "phone", displayName: "Phone", columnOrder: 14, dataType: "string", required: false, unique: true, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "email", displayName: "Email", columnOrder: 15, dataType: "string", required: false, unique: true, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "targetFrequency", displayName: "Target Frequency (Visits/Month)", columnOrder: 16, dataType: "number", required: false, unique: false, defaultValue: 4, searchable: false, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "assignedRepId", displayName: "Assigned Rep ID", columnOrder: 17, dataType: "string", required: false, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true, lookupCollection: "users" },
  { fieldName: "assignedSupervisorId", displayName: "Assigned Supervisor ID", columnOrder: 18, dataType: "string", required: false, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true, lookupCollection: "users" },
  { fieldName: "assignedManagerId", displayName: "Assigned Manager ID", columnOrder: 19, dataType: "string", required: false, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true, lookupCollection: "users" }
];

// 4. Pharmacies Default Fields
const defaultPharmaciesFields: TemplateField[] = [
  { fieldName: "name", displayName: "Pharmacy Name", columnOrder: 1, dataType: "string", required: true, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "nameAr", displayName: "Pharmacy Name (Arabic)", columnOrder: 2, dataType: "string", required: false, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "type", displayName: "Type", columnOrder: 3, dataType: "enum", required: false, unique: false, options: ["Retail", "Chain", "Hospital", "Polyclinic"], searchable: false, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "country", displayName: "Country", columnOrder: 4, dataType: "string", required: true, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "district", displayName: "District", columnOrder: 5, dataType: "string", required: true, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "city", displayName: "City", columnOrder: 6, dataType: "string", required: true, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "area", displayName: "Area", columnOrder: 7, dataType: "string", required: true, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "address", displayName: "Address", columnOrder: 8, dataType: "string", required: true, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "contactPerson", displayName: "Contact Person", columnOrder: 9, dataType: "string", required: false, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "phone", displayName: "Phone", columnOrder: 10, dataType: "string", required: false, unique: true, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "email", displayName: "Email", columnOrder: 11, dataType: "string", required: false, unique: true, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "paymentInDays", displayName: "Payment Term (Days)", columnOrder: 12, dataType: "number", required: false, unique: false, defaultValue: 30, searchable: false, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "assignedRepId", displayName: "Assigned Rep ID", columnOrder: 13, dataType: "string", required: false, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true, lookupCollection: "users" },
  { fieldName: "assignedSupervisorId", displayName: "Assigned Supervisor ID", columnOrder: 14, dataType: "string", required: false, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true, lookupCollection: "users" },
  { fieldName: "salesPotential", displayName: "Sales Potential", columnOrder: 15, dataType: "string", required: false, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true }
];

// 5. Key Messages Default Fields
const defaultKeyMessagesFields: TemplateField[] = [
  { fieldName: "productSku", displayName: "Product SKU", columnOrder: 1, dataType: "string", required: true, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true, lookupCollection: "products" },
  { fieldName: "brandName", displayName: "Brand Name", columnOrder: 2, dataType: "string", required: true, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "therapeuticArea", displayName: "Therapeutic Area", columnOrder: 3, dataType: "string", required: true, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "keyFocus", displayName: "Key Focus", columnOrder: 4, dataType: "enum", required: true, unique: false, options: ["Primary", "Secondary", "Tertiary"], searchable: false, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "messageContent", displayName: "Message Content", columnOrder: 5, dataType: "string", required: true, unique: true, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "messageContentAr", displayName: "Message Content (Arabic)", columnOrder: 6, dataType: "string", required: false, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "detailingSequence", displayName: "Detailing Sequence", columnOrder: 7, dataType: "number", required: false, unique: false, defaultValue: 1, searchable: false, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true }
];

// Product Sales Target Import Fields
const defaultAnnualProductTargetFields: TemplateField[] = [
  { fieldName: "product", displayName: "Product (ID or SKU)", columnOrder: 1, dataType: "string", required: true, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true, lookupCollection: "products" },
  { fieldName: "year", displayName: "Year", columnOrder: 2, dataType: "number", required: true, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "annualTargetUnits", displayName: "Annual Target Units", columnOrder: 3, dataType: "number", required: true, unique: false, searchable: false, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true }
];

const defaultProductAreaDistributionFields: TemplateField[] = [
  { fieldName: "product", displayName: "Product (ID or SKU)", columnOrder: 1, dataType: "string", required: true, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true, lookupCollection: "products" },
  { fieldName: "area", displayName: "Area (ID or Code)", columnOrder: 2, dataType: "string", required: true, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true, lookupCollection: "areas" },
  { fieldName: "year", displayName: "Year", columnOrder: 3, dataType: "number", required: true, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "potentialPercentage", displayName: "Potential Percentage", columnOrder: 4, dataType: "number", required: true, unique: false, searchable: false, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true }
];

const defaultProductQuarterlyDistributionFields: TemplateField[] = [
  { fieldName: "product", displayName: "Product (ID or SKU)", columnOrder: 1, dataType: "string", required: true, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true, lookupCollection: "products" },
  { fieldName: "year", displayName: "Year", columnOrder: 2, dataType: "number", required: true, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "q1Percentage", displayName: "Q1 Percentage", columnOrder: 3, dataType: "number", required: true, unique: false, searchable: false, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "q2Percentage", displayName: "Q2 Percentage", columnOrder: 4, dataType: "number", required: true, unique: false, searchable: false, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "q3Percentage", displayName: "Q3 Percentage", columnOrder: 5, dataType: "number", required: true, unique: false, searchable: false, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
  { fieldName: "q4Percentage", displayName: "Q4 Percentage", columnOrder: 6, dataType: "number", required: true, unique: false, searchable: false, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true }
];

// Initialize templates array with default definitions
export const defaultTemplates: Template[] = [
  {
    templateId: "users",
    templateCode: "TPL-USR",
    templateName: "Users Master Template",
    moduleName: "Users",
    category: "MASTER DATA",
    version: "1.0.0",
    status: "Active",
    active: true,
    description: "Official enterprise master spreadsheet mapping for users, credentials, roles, and supervisor hierarchy assigning.",
    ownerRole: "Super Admin",
    createdAt: "2026-07-01T09:30:00Z",
    createdBy: "System",
    updatedAt: "2026-07-01T09:30:00Z",
    updatedBy: "System",
    fields: defaultUsersFields
  },
  {
    templateId: "products",
    templateCode: "TPL-PRD",
    templateName: "Products Master Template",
    moduleName: "Products",
    category: "MASTER DATA",
    version: "1.0.0",
    status: "Active",
    active: true,
    description: "Official products specification catalogue, detailing therapeutic area lines, base pricing, and sample bounds.",
    ownerRole: "Super Admin",
    createdAt: "2026-07-01T09:30:00Z",
    createdBy: "System",
    updatedAt: "2026-07-01T09:30:00Z",
    updatedBy: "System",
    fields: defaultProductsFields
  },
  {
    templateId: "physicians",
    templateCode: "TPL-PHY",
    templateName: "Physicians Master Template",
    moduleName: "Physicians",
    category: "MASTER DATA",
    version: "1.0.0",
    status: "Active",
    active: true,
    description: "Official doctor master listing, containing specialty taxonomy, rating classification levels, sector, and area path codes.",
    ownerRole: "Super Admin",
    createdAt: "2026-07-01T09:30:00Z",
    createdBy: "System",
    updatedAt: "2026-07-01T09:30:00Z",
    updatedBy: "System",
    fields: defaultPhysiciansFields
  },
  {
    templateId: "pharmacies",
    templateCode: "TPL-PHR",
    templateName: "Pharmacies Master Template",
    moduleName: "Pharmacies",
    category: "MASTER DATA",
    version: "1.0.0",
    status: "Active",
    active: true,
    description: "Official commercial retail pharmacy network, mapping type classification, payment limits, and assigned sales routing.",
    ownerRole: "Super Admin",
    createdAt: "2026-07-01T09:30:00Z",
    createdBy: "System",
    updatedAt: "2026-07-01T09:30:00Z",
    updatedBy: "System",
    fields: defaultPharmaciesFields
  },
  {
    templateId: "keymessages",
    templateCode: "TPL-MSG",
    templateName: "Key Messages Master Template",
    moduleName: "Key Messages",
    category: "MASTER DATA",
    version: "1.0.0",
    status: "Active",
    active: true,
    description: "Promotional and scientific key detailing claims linked to registered SKU brands.",
    ownerRole: "Super Admin",
    createdAt: "2026-07-01T09:30:00Z",
    createdBy: "System",
    updatedAt: "2026-07-01T09:30:00Z",
    updatedBy: "System",
    fields: defaultKeyMessagesFields
  },
  // Sub-template definitions placeholder so they show up in the Dynamic Registry selector:
  {
    templateId: "sampleallocation",
    templateCode: "TPL-SMP-ALC",
    templateName: "Sample Allocation Template",
    moduleName: "Sample Allocation",
    category: "FIELD FORCE",
    version: "1.0.0",
    status: "Active",
    active: true,
    description: "Monthly medical representative sample quota limits distribution sheet.",
    ownerRole: "General Manager",
    createdAt: "2026-07-01T09:30:00Z",
    createdBy: "System",
    updatedAt: "2026-07-01T09:30:00Z",
    updatedBy: "System",
    fields: [
      { fieldName: "repEmail", displayName: "Rep Email", columnOrder: 1, dataType: "string", required: true, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true, lookupCollection: "users" },
      { fieldName: "productSku", displayName: "Product SKU", columnOrder: 2, dataType: "string", required: true, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true, lookupCollection: "products" },
      { fieldName: "quantity", displayName: "Quantity", columnOrder: 3, dataType: "number", required: true, unique: false, defaultValue: 100, searchable: false, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true }
    ]
  },
  {
    templateId: "outstandingbalances",
    templateCode: "TPL-FIN-BAL",
    templateName: "Outstanding Balances Template",
    moduleName: "Outstanding Balances",
    category: "FINANCIAL",
    version: "1.0.0",
    status: "Active",
    active: true,
    description: "Outstanding balances sheet, mapping pharmacy/customer client accounts and total balance lines.",
    ownerRole: "Finance Officer",
    createdAt: "2026-07-01T09:30:00Z",
    createdBy: "System",
    updatedAt: "2026-07-01T09:30:00Z",
    updatedBy: "System",
    fields: [
      { fieldName: "customerEmail", displayName: "Customer Email", columnOrder: 1, dataType: "string", required: true, unique: true, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true, lookupCollection: "pharmacies" },
      { fieldName: "balance", displayName: "Outstanding Balance", columnOrder: 2, dataType: "number", required: true, unique: false, defaultValue: 0, searchable: false, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
      { fieldName: "creditLimit", displayName: "Credit Limit", columnOrder: 3, dataType: "number", required: true, unique: false, defaultValue: 10000, searchable: false, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true }
    ]
  },
  {
    templateId: "warehouseinventory",
    templateCode: "TPL-LOG-INV",
    templateName: "Warehouse Inventory Template",
    moduleName: "Warehouse Inventory",
    category: "LOGISTICS",
    version: "1.0.0",
    status: "Active",
    active: true,
    description: "Standard inventory master database, tracking SKU item availability across regional supply depot hubs.",
    ownerRole: "Warehouse / Inventory",
    createdAt: "2026-07-01T09:30:00Z",
    createdBy: "System",
    updatedAt: "2026-07-01T09:30:00Z",
    updatedBy: "System",
    fields: [
      { fieldName: "sku", displayName: "Product SKU", columnOrder: 1, dataType: "string", required: true, unique: true, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true, lookupCollection: "products" },
      { fieldName: "depotName", displayName: "Depot Name", columnOrder: 2, dataType: "string", required: true, unique: false, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true },
      { fieldName: "quantity", displayName: "Depot Stock Quantity", columnOrder: 3, dataType: "number", required: true, unique: false, defaultValue: 0, searchable: false, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true }
    ]
  },
  {
    templateId: "annualproducttarget",
    templateCode: "TPL-PRD-TRG",
    templateName: "Annual Product Target Template",
    moduleName: "Annual Product Target",
    category: "COMMERCIAL",
    version: "1.0.0",
    status: "Active",
    active: true,
    description: "Official template for importing annual product sales targets.",
    ownerRole: "General Manager",
    createdAt: "2026-07-01T09:30:00Z",
    createdBy: "System",
    updatedAt: "2026-07-01T09:30:00Z",
    updatedBy: "System",
    fields: defaultAnnualProductTargetFields
  },
  {
    templateId: "productareadistribution",
    templateCode: "TPL-PRD-AREA",
    templateName: "Product Area Distribution Template",
    moduleName: "Product Area Distribution",
    category: "COMMERCIAL",
    version: "1.0.0",
    status: "Active",
    active: true,
    description: "Official template for importing product area potential distributions.",
    ownerRole: "General Manager",
    createdAt: "2026-07-01T09:30:00Z",
    createdBy: "System",
    updatedAt: "2026-07-01T09:30:00Z",
    updatedBy: "System",
    fields: defaultProductAreaDistributionFields
  },
  {
    templateId: "productquarterlydistribution",
    templateCode: "TPL-PRD-QTR",
    templateName: "Quarterly Distribution Template",
    moduleName: "Quarterly Distribution",
    category: "COMMERCIAL",
    version: "1.0.0",
    status: "Active",
    active: true,
    description: "Official template for importing product quarterly distribution percentages.",
    ownerRole: "General Manager",
    createdAt: "2026-07-01T09:30:00Z",
    createdBy: "System",
    updatedAt: "2026-07-01T09:30:00Z",
    updatedBy: "System",
    fields: defaultProductQuarterlyDistributionFields
  }
];

// In-Memory Storage Backing for Client Fallbacks if Firestore isn't provisioned or permissions block
let cachedTemplates: Template[] = [];

try {
  const localVal = localStorage.getItem("menareps_registry_templates");
  if (localVal) {
    cachedTemplates = JSON.parse(localVal);
  } else {
    cachedTemplates = [...defaultTemplates];
    localStorage.setItem("menareps_registry_templates", JSON.stringify(cachedTemplates));
  }
} catch (e) {
  cachedTemplates = [...defaultTemplates];
}

// Loads templates from Firestore or drops back gracefully
export async function getTemplates(): Promise<Template[]> {
  try {
    const snap = await getDocs(collection(db, "templates"));
    const list: Template[] = [];
    snap.forEach(d => list.push(d.data() as Template));
    if (list.length > 0) {
      cachedTemplates = list;
      localStorage.setItem("menareps_registry_templates", JSON.stringify(list));
      return list;
    }
  } catch (err) {
    console.warn("Firestore templates collection failed, using local fallback.", err);
  }
  return cachedTemplates;
}

// Saves/Updates a template
export async function saveTemplate(template: Template): Promise<void> {
  const idx = cachedTemplates.findIndex(t => t.templateId === template.templateId);
  if (idx !== -1) {
    cachedTemplates[idx] = template;
  } else {
    cachedTemplates.push(template);
  }
  localStorage.setItem("menareps_registry_templates", JSON.stringify(cachedTemplates));

  try {
    await setDoc(doc(db, "templates", template.templateId), template);
  } catch (err) {
    console.error("Firestore template save failed:", err);
  }
}

// Save version history entry
export async function logTemplateHistory(history: TemplateHistory): Promise<void> {
  try {
    await setDoc(doc(db, "templateHistory", `${history.templateId}_v_${history.version}`), history);
  } catch (err) {
    console.error("Firestore template history save failed:", err);
  }
}

// Fetch version history for a template
export async function getTemplateHistory(templateId: string): Promise<TemplateHistory[]> {
  const historyList: TemplateHistory[] = [];
  try {
    const snap = await getDocs(collection(db, "templateHistory"));
    snap.forEach(d => {
      const hist = d.data() as TemplateHistory;
      if (hist.templateId === templateId) {
        historyList.push(hist);
      }
    });
  } catch (err) {
    console.error("Firestore fetch template history failed:", err);
  }
  return historyList;
}

// Deploy new version using transactions to avoid conflict, duplicate archives or active versions
export async function deployNewTemplateVersionTransactional(
  templateId: string,
  newVersion: string,
  changelog: string,
  userName: string,
  userId: string,
  userRole: string
): Promise<Template> {
  const templateRef = doc(db, "templates", templateId);

  try {
    let resultTemplate: Template | null = null;

    await runTransaction(db, async (transaction) => {
      const docSnap = await transaction.get(templateRef);
      if (!docSnap.exists()) {
        throw new Error(`Template registry record ${templateId} does not exist.`);
      }

      const currentTemplate = docSnap.data() as Template;

      // Prevent deploying the exact same active version
      if (currentTemplate.version === newVersion) {
        throw new Error(`Version conflict: Version ${newVersion} is already active on this template.`);
      }

      // Archive previous version to history
      const historyId = `${templateId}_v_${currentTemplate.version}`;
      const historyRef = doc(db, "templateHistory", historyId);

      const histEntry: TemplateHistory = {
        id: historyId,
        templateId: templateId,
        version: currentTemplate.version,
        updatedAt: new Date().toISOString(),
        updatedBy: userName,
        changeLog: changelog || "Schema fields alignment.",
        fields: [...currentTemplate.fields]
      };

      // Save history record
      transaction.set(historyRef, histEntry);

      // Update current template
      const updatedTemplate: Template = {
        ...currentTemplate,
        version: newVersion,
        updatedAt: new Date().toISOString(),
        updatedBy: userName
      };

      transaction.set(templateRef, updatedTemplate);
      resultTemplate = updatedTemplate;

      // Log Audit Log in the SAME transaction
      const auditLogId = `AUD-${Math.floor(100000 + Math.random() * 900000)}`;
      const auditLogRef = doc(db, "auditLogs", auditLogId);
      const auditData = {
        id: auditLogId,
        userId: userId,
        userName: userName,
        userRole: userRole,
        action: "Template Version Activated",
        entityType: "Template",
        entityId: templateId,
        details: `Template version activated for ${currentTemplate.templateName}: ${currentTemplate.version} -> ${newVersion}. Changelog: ${changelog}`,
        timestamp: new Date().toISOString()
      };
      const decoratedAudit = decorateRecord(auditData, userId, "create");
      transaction.set(auditLogRef, decoratedAudit);
    });

    if (!resultTemplate) {
      throw new Error("Template transaction did not produce a result.");
    }
    return resultTemplate;
  } catch (err) {
    console.error("Firestore template deploy version failed:", err);
    throw err;
  }
}

// Rollback version using transaction to update status cleanly
export async function rollbackTemplateVersionTransactional(
  templateId: string,
  hist: TemplateHistory,
  userName: string,
  userId: string,
  userRole: string
): Promise<Template> {
  const templateRef = doc(db, "templates", templateId);

  try {
    let resultTemplate: Template | null = null;

    await runTransaction(db, async (transaction) => {
      const docSnap = await transaction.get(templateRef);
      if (!docSnap.exists()) {
        throw new Error(`Template registry record ${templateId} does not exist.`);
      }

      const currentTemplate = docSnap.data() as Template;

      // Update current template back to the archived fields and version
      const updatedTemplate: Template = {
        ...currentTemplate,
        version: hist.version,
        fields: [...hist.fields],
        updatedAt: new Date().toISOString(),
        updatedBy: userName
      };

      transaction.set(templateRef, updatedTemplate);
      resultTemplate = updatedTemplate;

      // Log Audit Log in the SAME transaction
      const auditLogId = `AUD-${Math.floor(100000 + Math.random() * 900000)}`;
      const auditLogRef = doc(db, "auditLogs", auditLogId);
      const auditData = {
        id: auditLogId,
        userId: userId,
        userName: userName,
        userRole: userRole,
        action: "Template Version Rolled Back",
        entityType: "Template",
        entityId: templateId,
        details: `Rolled back template ${currentTemplate.templateName} to archived version ${hist.version}.`,
        timestamp: new Date().toISOString()
      };
      const decoratedAudit = decorateRecord(auditData, userId, "create");
      transaction.set(auditLogRef, decoratedAudit);
    });

    if (!resultTemplate) {
      throw new Error("Template transaction did not produce a result.");
    }
    return resultTemplate;
  } catch (err) {
    console.error("Firestore template rollback failed:", err);
    throw err;
  }
}
