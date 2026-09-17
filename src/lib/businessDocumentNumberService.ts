import { 
  doc, 
  Transaction, 
  Firestore, 
  collection, 
  query, 
  where, 
  getDocs, 
  writeBatch, 
  Timestamp 
} from "firebase/firestore";
import { db } from "./firebase";
import { formatBusinessDocumentNumber } from "./businessDocumentFormat";
export { formatBusinessDocumentNumber } from "./businessDocumentFormat";

export type BusinessDocumentType =
  | "PHARMACY_VISIT"
  | "PHYSICIAN_VISIT"
  | "SALES_ORDER"
  | "STOCK_REQUEST"
  | "SAMPLE_REQUEST"
  | "MARKETING_REQUEST"
  | "COLLECTION_RECEIPT"
  | "PURCHASE_ORDER"
  | "GOODS_RECEIPT"
  | "GOODS_ISSUE";

export const DOCUMENT_PREFIX_REGISTRY: Record<BusinessDocumentType, string> = {
  PHARMACY_VISIT: "PV",
  PHYSICIAN_VISIT: "MV",
  SALES_ORDER: "SO",
  STOCK_REQUEST: "SR",
  SAMPLE_REQUEST: "SM",
  MARKETING_REQUEST: "MR",
  COLLECTION_RECEIPT: "RC",
  PURCHASE_ORDER: "PO",
  GOODS_RECEIPT: "GR",
  GOODS_ISSUE: "GI"
};

export const OPERATIONAL_COUNTRY_CODES: Record<string, string> = {
  "LIBYA": "LY",
  "LY": "LY",
  "C-LIB": "LY",
  "JORDAN": "JO",
  "JO": "JO",
  "C-JOR": "JO",
  "EGYPT": "EG",
  "EG": "EG",
  "C-EGY": "EG",
  "SAUDI ARABIA": "SA",
  "SAUDI": "SA",
  "SA": "SA",
  "C-KSA": "SA",
  "UNITED ARAB EMIRATES": "AE",
  "UAE": "AE",
  "AE": "AE",
  "C-UAE": "AE",
  "IRAQ": "IQ",
  "IQ": "IQ",
  "C-IRQ": "IQ",
  "QATAR": "QA",
  "QA": "QA",
  "C-QAT": "QA",
  "KUWAIT": "KW",
  "KW": "KW",
  "C-KWT": "KW",
  "OMAN": "OM",
  "OM": "OM",
  "C-OMN": "OM",
  "BAHRAIN": "BH",
  "BH": "BH",
  "C-BAH": "BH"
};

/**
 * Returns the central document prefix for a given business document type.
 */
export function getDocumentPrefix(documentType: BusinessDocumentType | string): string {
  if (documentType in DOCUMENT_PREFIX_REGISTRY) {
    return DOCUMENT_PREFIX_REGISTRY[documentType as BusinessDocumentType];
  }
  const upper = (documentType || "").toUpperCase();
  if (upper.includes("PHARMACY") || upper.includes("PV")) return "PV";
  if (upper.includes("PHYSICIAN") || upper.includes("MEDICAL") || upper.includes("MV")) return "MV";
  if (upper.includes("ORDER") || upper.includes("SO")) return "SO";
  if (upper.includes("STOCK") || upper.includes("SR")) return "SR";
  if (upper.includes("SAMPLE") || upper.includes("SM")) return "SM";
  if (upper.includes("MARKETING") || upper.includes("MR")) return "MR";
  if (upper.includes("RECEIPT") || upper.includes("RC")) return "RC";
  if (upper.includes("PURCHASE") || upper.includes("PO")) return "PO";
  return upper.slice(0, 2) || "GEN";
}

/**
 * Resolves canonical 2-letter operational country code (e.g. LY, JO, EG, SA).
 * Strictly avoids representative name, area name, or free text guesses.
 */
export function resolveOperationalCountryCode(countryInput: any): string {
  if (!countryInput) return "LY";

  if (typeof countryInput === "string") {
    const trimmed = countryInput.trim().toUpperCase();
    if (OPERATIONAL_COUNTRY_CODES[trimmed]) {
      return OPERATIONAL_COUNTRY_CODES[trimmed];
    }
    // Check if path contains country identifier e.g. "LIBYA / WEST / TRIPOLI"
    const firstSegment = trimmed.split("/")[0].trim();
    if (OPERATIONAL_COUNTRY_CODES[firstSegment]) {
      return OPERATIONAL_COUNTRY_CODES[firstSegment];
    }
    // Check for 2-letter code
    if (/^[A-Z]{2}$/.test(trimmed)) {
      return trimmed;
    }
    return "LY";
  }

  if (typeof countryInput === "object") {
    const code = countryInput.code || countryInput.countryCode || countryInput.countryId || countryInput.country || countryInput.name;
    if (code) {
      return resolveOperationalCountryCode(code);
    }
  }

  return "LY";
}

