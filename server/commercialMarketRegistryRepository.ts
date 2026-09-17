import { FieldPath, type Firestore, type Query } from "firebase-admin/firestore";
import { getFirebaseAdminServices } from "./firebaseAdmin";

export const COMMERCIAL_REGISTRY_QUERY_LIMIT = 100;
export const FIRESTORE_IN_QUERY_LIMIT = 30;

export interface CommercialRegistryPage {
  records: unknown[];
  nextCursor?: string;
}

export interface CommercialRegistryReadRequest {
  ids?: readonly string[];
  cursor?: string;
  limit: number;
}

export interface CommercialMarketRegistryRepository {
  readCompanies(request: CommercialRegistryReadRequest): Promise<CommercialRegistryPage>;
  readCountries(request: CommercialRegistryReadRequest): Promise<CommercialRegistryPage>;
  readMarkets(request: CommercialRegistryReadRequest): Promise<CommercialRegistryPage>;
  readCompanyMarkets(request: CommercialRegistryReadRequest): Promise<CommercialRegistryPage>;
  readProductMarketCatalog(request: CommercialRegistryReadRequest): Promise<CommercialRegistryPage>;
  readProducts(request: CommercialRegistryReadRequest): Promise<CommercialRegistryPage>;
}

const COLLECTIONS = {
  companies: { collection: "companies", idField: "companyId" },
  countries: { collection: "countries", idField: "countryId" },
  markets: { collection: "marketSettings", idField: "marketId" },
  companyMarkets: { collection: "companyMarkets", idField: "companyMarketId", filterField: "companyId" },
  catalog: { collection: "productMarketCatalog", idField: "catalogEntryId", filterField: "companyMarketId" },
  products: { collection: "products", idField: "productId" },
} as const;

function assertRequest(request: CommercialRegistryReadRequest): void {
  if (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > COMMERCIAL_REGISTRY_QUERY_LIMIT) throw new Error("COMMERCIAL_REGISTRY_INVALID_PAGE_LIMIT");
  if (request.ids && (request.ids.length < 1 || request.ids.length > FIRESTORE_IN_QUERY_LIMIT)) throw new Error("COMMERCIAL_REGISTRY_INVALID_ID_CHUNK");
}

function timestampToIso(value: unknown): unknown {
  if (value && typeof value === "object" && "toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return ((value as { toDate(): Date }).toDate()).toISOString();
  }
  return value;
}

function convertDocument(document: any, idField: string): Record<string, unknown> {
  const data = document.data() as Record<string, unknown>;
  // Product identity is the Firestore document ID; productId is redundant.
  // Other registry collections retain their explicit identifier contract.
  if (idField === "productId") {
    if ((data.productId !== undefined && data.productId !== document.id)
      || (data.id !== undefined && data.id !== document.id)) throw new Error("COMMERCIAL_REGISTRY_DOCUMENT_ID_MISMATCH");
    return Object.fromEntries(Object.entries({ ...data, productId: document.id }).map(([key, value]) => [key, timestampToIso(value)]));
  }
  if (data[idField] !== document.id) throw new Error("COMMERCIAL_REGISTRY_DOCUMENT_ID_MISMATCH");
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, timestampToIso(value)]));
}

async function readPage(
  db: Firestore,
  descriptor: { collection: string; idField: string; filterField?: string },
  request: CommercialRegistryReadRequest,
): Promise<CommercialRegistryPage> {
  assertRequest(request);
  let query: Query = db.collection(descriptor.collection);
  if (request.ids) query = descriptor.filterField
    ? query.where(descriptor.filterField, "in", [...request.ids])
    : query.where(FieldPath.documentId(), "in", [...request.ids]);
  query = query.orderBy(FieldPath.documentId()).limit(request.limit);
  if (request.cursor) query = query.startAfter(request.cursor);
  const snapshot = await query.get();
  const records = snapshot.docs.map(document => convertDocument(document, descriptor.idField));
  return {
    records,
    nextCursor: snapshot.docs.length === request.limit ? snapshot.docs[snapshot.docs.length - 1].id : undefined,
  };
}

export function createFirestoreCommercialMarketRegistryRepository(
  db: Firestore = getFirebaseAdminServices().db,
): CommercialMarketRegistryRepository {
  return {
    readCompanies: request => readPage(db, COLLECTIONS.companies, request),
    readCountries: request => readPage(db, COLLECTIONS.countries, request),
    readMarkets: request => readPage(db, COLLECTIONS.markets, request),
    readCompanyMarkets: request => readPage(db, COLLECTIONS.companyMarkets, request),
    readProductMarketCatalog: request => readPage(db, COLLECTIONS.catalog, request),
    readProducts: request => readPage(db, COLLECTIONS.products, request),
  };
}
