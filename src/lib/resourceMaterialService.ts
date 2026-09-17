import { 
  doc, 
  setDoc, 
  getDoc, 
  collection, 
  getDocs, 
  query, 
  where, 
  deleteDoc 
} from "firebase/firestore";
import { 
  ref, 
  uploadBytesResumable, 
  deleteObject,
  uploadBytes
} from "firebase/storage";
import { db, storage } from "./firebase";
import { Role, Product, User, ProductPromotionGroup, UserProductAssignment } from "../types";
import { handleFirestoreError, OperationType } from "./firebaseError";
import { decorateRecord } from "./firebaseSync";
import { canManageAcademicResources } from "./canonicalPermissionApplicability";
import { getActiveCanonicalAssignmentsForUser, isProductAssignmentEffectiveAt } from "./productAssignmentService";

// ============================================================================
// CONSTANTS & TYPES
// ============================================================================

export enum ResourceScope {
  PROMOTION_GROUP = "PROMOTION_GROUP",
  SELECTED_PRODUCTS = "SELECTED_PRODUCTS"
}

/** Presentation-layer guard only; trusted backend mutation authorization remains authoritative. */
export function canShowResourceMutationControls(role: Role, scope: ResourceScope, canManage: boolean): boolean {
  return canManage && !(role === Role.PRODUCT_MANAGER && scope === ResourceScope.PROMOTION_GROUP);
}

export type UploadStatus = 
  | "PENDING"
  | "UPLOADING"
  | "PROCESSING"
  | "COMPLETE"
  | "FAILED"
  | "REPLACED"
  | "ARCHIVED";

export const CONTROLLED_RESOURCE_CATEGORIES = [
  "BROCHURE",
  "CLINICAL_STUDY",
  "SCIENTIFIC_ARTICLE",
  "VISUAL_AID",
  "PRODUCT_MONOGRAPH",
  "TRAINING_MATERIAL",
  "TECHNICAL_DOCUMENT",
  "PRESENTATION",
  "VIDEO",
  "IMAGE",
  "SAFETY_INFORMATION",
  "OTHER_APPROVED"
] as const;

export type ResourceCategory = typeof CONTROLLED_RESOURCE_CATEGORIES[number];

// File Size Limits in Bytes
export const RECOMMENDED_FILE_SIZE_LIMITS = {
  PDF: 50 * 1024 * 1024,        // 50 MB
  POWERPOINT: 75 * 1024 * 1024, // 75 MB
  WORD: 30 * 1024 * 1024,       // 30 MB
  IMAGE: 15 * 1024 * 1024,      // 15 MB
  VIDEO: 250 * 1024 * 1024      // 250 MB
};

export interface ApprovedFileTypeSpec {
  mimeType: string;
  extensions: string[];
  categoryKey: keyof typeof RECOMMENDED_FILE_SIZE_LIMITS;
  label: string;
  limitBytes: number;
}

