import { Role, CANONICAL_USER_ROLES } from "../types";

export interface FieldDefinition {
  key: string;
  label: string; // The exact column name in the official Excel template
  type: "string" | "number" | "boolean" | "enum" | "date" | "array";
  required?: boolean;
  options?: string[]; // For enum types
  defaultValue?: any;
  filterable?: boolean; // Whether it can be used for filtering
  exportable?: boolean; // Whether it should be exported to CSV/Excel
}

// 1. Users Template Definition
export const userTemplateFields: FieldDefinition[] = [
  { key: "username", label: "Username", type: "string", required: true, exportable: true, filterable: true },
  { key: "firstName", label: "First Name", type: "string", required: true, exportable: true, filterable: true },
  { key: "lastName", label: "Last Name", type: "string", required: true, exportable: true, filterable: true },
  { key: "email", label: "Email", type: "string", required: true, exportable: true, filterable: true },
  { key: "managerEmail", label: "Manager Email", type: "string", required: false, exportable: true, filterable: true },
  { key: "role", label: "Role", type: "enum", required: true, exportable: true, filterable: true, options: CANONICAL_USER_ROLES },
  { key: "country", label: "Country", type: "string", required: false, exportable: true, filterable: true },
  { key: "district", label: "District", type: "string", required: false, exportable: true, filterable: true },
  { key: "city", label: "City", type: "string", required: false, exportable: true, filterable: true },
  { key: "areaIds", label: "Area Codes", type: "string", required: false, exportable: true, filterable: true },
  { key: "areaNames", label: "Area Names", type: "string", required: false, exportable: true, filterable: true },
  { key: "active", label: "Active", type: "boolean", required: false, exportable: true, filterable: true, defaultValue: true },
];

// 2. Products Template Definition
export const productTemplateFields: FieldDefinition[] = [
  { key: "sku", label: "SKU", type: "string", required: true, exportable: true, filterable: true },
  { key: "name", label: "Product Name", type: "string", required: true, exportable: true, filterable: true },
  { key: "nameAr", label: "Arabic Product Name", type: "string", required: false, exportable: true, filterable: true },
  { key: "brand", label: "Product Promotion Group", type: "string", required: true, exportable: true, filterable: true },
  { key: "productFamily", label: "Product Family", type: "string", required: false, exportable: true, filterable: true },
  { key: "therapeuticArea", label: "Therapeutic Area", type: "string", required: true, exportable: true, filterable: true },
  { key: "productType", label: "Product Type", type: "string", required: false, exportable: true, filterable: true },
  { key: "manufacturer", label: "Manufacturer", type: "string", required: false, exportable: true, filterable: true },
  { key: "price", label: "Price", type: "number", required: true, exportable: true, filterable: true },
  { key: "stockQuantity", label: "Initial Stock", type: "number", required: true, exportable: true, filterable: true },
  { key: "strength", label: "Strength", type: "string", required: false, exportable: true, filterable: true },
  { key: "packageSize", label: "Package Size", type: "string", required: false, exportable: true, filterable: true },
  { key: "atcClassification", label: "ATC Classification", type: "string", required: false, exportable: true, filterable: true },
  { key: "prescriptionStatus", label: "Prescription Status", type: "enum", required: false, exportable: true, filterable: true, options: ["Prescription", "OTC", "Medical Device", "Cosmetic", "Dermocosmetic"] },
  { key: "marketingStatus", label: "Marketing Status", type: "enum", required: false, exportable: true, filterable: true, options: ["Pre-launch", "Active", "Phase-out", "Discontinued"] },
  { key: "parentProductSku", label: "Parent Product SKU", type: "string", required: false, exportable: true, filterable: true },
  { key: "isSample", label: "Sample SKU", type: "enum", required: false, exportable: true, filterable: true, options: ["Yes", "No"] },
  { key: "isSampleable", label: "Can Generate Samples", type: "enum", required: false, exportable: true, filterable: true, options: ["Yes", "No"] },
  { key: "monthlyRepSampleLimit", label: "Monthly Rep Sample Limit", type: "number", required: false, exportable: true, filterable: false },
  { key: "monthlyPhysicianSampleLimit", label: "Monthly Physician Sample Limit", type: "number", required: false, exportable: true, filterable: false },
  { key: "productImageUrl", label: "Product Image", type: "string", required: false, exportable: true, filterable: false },
  { key: "description", label: "Description", type: "string", required: false, exportable: true, filterable: true },
  { key: "isActive", label: "Active", type: "boolean", required: false, exportable: true, filterable: true, defaultValue: true },
];