/**
 * Validates whether a string matches enterprise business document number standard:
 * ^[A-Z]{2}-[A-Z]{2,3}-[0-9]{4}-[0-9]{6}$
 */
export function validateDisplayNumber(value: any): boolean {
  if (typeof value !== "string") return false;
  return /^[A-Z]{2}-[A-Z]{2,3}-[0-9]{4}-[0-9]{6}$/.test(value);
}

export interface BusinessSequenceOptions {
  countryInput: any;
  documentPrefix: string;
  year: number;
  userId?: string;
  dbInstance?: Firestore;
}

/**
 * Generates the next sequence number and formats the display number inside a Firestore transaction.
 * Uses atomic sequence counter document: businessDocumentSequences/{countryCode}_{documentPrefix}_{year}
 */
export async function generateNextDisplayNumberInTransaction(
  transaction: Transaction,
  options: BusinessSequenceOptions
): Promise<string> {
  const firestoreDb = options.dbInstance || db;
  const countryCode = resolveOperationalCountryCode(options.countryInput);
  const prefix = options.documentPrefix.toUpperCase();
  const year = options.year;
  const seqDocId = `${countryCode}_${prefix}_${year}`;
  const seqRef = doc(firestoreDb, "businessDocumentSequences", seqDocId);

  const seqSnap = await transaction.get(seqRef);
  let lastSequence = 0;
  if (seqSnap.exists()) {
    lastSequence = seqSnap.data().lastSequence || 0;
  }

  const nextSequence = lastSequence + 1;

  transaction.set(seqRef, {
    countryCode,
    documentPrefix: prefix,
    year,
    lastSequence: nextSequence,
    updatedAt: new Date().toISOString(),
    updatedByUid: options.userId || "SYSTEM"
  }, { merge: true });

  return formatBusinessDocumentNumber(countryCode, prefix, year, nextSequence);
}

export interface PreparedBusinessNumberState {
  existingDisplayNumber: string | null;
  seqRef: any;
  countryCode: string;
  documentPrefix: string;
  year: number;
  lastSequence: number;
  nextSequence: number;
  formattedDisplayNumber: string;
  shouldIncrementCounter: boolean;
  userId?: string;
}

export interface GetOrCreateDisplayNumberOptions {
  docRef?: any;
  existingData?: any;
  documentType: BusinessDocumentType;
  countryInput: any;
  dateOrYear?: string | number | Date;
  userId?: string;
  dbInstance?: Firestore;
}

export type ReadBusinessNumberOptions = GetOrCreateDisplayNumberOptions;

/**
 * PHASE A (READS ONLY): Reads target document and sequence counter inside a transaction.
 * Performs ONLY transaction.get() calls.
 */
export async function readBusinessNumberState(
  transaction: Transaction,
  options: ReadBusinessNumberOptions
): Promise<PreparedBusinessNumberState> {
  const firestoreDb = options.dbInstance || db;

  // 1. Check existingData object passed from memory/transaction
  if (options.existingData && options.existingData.displayNumber && validateDisplayNumber(options.existingData.displayNumber)) {
    const countryCode = resolveOperationalCountryCode(options.countryInput);
    const prefix = getDocumentPrefix(options.documentType);
    return {
      existingDisplayNumber: options.existingData.displayNumber,
      seqRef: null,
      countryCode,
      documentPrefix: prefix,
      year: new Date().getFullYear(),
      lastSequence: 0,
      nextSequence: 0,
      formattedDisplayNumber: options.existingData.displayNumber,
      shouldIncrementCounter: false,
      userId: options.userId
    };
  }

  // 2. Fetch docSnap inside transaction if docRef provided
  if (options.docRef) {
    const docSnap = await transaction.get(options.docRef);
    if (docSnap.exists()) {
      const data: any = docSnap.data();
      if (data && data.displayNumber && validateDisplayNumber(data.displayNumber)) {
        const countryCode = resolveOperationalCountryCode(options.countryInput);
        const prefix = getDocumentPrefix(options.documentType);
        return {
          existingDisplayNumber: data.displayNumber,
          seqRef: null,
          countryCode,
          documentPrefix: prefix,
          year: new Date().getFullYear(),
          lastSequence: 0,
          nextSequence: 0,
          formattedDisplayNumber: data.displayNumber,
          shouldIncrementCounter: false,
          userId: options.userId
        };
      }
    }
  }

  // 3. Resolve year from dateOrYear or current year
  let yearNum = new Date().getFullYear();
  if (options.dateOrYear) {
    if (typeof options.dateOrYear === "number") {
      yearNum = options.dateOrYear;
    } else if (typeof options.dateOrYear === "string") {
      const parsed = parseInt(options.dateOrYear.substring(0, 4), 10);
      if (!isNaN(parsed) && parsed > 2000 && parsed < 2100) {
        yearNum = parsed;
      }
    } else if (options.dateOrYear instanceof Date) {
      yearNum = options.dateOrYear.getFullYear();
    }
  }

  const countryCode = resolveOperationalCountryCode(options.countryInput);
  const prefix = getDocumentPrefix(options.documentType);
  const seqDocId = `${countryCode}_${prefix}_${yearNum}`;
  const seqRef = doc(firestoreDb, "businessDocumentSequences", seqDocId);

  // Read sequence counter document
  const seqSnap = await transaction.get(seqRef);
  let lastSequence = 0;
  if (seqSnap.exists()) {
    lastSequence = seqSnap.data().lastSequence || 0;
  }

  const nextSequence = lastSequence + 1;
  const formattedDisplayNumber = formatBusinessDocumentNumber(countryCode, prefix, yearNum, nextSequence);

  return {
    existingDisplayNumber: null,
    seqRef,
    countryCode,
    documentPrefix: prefix,
    year: yearNum,
    lastSequence,
    nextSequence,
    formattedDisplayNumber,
    shouldIncrementCounter: true,
    userId: options.userId
  };
}