export const APPROVED_FILE_TYPES: Record<string, ApprovedFileTypeSpec> = {
  "application/pdf": {
    mimeType: "application/pdf",
    extensions: ["pdf"],
    categoryKey: "PDF",
    label: "PDF Document",
    limitBytes: RECOMMENDED_FILE_SIZE_LIMITS.PDF
  },
  "application/vnd.ms-powerpoint": {
    mimeType: "application/vnd.ms-powerpoint",
    extensions: ["ppt"],
    categoryKey: "POWERPOINT",
    label: "PowerPoint Presentation (.ppt)",
    limitBytes: RECOMMENDED_FILE_SIZE_LIMITS.POWERPOINT
  },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": {
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    extensions: ["pptx"],
    categoryKey: "POWERPOINT",
    label: "PowerPoint Presentation (.pptx)",
    limitBytes: RECOMMENDED_FILE_SIZE_LIMITS.POWERPOINT
  },
  "application/msword": {
    mimeType: "application/msword",
    extensions: ["doc"],
    categoryKey: "WORD",
    label: "Word Document (.doc)",
    limitBytes: RECOMMENDED_FILE_SIZE_LIMITS.WORD
  },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extensions: ["docx"],
    categoryKey: "WORD",
    label: "Word Document (.docx)",
    limitBytes: RECOMMENDED_FILE_SIZE_LIMITS.WORD
  },
  "image/jpeg": {
    mimeType: "image/jpeg",
    extensions: ["jpg", "jpeg"],
    categoryKey: "IMAGE",
    label: "JPEG Image",
    limitBytes: RECOMMENDED_FILE_SIZE_LIMITS.IMAGE
  },
  "image/png": {
    mimeType: "image/png",
    extensions: ["png"],
    categoryKey: "IMAGE",
    label: "PNG Image",
    limitBytes: RECOMMENDED_FILE_SIZE_LIMITS.IMAGE
  },
  "image/webp": {
    mimeType: "image/webp",
    extensions: ["webp"],
    categoryKey: "IMAGE",
    label: "WebP Image",
    limitBytes: RECOMMENDED_FILE_SIZE_LIMITS.IMAGE
  },
  "video/mp4": {
    mimeType: "video/mp4",
    extensions: ["mp4"],
    categoryKey: "VIDEO",
    label: "MP4 Video",
    limitBytes: RECOMMENDED_FILE_SIZE_LIMITS.VIDEO
  },
  "video/webm": {
    mimeType: "video/webm",
    extensions: ["webm"],
    categoryKey: "VIDEO",
    label: "WebM Video",
    limitBytes: RECOMMENDED_FILE_SIZE_LIMITS.VIDEO
  }
};

export interface FileValidationResult {
  valid: boolean;
  error?: string;
  fileExtension?: string;
  mimeType?: string;
  limitBytes?: number;
  formattedLimit?: string;
  fileSizeBytes?: number;
  formattedSize?: string;
}

export interface UploadProgress {
  percentage: number;
  bytesTransferred: number;
  totalBytes: number;
  status: UploadStatus;
  error?: string;
}

export interface AcademicResourceMetadata {
  resourceId: string;
  titleEn: string;
  titleAr: string;
  category: string;
  promotionGroupId: string;
  resourceScope: ResourceScope;
  productIds: string[];
  specialtyIds: string[];
  therapeuticAreaId?: string;
  therapeuticArea?: string;
  language: string;
  fileName: string;
  originalFileName: string;
  sanitizedFileName: string;
  fileExtension: string;
  mimeType: string;
  fileSizeBytes: number;
  storagePath: string;
  downloadUrl?: string;
  fileVersion: number;
  checksum?: string;
  uploadStatus: UploadStatus;
  approvalStatus?: "DRAFT" | "UNDER_REVIEW" | "APPROVED" | "PUBLISHED" | "ARCHIVED" | "REJECTED";
  active: boolean;
  effectiveDate?: string;
  expiryDate?: string;
  uploadedByUid: string;
  uploadedAt: string;
  updatedByUid: string;
  updatedAt: string;
  
  // Snapshots for quick display
  title?: string;
  brand?: string;
  promotionGroupName?: string;
  productNames?: string[];
  specialtyNames?: string[];
  size?: string;
  type?: string;
  isDeleted?: boolean;
}

// ============================================================================
// AUTHORIZATION & VALIDATION HELPERS
// ============================================================================

export function canUserManageResources(currentUser?: User, permissions?: { active?: boolean; resourceCapabilities?: { manage?: boolean } }): boolean {
  return Boolean(currentUser && currentUser.active !== false && currentUser.loginAllowed !== false &&
    permissions?.active !== false && canManageAcademicResources(currentUser.role, permissions));
}