// 3. Physicians Template Definition
export const physicianTemplateFields: FieldDefinition[] = [
  { key: "name", label: "Physician Name", type: "string", required: true, exportable: true, filterable: true },
  { key: "nameAr", label: "Physician Name (Arabic)", type: "string", required: false, exportable: true, filterable: true },
  { key: "specialty", label: "Specialty", type: "string", required: true, exportable: true, filterable: true },
  { key: "segment", label: "Segment", type: "enum", required: true, exportable: true, filterable: true, options: ["A", "B", "C"] },
  { key: "keyOpinionLeader", label: "Key Opinion Leader", type: "enum", required: false, exportable: true, filterable: true, options: ["Yes", "No"] },
  { key: "primaryPromotionGroupName", label: "Primary Promotion Group", type: "string", required: true, exportable: true, filterable: true },
  { key: "targetPromotionGroupNames", label: "Target Promotion Groups", type: "string", required: false, exportable: true, filterable: true },
  { key: "country", label: "Country", type: "string", required: true, exportable: true, filterable: true },
  { key: "district", label: "District", type: "string", required: true, exportable: true, filterable: true },
  { key: "city", label: "City", type: "string", required: true, exportable: true, filterable: true },
  { key: "area", label: "Area/Territory", type: "string", required: true, exportable: true, filterable: true },
  { key: "address", label: "Address", type: "string", required: true, exportable: true, filterable: true },
  { key: "clinic", label: "Clinic/Hospital Name", type: "string", required: false, exportable: true, filterable: true },
  { key: "sector", label: "Sector", type: "enum", required: false, exportable: true, filterable: true, options: ["Private", "Public", "NGO", "Military"] },
  { key: "phone", label: "Phone", type: "string", required: false, exportable: true, filterable: true },
  { key: "email", label: "Email", type: "string", required: false, exportable: true, filterable: true },
  { key: "targetFrequency", label: "Target Frequency (Visits/Month)", type: "number", required: false, exportable: true, filterable: true },
  { key: "assignedRepId", label: "Assigned Rep ID", type: "string", required: false, exportable: true, filterable: true },
  { key: "assignedSupervisorId", label: "Assigned Supervisor ID", type: "string", required: false, exportable: true, filterable: true },
  { key: "assignedManagerId", label: "Assigned Manager ID", type: "string", required: false, exportable: true, filterable: true },
];

// 4. Pharmacies Template Definition
export const pharmacyTemplateFields: FieldDefinition[] = [
  { key: "name", label: "Pharmacy Name", type: "string", required: true, exportable: true, filterable: true },
  { key: "nameAr", label: "Pharmacy Name (Arabic)", type: "string", required: false, exportable: true, filterable: true },
  { key: "type", label: "Type", type: "enum", required: false, exportable: true, filterable: true, options: ["Retail", "Chain", "Hospital", "Polyclinic"] },
  { key: "country", label: "Country", type: "string", required: true, exportable: true, filterable: true },
  { key: "district", label: "District", type: "string", required: true, exportable: true, filterable: true },
  { key: "city", label: "City", type: "string", required: true, exportable: true, filterable: true },
  { key: "area", label: "Area", type: "string", required: true, exportable: true, filterable: true },
  { key: "address", label: "Address", type: "string", required: true, exportable: true, filterable: true },
  { key: "contactPerson", label: "Contact Person", type: "string", required: false, exportable: true, filterable: true },
  { key: "phone", label: "Phone", type: "string", required: false, exportable: true, filterable: true },
  { key: "email", label: "Email", type: "string", required: false, exportable: true, filterable: true },
  { key: "paymentInDays", label: "Payment Term (Days)", type: "number", required: false, exportable: true, filterable: true },
  { key: "assignedRepId", label: "Assigned Rep ID", type: "string", required: false, exportable: true, filterable: true },
  { key: "assignedSupervisorId", label: "Assigned Supervisor ID", type: "string", required: false, exportable: true, filterable: true },
  { key: "salesPotential", label: "Sales Potential", type: "string", required: false, exportable: true, filterable: true },
];

