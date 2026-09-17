import { validateMarketSettings, type MarketBusinessSettings } from "./marketSettings";

export const COMMERCIAL_REGISTRY_SCHEMA_VERSION = 1 as const;

export interface ServerControlledAuditFields {
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface CanonicalCountryReference extends ServerControlledAuditFields {
  countryId: string;
  active: boolean;
}

export interface CanonicalProductReference extends ServerControlledAuditFields {
  productId: string;
  active: boolean;
}

export interface CompanyRecord extends ServerControlledAuditFields {
  schemaVersion: typeof COMMERCIAL_REGISTRY_SCHEMA_VERSION;
  companyId: string;
  name: string;
  active: boolean;
}

/**
 * One deterministic document exists per Company × Market pair. Effective-state
 * changes update that server-controlled document. Historical revisions belong
 * in a dedicated audit mechanism introduced by a later work package.
 */
export interface CompanyMarketAssignment extends ServerControlledAuditFields {
  schemaVersion: typeof COMMERCIAL_REGISTRY_SCHEMA_VERSION;
  companyMarketId: string;
  companyId: string;
  marketId: string;
  active: boolean;
  effectiveFrom: string;
  effectiveTo?: string;
}

export interface ProductMarketCatalogEntry extends ServerControlledAuditFields {
  schemaVersion: typeof COMMERCIAL_REGISTRY_SCHEMA_VERSION;
  catalogEntryId: string;
  companyMarketId: string;
  companyId: string;
  marketId: string;
  productId: string;
  active: boolean;
  saleable: boolean;
  unitPrice: number;
  effectiveFrom: string;
  effectiveTo?: string;
}

export type CommercialRegistryValidationCode =
  | "INVALID_RECORD"
  | "INVALID_SCHEMA_VERSION"
  | "INVALID_IDENTIFIER"
  | "INVALID_NAME"
  | "INVALID_ACTIVE_STATE"
  | "INVALID_SALEABLE_STATE"
  | "INVALID_EFFECTIVE_DATE"
  | "INVALID_EFFECTIVE_RANGE"
  | "INVALID_PRICE"
  | "INVALID_MARKET_SETTINGS"
  | "DETERMINISTIC_ID_MISMATCH"
  | "DUPLICATE_RECORD_ID"
  | "DUPLICATE_RELATIONSHIP"
  | "MISSING_REFERENCE"
  | "INACTIVE_REFERENCE"
  | "RELATIONSHIP_CONFLICT"
  | "OVERLAPPING_CATALOG_PERIOD";

export interface CommercialRegistryValidationIssue {
  code: CommercialRegistryValidationCode;
  path: string;
  message: string;
}

export type CommercialRegistryValidationResult<T> =
  | { valid: true; value: T; errors: [] }
  | { valid: false; errors: CommercialRegistryValidationIssue[] };

export interface CommercialRegistrySnapshot {
  companies: unknown[];
  markets: unknown[];
  companyMarkets: unknown[];
  productMarketCatalog: unknown[];
  countries: unknown[];
  products: unknown[];
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const canonicalId = (value: unknown): value is string => typeof value === "string" && value === value.trim() && ID.test(value);
const documentId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 1500 && value === value.trim() && !value.includes("/") && !/[\u0000-\u001f\u007f]/.test(value);
const exactTimestamp = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const issue = (code: CommercialRegistryValidationCode, path: string, message: string): CommercialRegistryValidationIssue => ({ code, path, message });
export function deterministicCompanyMarketId(companyId: string, marketId: string): string {
  return `CM_${companyId.length}:${companyId}_${marketId.length}:${marketId}`;
}

export function deterministicProductMarketCatalogId(companyId: string, marketId: string, productId: string, effectiveFrom: string): string {
  return `PMC_${companyId.length}:${companyId}_${marketId.length}:${marketId}_${productId.length}:${productId}_${effectiveFrom}`;
}

function validateSchemaAndId(errors: CommercialRegistryValidationIssue[], value: Record<string, unknown>, idField: string, path: string, idValidator: (candidate: unknown) => candidate is string = canonicalId): void {
  if (value.schemaVersion !== COMMERCIAL_REGISTRY_SCHEMA_VERSION) errors.push(issue("INVALID_SCHEMA_VERSION", `${path}.schemaVersion`, "The commercial registry schema version is unsupported."));
  if (!idValidator(value[idField])) errors.push(issue("INVALID_IDENTIFIER", `${path}.${idField}`, "A non-empty exact document identifier is required."));
}

function validateActive(errors: CommercialRegistryValidationIssue[], value: Record<string, unknown>, path: string): void {
  if (typeof value.active !== "boolean") errors.push(issue("INVALID_ACTIVE_STATE", `${path}.active`, "Active state must be an explicit boolean."));
}

function validateAuditFields(errors: CommercialRegistryValidationIssue[], value: Record<string, unknown>, path: string): void {
  for (const field of ["createdBy", "updatedBy"] as const) {
    if (!canonicalId(value[field])) errors.push(issue("INVALID_IDENTIFIER", `${path}.${field}`, "An exact canonical server actor identifier is required."));
  }
  for (const field of ["createdAt", "updatedAt"] as const) {
    if (!exactTimestamp(value[field])) errors.push(issue("INVALID_EFFECTIVE_DATE", `${path}.${field}`, `${field} must be an exact ISO timestamp.`));
  }
  if (exactTimestamp(value.createdAt) && exactTimestamp(value.updatedAt) && Date.parse(value.updatedAt) < Date.parse(value.createdAt)) {
    errors.push(issue("INVALID_EFFECTIVE_RANGE", path, "updatedAt cannot precede createdAt."));
  }
}

function validateCanonicalReference<T extends CanonicalCountryReference | CanonicalProductReference>(
  input: unknown,
  idField: "countryId" | "productId",
  path: string,
): CommercialRegistryValidationResult<T> {
  const errors: CommercialRegistryValidationIssue[] = [];
  const value = record(input);
  if (!value) return { valid: false, errors: [issue("INVALID_RECORD", path, "Canonical reference must be an object.")] };
  if (!canonicalId(value[idField])) errors.push(issue("INVALID_IDENTIFIER", `${path}.${idField}`, "An exact canonical identifier is required."));
  validateActive(errors, value, path);
  validateAuditFields(errors, value, path);
  return errors.length ? { valid: false, errors } : { valid: true, value: input as T, errors: [] };
}

export const validateCountryReference = (input: unknown, path = "country"): CommercialRegistryValidationResult<CanonicalCountryReference> =>
  validateCanonicalReference(input, "countryId", path);

export const validateProductReference = (input: unknown, path = "product"): CommercialRegistryValidationResult<CanonicalProductReference> =>
  validateCanonicalReference(input, "productId", path);

function validateEffectivePeriod(errors: CommercialRegistryValidationIssue[], value: Record<string, unknown>, path: string): void {
  if (!exactTimestamp(value.effectiveFrom)) errors.push(issue("INVALID_EFFECTIVE_DATE", `${path}.effectiveFrom`, "effectiveFrom must be an exact ISO timestamp."));
  if (value.effectiveTo !== undefined && !exactTimestamp(value.effectiveTo)) errors.push(issue("INVALID_EFFECTIVE_DATE", `${path}.effectiveTo`, "effectiveTo must be an exact ISO timestamp when supplied."));
  if (exactTimestamp(value.effectiveFrom) && exactTimestamp(value.effectiveTo) && Date.parse(value.effectiveTo) < Date.parse(value.effectiveFrom)) {
    errors.push(issue("INVALID_EFFECTIVE_RANGE", path, "effectiveTo cannot precede effectiveFrom."));
  }
}

export function validateCompanyRecord(input: unknown, path = "company"): CommercialRegistryValidationResult<CompanyRecord> {
  const errors: CommercialRegistryValidationIssue[] = [];
  const value = record(input);
  if (!value) return { valid: false, errors: [issue("INVALID_RECORD", path, "Company must be an object.")] };
  validateSchemaAndId(errors, value, "companyId", path);
  validateActive(errors, value, path);
  validateAuditFields(errors, value, path);
  if (typeof value.name !== "string" || value.name !== value.name.trim() || value.name.length === 0) errors.push(issue("INVALID_NAME", `${path}.name`, "Company name must be non-empty and exact."));
  return errors.length ? { valid: false, errors } : { valid: true, value: input as CompanyRecord, errors: [] };
}

export function validateCompanyMarketAssignment(input: unknown, path = "companyMarket"): CommercialRegistryValidationResult<CompanyMarketAssignment> {
  const errors: CommercialRegistryValidationIssue[] = [];
  const value = record(input);
  if (!value) return { valid: false, errors: [issue("INVALID_RECORD", path, "Company-market assignment must be an object.")] };
  validateSchemaAndId(errors, value, "companyMarketId", path, documentId);
  for (const field of ["companyId", "marketId"] as const) if (!canonicalId(value[field])) errors.push(issue("INVALID_IDENTIFIER", `${path}.${field}`, "An exact canonical identifier is required."));
  validateActive(errors, value, path);
  validateAuditFields(errors, value, path);
  validateEffectivePeriod(errors, value, path);
  if (documentId(value.companyMarketId) && canonicalId(value.companyId) && canonicalId(value.marketId)
    && value.companyMarketId !== deterministicCompanyMarketId(value.companyId, value.marketId)) {
    errors.push(issue("DETERMINISTIC_ID_MISMATCH", `${path}.companyMarketId`, "companyMarketId does not match its canonical company and market references."));
  }
  return errors.length ? { valid: false, errors } : { valid: true, value: input as CompanyMarketAssignment, errors: [] };
}

export function validateProductMarketCatalogEntry(input: unknown, path = "productMarketCatalog"): CommercialRegistryValidationResult<ProductMarketCatalogEntry> {
  const errors: CommercialRegistryValidationIssue[] = [];
  const value = record(input);
  if (!value) return { valid: false, errors: [issue("INVALID_RECORD", path, "Product-market catalog entry must be an object.")] };
  validateSchemaAndId(errors, value, "catalogEntryId", path, documentId);
  for (const field of ["companyMarketId", "companyId", "marketId", "productId"] as const) if (!canonicalId(value[field])) errors.push(issue("INVALID_IDENTIFIER", `${path}.${field}`, "An exact canonical identifier is required."));
  validateActive(errors, value, path);
  validateAuditFields(errors, value, path);
  if (typeof value.saleable !== "boolean") errors.push(issue("INVALID_SALEABLE_STATE", `${path}.saleable`, "Saleable state must be an explicit boolean."));
  if (typeof value.unitPrice !== "number" || !Number.isFinite(value.unitPrice) || value.unitPrice < 0) errors.push(issue("INVALID_PRICE", `${path}.unitPrice`, "Unit price must be finite and non-negative."));
  if ("currency" in value || "currencyCode" in value) errors.push(issue("RELATIONSHIP_CONFLICT", path, "Catalog currency is prohibited; currency is authoritative in market settings."));
  validateEffectivePeriod(errors, value, path);
  if (documentId(value.catalogEntryId) && canonicalId(value.companyId) && canonicalId(value.marketId) && canonicalId(value.productId) && exactTimestamp(value.effectiveFrom)
    && value.catalogEntryId !== deterministicProductMarketCatalogId(value.companyId, value.marketId, value.productId, value.effectiveFrom)) {
    errors.push(issue("DETERMINISTIC_ID_MISMATCH", `${path}.catalogEntryId`, "catalogEntryId does not match its canonical references and effectiveFrom timestamp."));
  }
  return errors.length ? { valid: false, errors } : { valid: true, value: input as ProductMarketCatalogEntry, errors: [] };
}

function duplicateIssues(values: string[], path: string): CommercialRegistryValidationIssue[] {
  const seen = new Set<string>();
  return values.flatMap(value => seen.has(value)
    ? [issue("DUPLICATE_RECORD_ID", path, `Duplicate registry identifier: ${value}`)]
    : (seen.add(value), []));
}

function periodsOverlap(left: ProductMarketCatalogEntry, right: ProductMarketCatalogEntry): boolean {
  const leftEnd = left.effectiveTo ? Date.parse(left.effectiveTo) : Number.POSITIVE_INFINITY;
  const rightEnd = right.effectiveTo ? Date.parse(right.effectiveTo) : Number.POSITIVE_INFINITY;
  return Date.parse(left.effectiveFrom) <= rightEnd && Date.parse(right.effectiveFrom) <= leftEnd;
}

export function validateCommercialRegistry(input: unknown): CommercialRegistryValidationResult<CommercialRegistrySnapshot> {
  const errors: CommercialRegistryValidationIssue[] = [];
  const raw = record(input);
  if (!raw) return { valid: false, errors: [issue("INVALID_RECORD", "registry", "Registry snapshot must be an object.")] };
  const arrayFields = ["companies", "markets", "companyMarkets", "productMarketCatalog", "countries", "products"] as const;
  for (const field of arrayFields) if (!Array.isArray(raw[field])) errors.push(issue("INVALID_RECORD", field, `${field} must be an array.`));
  if (errors.length) return { valid: false, errors };
  const snapshot = input as CommercialRegistrySnapshot;
  const companies = snapshot.companies.map((value, index) => ({ value, result: validateCompanyRecord(value, `companies.${index}`) }));
  const markets = snapshot.markets.map((value, index) => {
    const data = record(value);
    const marketErrors: CommercialRegistryValidationIssue[] = [];
    if (!data) marketErrors.push(issue("INVALID_RECORD", `markets.${index}`, "Market settings must be an object."));
    else {
      if (!canonicalId(data.marketId)) marketErrors.push(issue("INVALID_IDENTIFIER", `markets.${index}.marketId`, "An exact canonical market identifier is required."));
      if (!canonicalId(data.countryId)) marketErrors.push(issue("INVALID_IDENTIFIER", `markets.${index}.countryId`, "An exact canonical country identifier is required."));
      if (typeof data.active !== "boolean") marketErrors.push(issue("INVALID_ACTIVE_STATE", `markets.${index}.active`, "Active state must be an explicit boolean."));
      try {
        if (validateMarketSettings(value as MarketBusinessSettings).length) marketErrors.push(issue("INVALID_MARKET_SETTINGS", `markets.${index}`, "Market settings do not satisfy the established canonical contract."));
      } catch {
        marketErrors.push(issue("INVALID_MARKET_SETTINGS", `markets.${index}`, "Market settings do not satisfy the established canonical contract."));
      }
    }
    errors.push(...marketErrors);
    return marketErrors.length ? null : value as MarketBusinessSettings;
  }).filter((value): value is MarketBusinessSettings => value !== null);
  const companyMarkets = snapshot.companyMarkets.map((value, index) => ({ value, result: validateCompanyMarketAssignment(value, `companyMarkets.${index}`) }));
  const catalog = snapshot.productMarketCatalog.map((value, index) => ({ value, result: validateProductMarketCatalogEntry(value, `productMarketCatalog.${index}`) }));
  const countries = snapshot.countries.map((value, index) => ({ value, result: validateCountryReference(value, `countries.${index}`) }));
  const products = snapshot.products.map((value, index) => ({ value, result: validateProductReference(value, `products.${index}`) }));
  for (const item of [...companies, ...companyMarkets, ...catalog, ...countries, ...products]) if (!item.result.valid) errors.push(...item.result.errors);
  const validCompanies = companies.flatMap(item => item.result.valid ? [item.result.value] : []);
  const validCompanyMarkets = companyMarkets.flatMap(item => item.result.valid ? [item.result.value] : []);
  const validCatalog = catalog.flatMap(item => item.result.valid ? [item.result.value] : []);
  const validCountries = countries.flatMap(item => item.result.valid ? [item.result.value] : []);
  const validProducts = products.flatMap(item => item.result.valid ? [item.result.value] : []);
  errors.push(...duplicateIssues(validCompanies.map(value => value.companyId), "companies"));
  errors.push(...duplicateIssues(markets.map(value => value.marketId), "markets"));
  errors.push(...duplicateIssues(validCompanyMarkets.map(value => value.companyMarketId), "companyMarkets"));
  errors.push(...duplicateIssues(validCatalog.map(value => value.catalogEntryId), "productMarketCatalog"));
  errors.push(...duplicateIssues(validCountries.map(value => value.countryId), "countries"));
  errors.push(...duplicateIssues(validProducts.map(value => value.productId), "products"));
  const companyById = new Map(validCompanies.map(value => [value.companyId, value]));
  const marketById = new Map(markets.map(value => [value.marketId, value]));
  const companyMarketById = new Map(validCompanyMarkets.map(value => [value.companyMarketId, value]));
  const productById = new Map(validProducts.map(value => [value.productId, value]));
  const countryById = new Map(validCountries.map(value => [value.countryId, value]));
  markets.forEach((market, index) => {
    const country = countryById.get(market.countryId);
    if (!country) errors.push(issue("MISSING_REFERENCE", `markets.${index}.countryId`, "Referenced country does not exist."));
    else if (market.active && !country.active) errors.push(issue("INACTIVE_REFERENCE", `markets.${index}.countryId`, "Active market references an inactive country."));
  });
  const relationshipKeys = new Set<string>();
  validCompanyMarkets.forEach((assignment, index) => {
    const key = `${assignment.companyId}\u0000${assignment.marketId}`;
    if (relationshipKeys.has(key)) errors.push(issue("DUPLICATE_RELATIONSHIP", `companyMarkets.${index}`, "Company-market relationship is duplicated."));
    relationshipKeys.add(key);
    const company = companyById.get(assignment.companyId), market = marketById.get(assignment.marketId);
    if (!company) errors.push(issue("MISSING_REFERENCE", `companyMarkets.${index}.companyId`, "Referenced company does not exist."));
    if (!market) errors.push(issue("MISSING_REFERENCE", `companyMarkets.${index}.marketId`, "Referenced market does not exist."));
    if (assignment.active && company && !company.active) errors.push(issue("INACTIVE_REFERENCE", `companyMarkets.${index}.companyId`, "Active relationship references an inactive company."));
    if (assignment.active && market && !market.active) errors.push(issue("INACTIVE_REFERENCE", `companyMarkets.${index}.marketId`, "Active relationship references an inactive market."));
  });
  validCatalog.forEach((entry, index) => {
    const relationship = companyMarketById.get(entry.companyMarketId);
    if (!relationship) errors.push(issue("MISSING_REFERENCE", `productMarketCatalog.${index}.companyMarketId`, "Referenced company-market relationship does not exist."));
    else if (relationship.companyId !== entry.companyId || relationship.marketId !== entry.marketId) errors.push(issue("RELATIONSHIP_CONFLICT", `productMarketCatalog.${index}.companyMarketId`, "Catalog references conflict with the company-market relationship."));
    const product = productById.get(entry.productId);
    if (!product) errors.push(issue("MISSING_REFERENCE", `productMarketCatalog.${index}.productId`, "Referenced global product does not exist."));
    else if (entry.active && !product.active) errors.push(issue("INACTIVE_REFERENCE", `productMarketCatalog.${index}.productId`, "Active catalog entry references an inactive global product."));
    if (entry.active && relationship && !relationship.active) errors.push(issue("INACTIVE_REFERENCE", `productMarketCatalog.${index}.companyMarketId`, "Active catalog entry references an inactive company-market relationship."));
    if (entry.active && relationship) {
      const catalogStart = Date.parse(entry.effectiveFrom);
      const catalogEnd = entry.effectiveTo ? Date.parse(entry.effectiveTo) : Number.POSITIVE_INFINITY;
      const relationshipStart = Date.parse(relationship.effectiveFrom);
      const relationshipEnd = relationship.effectiveTo ? Date.parse(relationship.effectiveTo) : Number.POSITIVE_INFINITY;
      if (catalogStart < relationshipStart || catalogEnd > relationshipEnd) errors.push(issue("RELATIONSHIP_CONFLICT", `productMarketCatalog.${index}`, "Active catalog period must be contained by its company-market relationship period."));
    }
  });
  for (let left = 0; left < validCatalog.length; left += 1) for (let right = left + 1; right < validCatalog.length; right += 1) {
    const a = validCatalog[left], b = validCatalog[right];
    if (a.active && b.active && a.companyId === b.companyId && a.marketId === b.marketId && a.productId === b.productId && periodsOverlap(a, b)) {
      errors.push(issue("OVERLAPPING_CATALOG_PERIOD", `productMarketCatalog.${left}`, `Active catalog periods overlap with productMarketCatalog.${right}.`));
    }
  }
  return errors.length ? { valid: false, errors } : { valid: true, value: snapshot, errors: [] };
}