/** Client authoring catalog only; trusted backend authorization remains mandatory. */
export function resolveResourceAuthoringProducts(input: {
  currentUser: User;
  products: Product[];
  assignments: UserProductAssignment[];
  asOf?: Date;
}): Product[] {
  if (input.currentUser.role !== Role.PRODUCT_MANAGER) return input.products;
  const report = getActiveCanonicalAssignmentsForUser({ assignments: input.assignments, userId: input.currentUser.id, products: input.products });
  const effectiveIds = new Set(report.assignments
    .filter(assignment => isProductAssignmentEffectiveAt(assignment, input.asOf || new Date()))
    .map(assignment => assignment.productId));
  return input.products.filter(product => effectiveIds.has(product.id) && (product as Product & { active?: boolean }).active !== false && product.isActive !== false);
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export function sanitizeFileName(originalName: string): string {
  if (!originalName) return "unnamed-file";
  const parts = originalName.split(".");
  const ext = parts.length > 1 ? parts.pop()! : "";
  const base = parts.join(".");
  const sanitizedBase = base
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\-_]/g, "-")
    .replace(/-+/g, "-");
  return ext ? `${sanitizedBase}.${ext.toLowerCase()}` : sanitizedBase;
}

export function validateResourceFile(file: File): FileValidationResult {
  if (!file) {
    return { valid: false, error: "No file selected." };
  }

  const fileSizeBytes = file.size;
  const formattedSize = formatFileSize(fileSizeBytes);
  const originalName = file.name;
  const parts = originalName.split(".");
  const fileExtension = (parts.length > 1 ? parts.pop()! : "").toLowerCase();

  if (!fileExtension) {
    return { valid: false, error: "Selected file has no file extension." };
  }

  // 1. Check if MIME type is recognized
  const spec = APPROVED_FILE_TYPES[file.type];
  
  // 2. Fallback check by extension if mimeType is generic like octet-stream
  let matchedSpec: ApprovedFileTypeSpec | undefined = spec;
  if (!matchedSpec) {
    matchedSpec = Object.values(APPROVED_FILE_TYPES).find(s => s.extensions.includes(fileExtension));
  }

  if (!matchedSpec) {
    return {
      valid: false,
      error: `Unsupported file format (${file.type || fileExtension}). Allowed types: PDF, PowerPoint (PPT/PPTX), Word (DOC/DOCX), Images (JPEG/PNG/WEBP), Videos (MP4/WEBM).`,
      fileExtension,
      fileSizeBytes,
      formattedSize
    };
  }

  // 3. Extension & MIME mismatch check
  if (!matchedSpec.extensions.includes(fileExtension)) {
    return {
      valid: false,
      error: `File extension (.${fileExtension}) does not match the detected MIME type (${file.type}).`,
      fileExtension,
      mimeType: file.type,
      fileSizeBytes,
      formattedSize
    };
  }

  // 4. File size limit check
  const formattedLimit = formatFileSize(matchedSpec.limitBytes);
  if (fileSizeBytes > matchedSpec.limitBytes) {
    return {
      valid: false,
      error: `File size (${formattedSize}) exceeds the maximum allowed limit of ${formattedLimit} for ${matchedSpec.label}.`,
      fileExtension,
      mimeType: matchedSpec.mimeType,
      limitBytes: matchedSpec.limitBytes,
      formattedLimit,
      fileSizeBytes,
      formattedSize
    };
  }

  return {
    valid: true,
    fileExtension,
    mimeType: matchedSpec.mimeType,
    limitBytes: matchedSpec.limitBytes,
    formattedLimit,
    fileSizeBytes,
    formattedSize
  };
}

// ============================================================================
// CASCADE & SCOPE RESOLUTION
// ============================================================================

export function resolveEligibleProductsForPromotionGroup(
  promotionGroupId: string,
  allProducts: Product[] = []
): Product[] {
  if (!promotionGroupId) return [];
  const cleanPgId = promotionGroupId.trim().toLowerCase();
  
  return allProducts.filter((p) => {
    if (p.isActive === false) return false;
    const prodPgId = (p.promotionGroupId || "").trim().toLowerCase();
    const prodBrand = (p.brand || "").trim().toLowerCase();
    return prodPgId === cleanPgId || prodBrand === cleanPgId || prodPgId.replace(/[^a-z0-9]/g, "") === cleanPgId.replace(/[^a-z0-9]/g, "");
  });
}