// 5. Key Messages Template Definition
export const keyMessageTemplateFields: FieldDefinition[] = [
  { key: "productSku", label: "Product SKU", type: "string", required: true, exportable: true, filterable: true },
  { key: "brandName", label: "Product Promotion Group", type: "string", required: true, exportable: true, filterable: true },
  { key: "therapeuticArea", label: "Therapeutic Area", type: "string", required: true, exportable: true, filterable: true },
  { key: "keyFocus", label: "Key Focus", type: "enum", required: true, exportable: true, filterable: true, options: ["Primary", "Secondary", "Tertiary"] },
  { key: "messageContent", label: "Message Content", type: "string", required: true, exportable: true, filterable: true },
  { key: "messageContentAr", label: "Message Content (Arabic)", type: "string", required: false, exportable: true, filterable: true },
  { key: "detailingSequence", label: "Detailing Sequence", type: "number", required: false, exportable: true, filterable: true },
  { key: "active", label: "Active", type: "boolean", required: false, exportable: true, filterable: true, defaultValue: true },
];

// 6. Geographic Master (Area) Template Definition
export const areasTemplateFields: FieldDefinition[] = [
  { key: "countryName", label: "Country", type: "string", required: true, exportable: true, filterable: true },
  { key: "districtName", label: "District", type: "string", required: true, exportable: true, filterable: true },
  { key: "cityName", label: "City", type: "string", required: true, exportable: true, filterable: true },
  { key: "name", label: "Area", type: "string", required: true, exportable: true, filterable: true },
  { key: "code", label: "Area Code", type: "string", required: false, exportable: true, filterable: true },
  { key: "active", label: "Active", type: "boolean", required: false, exportable: true, filterable: true, defaultValue: true },
];

// 7. Annual Product Target Template Definition
export const annualProductTargetTemplateFields: FieldDefinition[] = [
  { key: "product", label: "Product (ID or SKU)", type: "string", required: true, exportable: true, filterable: true },
  { key: "year", label: "Year", type: "number", required: true, exportable: true, filterable: true },
  { key: "annualTargetUnits", label: "Annual Target Units", type: "number", required: true, exportable: true, filterable: true },
];

// 8. Product Area Distribution Template Definition
export const productAreaDistributionTemplateFields: FieldDefinition[] = [
  { key: "product", label: "Product (ID or SKU)", type: "string", required: true, exportable: true, filterable: true },
  { key: "area", label: "Area (ID or Code)", type: "string", required: true, exportable: true, filterable: true },
  { key: "year", label: "Year", type: "number", required: true, exportable: true, filterable: true },
  { key: "potentialPercentage", label: "Potential Percentage", type: "number", required: true, exportable: true, filterable: true },
];

// 9. Product Quarterly Distribution Template Definition
export const productQuarterlyDistributionTemplateFields: FieldDefinition[] = [
  { key: "product", label: "Product (ID or SKU)", type: "string", required: true, exportable: true, filterable: true },
  { key: "year", label: "Year", type: "number", required: true, exportable: true, filterable: true },
  { key: "q1Percentage", label: "Q1 Percentage", type: "number", required: true, exportable: true, filterable: true },
  { key: "q2Percentage", label: "Q2 Percentage", type: "number", required: true, exportable: true, filterable: true },
  { key: "q3Percentage", label: "Q3 Percentage", type: "number", required: true, exportable: true, filterable: true },
  { key: "q4Percentage", label: "Q4 Percentage", type: "number", required: true, exportable: true, filterable: true },
];