/**
 * PHASE B (WRITES ONLY): Writes updated sequence counter to transaction if incrementing.
 * Performs NO transaction.get() calls.
 */
export function applyBusinessNumberWrites(
  transaction: Transaction,
  state: PreparedBusinessNumberState
): void {
  if (!state.shouldIncrementCounter || !state.seqRef) {
    return;
  }

  transaction.set(state.seqRef, {
    countryCode: state.countryCode,
    documentPrefix: state.documentPrefix,
    year: state.year,
    lastSequence: state.nextSequence,
    updatedAt: new Date().toISOString(),
    updatedByUid: state.userId || "SYSTEM"
  }, { merge: true });
}

/**
 * Idempotently gets or creates a displayNumber for a business document inside a Firestore transaction.
 * Delegates to readBusinessNumberState (Phase A) and applyBusinessNumberWrites (Phase B).
 */
export async function getOrCreateDisplayNumberInTransaction(
  transaction: Transaction,
  options: GetOrCreateDisplayNumberOptions
): Promise<string> {
  const prepared = await readBusinessNumberState(transaction, options);
  applyBusinessNumberWrites(transaction, prepared);
  return prepared.formattedDisplayNumber;
}

/**
 * Admin Backfill Service for assigning business display numbers to historical records missing displayNumber.
 */
export async function backfillHistoricalBusinessNumbers(options: {
  documentType: BusinessDocumentType;
  collectionName: string;
  batchSize?: number;
  dryRun?: boolean;
  adminUid: string;
  dbInstance?: Firestore;
}): Promise<{ processed: number; updated: number; skipped: number; errors: string[] }> {
  const firestoreDb = options.dbInstance || db;
  const batchLimit = options.batchSize || 100;
  const errors: string[] = [];
  let processed = 0;
  let updated = 0;
  let skipped = 0;

  try {
    const q = query(
      collection(firestoreDb, options.collectionName),
      where("status", "in", ["COMPLETED", "Completed", "SUBMITTED", "Submitted", "Delivered", "In Delivery"])
    );

    const snapshot = await getDocs(q);
    const unnumberedDocs = snapshot.docs.filter(docSnap => {
      const data = docSnap.data();
      return !data.displayNumber || !validateDisplayNumber(data.displayNumber);
    });

    const targetDocs = unnumberedDocs.slice(0, batchLimit);

    for (const docSnap of targetDocs) {
      processed++;
      const data = docSnap.data();
      const dateStr = data.completedAt || data.date || data.createdAt || new Date().toISOString();
      const yearNum = parseInt(dateStr.substring(0, 4), 10) || new Date().getFullYear();
      const countryInput = data.countryId || data.countryCode || data.countryName || data.pharmacySnapshot?.countryId || "LY";

      if (options.dryRun) {
        updated++;
        continue;
      }

      // Note: Full transactional backfill generates sequentially for each doc
      const batch = writeBatch(firestoreDb);
      const prefix = getDocumentPrefix(options.documentType);
      const countryCode = resolveOperationalCountryCode(countryInput);
      
      // Sequence fetch (for backfill execution)
      const seqDocId = `${countryCode}_${prefix}_${yearNum}`;
      const seqRef = doc(firestoreDb, "businessDocumentSequences", seqDocId);

      // Simple backfill sequence check
      const seqSnap = await getDocs(query(collection(firestoreDb, "businessDocumentSequences"), where("documentPrefix", "==", prefix)));
      const seqVal = seqSnap.size + processed;
      const displayNumber = formatBusinessDocumentNumber(countryCode, prefix, yearNum, seqVal);

      batch.update(docSnap.ref, {
        displayNumber,
        displayNumberBackfilled: true,
        displayNumberBackfilledAt: new Date().toISOString(),
        displayNumberBackfilledByUid: options.adminUid,
        displayNumberBackfillSource: "ADMIN_BACKFILL_SERVICE"
      });

      await batch.commit();
      updated++;
    }

    return { processed, updated, skipped, errors };
  } catch (err: any) {
    errors.push(err?.message || "Backfill failed");
    return { processed, updated, skipped, errors };
  }
}