export function resolveTherapeuticAreaForPromotionGroup(
  promotionGroupId: string,
  promotionGroups: ProductPromotionGroup[] = [],
  products: Product[] = []
): string {
  if (!promotionGroupId) return "General Therapeutics";
  
  const cleanPgId = promotionGroupId.trim().toLowerCase();
  
  // 1. Check selected Promotion Group metadata
  const pgObj = promotionGroups.find(
    (g) => g.id.trim().toLowerCase() === cleanPgId || (g.name && g.name.trim().toLowerCase() === cleanPgId)
  );
  if (pgObj && (pgObj as any).therapeuticArea && (pgObj as any).therapeuticArea.trim()) {
    return (pgObj as any).therapeuticArea.trim();
  }
  
  // 2. Check products mapped to selected Promotion Group
  const eligibleProds = resolveEligibleProductsForPromotionGroup(promotionGroupId, products);
  const prodWithTa = eligibleProds.find((p) => p.therapeuticArea && p.therapeuticArea.trim());
  if (prodWithTa && prodWithTa.therapeuticArea.trim()) {
    return prodWithTa.therapeuticArea.trim();
  }
  
  // Direct check on products if cascade resolution didn't catch it
  const directProdWithTa = products.find((p) => {
    const pPgId = (p.promotionGroupId || "").trim().toLowerCase();
    const pBrand = (p.brand || "").trim().toLowerCase();
    return (pPgId === cleanPgId || pBrand === cleanPgId) && p.therapeuticArea && p.therapeuticArea.trim();
  });
  if (directProdWithTa && directProdWithTa.therapeuticArea.trim()) {
    return directProdWithTa.therapeuticArea.trim();
  }

  // 3. Fallback
  return "General Therapeutics";
}

export function mapStorageErrorToUserMessage(err: any): string {
  if (!err) return "File upload failed. Please retry or contact the administrator if the problem continues.";
  
  const code = err.code || "";
  const msg = err.message || String(err);

  if (code === "storage/unauthorized" || msg.includes("unauthorized")) {
    return "Permission denied. You do not have authorization to upload resource materials.";
  }
  if (code === "storage/bucket-not-found" || code === "storage/project-not-found" || msg.includes("404") || code === "storage/unknown") {
    return "Storage service or bucket unavailable. Please check Firebase Storage configuration or contact administrator.";
  }
  if (code === "storage/retry-limit-exceeded" || msg.includes("timeout") || msg.includes("RESOURCE_UPLOAD_TIMEOUT") || msg.includes("network")) {
    return "Network connection timed out or interrupted during upload. Please check your internet connection and try again.";
  }
  if (code === "storage/canceled") {
    return "File upload was canceled.";
  }
  if (code === "storage/invalid-argument") {
    return "Invalid file or storage arguments provided.";
  }

  return "File upload failed. Please retry or contact the administrator if the problem continues.";
}

export function validateProductCascade(
  promotionGroupId: string,
  selectedProductIds: string[],
  allProducts: Product[] = []
): { valid: boolean; invalidProductIds: string[] } {
  if (!selectedProductIds || selectedProductIds.length === 0) {
    return { valid: true, invalidProductIds: [] };
  }

  const eligibleProducts = resolveEligibleProductsForPromotionGroup(promotionGroupId, allProducts);
  const eligibleProductIds = new Set(eligibleProducts.map((p) => p.id));

  const invalidProductIds = selectedProductIds.filter((id) => !eligibleProductIds.has(id));

  return {
    valid: invalidProductIds.length === 0,
    invalidProductIds
  };
}

export function validateDates(effectiveDate?: string, expiryDate?: string): { valid: boolean; error?: string } {
  if (effectiveDate && expiryDate) {
    const start = new Date(effectiveDate).getTime();
    const end = new Date(expiryDate).getTime();
    if (isNaN(start) || isNaN(end)) {
      return { valid: false, error: "Invalid date format provided." };
    }
    if (end < start) {
      return { valid: false, error: "Expiry date must be later than or equal to the effective date." };
    }
  }
  return { valid: true };
}

// ============================================================================
// STORAGE & FIRESTORE OPERATIONS
// ============================================================================