// Map of template definitions by entity type
export const TemplateSchemas: Record<string, FieldDefinition[]> = {
  users: userTemplateFields,
  products: productTemplateFields,
  physicians: physicianTemplateFields,
  pharmacies: pharmacyTemplateFields,
  keyMessages: keyMessageTemplateFields,
  areas: areasTemplateFields,
  annualproducttarget: annualProductTargetTemplateFields,
  productareadistribution: productAreaDistributionTemplateFields,
  productquarterlydistribution: productQuarterlyDistributionTemplateFields
};

// Synchronizes live template registry fields into the standard TemplateSchemas object
export function syncLiveTemplatesToSchemas(templates: any[]) {
  templates.forEach(tpl => {
    const key = tpl.templateId === "keymessages" ? "keyMessages" : tpl.templateId;
    if (tpl.active && tpl.fields) {
      const mappedFields: FieldDefinition[] = tpl.fields
        .sort((a: any, b: any) => (a.columnOrder || 0) - (b.columnOrder || 0))
        .map((f: any) => ({
          key: f.fieldName,
          label: f.displayName,
          type: f.dataType,
          required: !!f.required,
          options: f.options,
          defaultValue: f.defaultValue,
          filterable: f.filterable !== false,
          exportable: f.visibleInExport !== false
        }));
      TemplateSchemas[key] = mappedFields;
    }
  });
}

// Utilities for processing data based on schemas

// Generates a blank object adhering to a schema
export function generateBlankRecord(schemaType: keyof typeof TemplateSchemas): any {
  const schema = TemplateSchemas[schemaType];
  const record: any = {};
  
  if (!schema) return record;

  for (const field of schema) {
    if (field.defaultValue !== undefined) {
      record[field.key] = field.defaultValue;
    } else if (field.type === "string" || field.type === "enum") {
      record[field.key] = "";
    } else if (field.type === "number") {
      record[field.key] = 0;
    } else if (field.type === "boolean") {
      record[field.key] = false;
    } else if (field.type === "array") {
      record[field.key] = [];
    }
  }

  return record;
}

// Maps an imported row (e.g., from CSV mapped by label) back to schema keys
export function mapImportedRowToSchema(row: Record<string, any>, schemaType: keyof typeof TemplateSchemas): Record<string, any> {
  const schema = TemplateSchemas[schemaType];
  const mapped: Record<string, any> = {};
  
  if (!schema) return row;

  for (const field of schema) {
    // Attempt to match exact label, then lowercase/trimmed variations
    let value = row[field.label];
    
    if (value === undefined) {
      // Look for fuzzy match
      const fuzzyKey = Object.keys(row).find(
        k => k.toLowerCase().trim() === field.label.toLowerCase().trim() || 
             k.toLowerCase().trim() === field.key.toLowerCase().trim()
      );
      if (fuzzyKey) value = row[fuzzyKey];
    }
    
    if (value !== undefined) {
      // Type coercion
      if (field.type === "number") {
        mapped[field.key] = Number(value);
      } else if (field.type === "boolean") {
        mapped[field.key] = String(value).toLowerCase() === "true" || String(value).toLowerCase() === "yes" || value === 1;
      } else {
        mapped[field.key] = value;
      }
    }
  }
  
  return mapped;
}

// Maps a schema record to export format (keys -> labels)
export function mapRecordForExport(record: Record<string, any>, schemaType: keyof typeof TemplateSchemas): Record<string, any> {
  const schema = TemplateSchemas[schemaType];
  const exported: Record<string, any> = {};
  
  if (!schema) return record;

  for (const field of schema) {
    if (field.exportable) {
      let val = record[field.key] !== undefined ? record[field.key] : "";
      if (Array.isArray(val)) {
        val = val.join("; ");
      }
      exported[field.label] = val;
    }
  }
  
  return exported;
}