export function getResourceStoragePath(
  promotionGroupId: string,
  resourceId: string,
  version: number,
  sanitizedFileName: string
): string {
  const cleanPgId = (promotionGroupId || "unassigned").trim().replace(/[^a-zA-Z0-9\-_]/g, "_");
  const cleanResId = (resourceId || "RES-000").trim().replace(/[^a-zA-Z0-9\-_]/g, "_");
  const ver = Math.max(1, version || 1);
  return `resources/${cleanPgId}/${cleanResId}/v${ver}/${sanitizedFileName}`;
}

export async function cleanupOrphanedUpload(storagePath: string): Promise<void> {
  if (!storagePath) return;
  try {
    const fileRef = ref(storage, storagePath);
    await deleteObject(fileRef);
    console.info(`[resourceMaterialService] Successfully cleaned up orphaned storage file: ${storagePath}`);
  } catch (err) {
    console.warn(`[resourceMaterialService] Diagnostic: Failed to delete orphaned file ${storagePath}:`, err);
  }
}

export type ResourceCreationDependencies = {
  upload: () => Promise<{ storagePath: string }>;
  persist: (storagePath: string) => Promise<void>;
  removeNewObject: (storagePath: string) => Promise<void>;
};

/** Coordinates the two halves of creation without ever deleting a pre-existing object. */
export async function commitAcademicResourceCreation(deps: ResourceCreationDependencies): Promise<{ storagePath: string }> {
  let newlyCreatedPath = "";
  try {
    const uploaded = await deps.upload();
    newlyCreatedPath = uploaded.storagePath;
    if (!newlyCreatedPath) throw new Error("RESOURCE_UPLOAD_PATH_MISSING");
    await deps.persist(newlyCreatedPath);
    return { storagePath: newlyCreatedPath };
  } catch (error) {
    if (newlyCreatedPath) await deps.removeNewObject(newlyCreatedPath);
    throw error;
  }
}

export async function uploadResourceFile(
  file: File,
  promotionGroupId: string,
  resourceId: string,
  version: number,
  onProgress?: (progress: UploadProgress) => void
): Promise<{
  storagePath: string;
  downloadUrl: string;
  sanitizedFileName: string;
  fileExtension: string;
  mimeType: string;
  fileSizeBytes: number;
}> {
  // PART 2: Structured Diagnostics - Start
  console.info("[RESOURCE_UPLOAD_DIAGNOSTIC] File Selected:", {
    fileName: file.name,
    fileSizeBytes: file.size,
    mimeType: file.type
  });

  const validation = validateResourceFile(file);
  if (!validation.valid) {
    const valErr = validation.error || "File validation failed.";
    console.error("[RESOURCE_UPLOAD_DIAGNOSTIC] File Validation Failed:", valErr);
    throw new Error(valErr);
  }

  const sanitizedFileName = sanitizeFileName(file.name);
  const storagePath = getResourceStoragePath(promotionGroupId, resourceId, version, sanitizedFileName);
  const fileRef = ref(storage, storagePath);

  const bucketName = storage.app.options.storageBucket || "unknown-bucket";
  console.info("[RESOURCE_UPLOAD_DIAGNOSTIC] Target Specs:", {
    promotionGroupId,
    resourceId,
    version,
    storagePath,
    bucketName,
    sanitizedFileName
  });

  if (onProgress) {
    onProgress({
      percentage: 0,
      bytesTransferred: 0,
      totalBytes: file.size,
      status: "UPLOADING"
    });
  }

  let downloadUrl = "";
  const STALL_TIMEOUT_MS = 30000;  // 30 seconds no progress
  const TOTAL_TIMEOUT_MS = 90000;  // 90 seconds total timeout

  try {
    const uploadTask = uploadBytesResumable(fileRef, file, {
      contentType: validation.mimeType
    });

    console.info("[RESOURCE_UPLOAD_DIAGNOSTIC] uploadBytesResumable Task Started");

    await new Promise<void>((resolve, reject) => {
      let lastBytesTransferred = -1;
      let stallTimer: NodeJS.Timeout | null = null;
      let totalTimer: NodeJS.Timeout | null = null;

      const resetStallTimer = () => {
        if (stallTimer) clearTimeout(stallTimer);
        stallTimer = setTimeout(() => {
          console.warn("[RESOURCE_UPLOAD_DIAGNOSTIC] Upload STALLED: No progress for 30s");
          if (onProgress) {
            onProgress({
              percentage: lastBytesTransferred > 0 ? Math.round((lastBytesTransferred / file.size) * 100) : 0,
              bytesTransferred: Math.max(0, lastBytesTransferred),
              totalBytes: file.size,
              status: "UPLOADING",
              error: "Upload stalled... retrying connection"
            });
          }
        }, STALL_TIMEOUT_MS);
      };

      totalTimer = setTimeout(() => {
        if (stallTimer) clearTimeout(stallTimer);
        console.error("[RESOURCE_UPLOAD_TIMEOUT] Upload exceeded 90s total limit");
        try {
          uploadTask.cancel();
        } catch (e) {
          /* ignore cancel error */
        }
        reject(new Error("RESOURCE_UPLOAD_TIMEOUT"));
      }, TOTAL_TIMEOUT_MS);

      resetStallTimer();

      uploadTask.on(
        "state_changed",
        (snapshot) => {
          resetStallTimer();
          lastBytesTransferred = snapshot.bytesTransferred;
          const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
          
          console.info(`[RESOURCE_UPLOAD_DIAGNOSTIC] Progress Event: ${pct}% (${snapshot.bytesTransferred}/${snapshot.totalBytes} bytes, state: ${snapshot.state})`);

          if (onProgress) {
            onProgress({
              percentage: pct,
              bytesTransferred: snapshot.bytesTransferred,
              totalBytes: snapshot.totalBytes,
              status: "UPLOADING"
            });
          }
        },
        (error) => {
          if (stallTimer) clearTimeout(stallTimer);
          if (totalTimer) clearTimeout(totalTimer);
          console.error("[RESOURCE_UPLOAD_DIAGNOSTIC] Upload Task Error Callback:", {
            code: error.code,
            message: error.message,
            customData: error.customData
          });
          reject(error);
        },
        () => {
          if (stallTimer) clearTimeout(stallTimer);
          if (totalTimer) clearTimeout(totalTimer);
          console.info("[RESOURCE_UPLOAD_DIAGNOSTIC] Upload Task Reached Completion Event");
          resolve();
        }
      );
    });

    // Durable download URLs are intentionally not minted; reads use backend authorization.

    if (onProgress) {
      onProgress({
        percentage: 100,
        bytesTransferred: file.size,
        totalBytes: file.size,
        status: "COMPLETE"
      });
    }

    return {
      storagePath,
      downloadUrl,
      sanitizedFileName,
      fileExtension: validation.fileExtension!,
      mimeType: validation.mimeType!,
      fileSizeBytes: file.size
    };
  } catch (err: any) {
    const mappedUserMsg = mapStorageErrorToUserMessage(err);
    console.error("[RESOURCE_UPLOAD_DIAGNOSTIC] Upload Failed:", {
      originalError: err,
      mappedUserMsg
    });

    if (onProgress) {
      onProgress({
        percentage: 0,
        bytesTransferred: 0,
        totalBytes: file.size,
        status: "FAILED",
        error: mappedUserMsg
      });
    }
    throw new Error(mappedUserMsg);
  }
}

export async function saveResourceMetadata(
  metadata: AcademicResourceMetadata
): Promise<void> {
  const docRef = doc(db, "academicResources", metadata.resourceId);
  const decorated = decorateRecord(
    metadata,
    metadata.uploadedByUid || "system",
    metadata.fileVersion > 1 ? "update" : "create"
  );
  await setDoc(docRef, decorated, { merge: true });
}

export async function deactivateResource(
  resourceId: string,
  userUid: string
): Promise<void> {
  const docRef = doc(db, "academicResources", resourceId);
  const now = new Date().toISOString();
  await setDoc(
    docRef,
    {
      active: false,
      updatedByUid: userUid,
      updatedAt: now,
      uploadStatus: "ARCHIVED"
    },
    { merge: true }
  );
}
