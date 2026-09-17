import { collection, doc, setDoc, updateDoc, serverTimestamp, DocumentReference } from "firebase/firestore";
import { db, auth } from "./firebase";
import { handleFirestoreError, OperationType } from "./firebaseError";

export type CloseReason =
  | "DISMISS_BUTTON"
  | "CLOSE_ICON"
  | "MATERIAL_SWITCH"
  | "NAVIGATION_AWAY"
  | "COMPONENT_UNMOUNT"
  | "PAGE_HIDE"
  | "VISIT_CANCELLED"
  | "UNKNOWN";

export type PageExitReason =
  | "PAGE_CHANGE"
  | "MATERIAL_CLOSED"
  | "MATERIAL_SWITCH"
  | "NAVIGATION_AWAY"
  | "COMPONENT_UNMOUNT"
  | "PAGE_HIDE"
  | "VISIT_CANCELLED"
  | "UNKNOWN";

export type VisitStage =
  | "VISIT_SETUP"
  | "PRODUCT_DETAILING"
  | "SAMPLES"
  | "MARKETING_REQUEST"
  | "VISIT_SUMMARY"
  | "FOLLOW_UP"
  | "UNKNOWN";

export interface OpenDetailingMaterialInput {
  visitId: string;
  physicianId: string;
  productId: string;
  promotionGroupId?: string;
  materialId: string;
  materialName?: string;
  visitStage?: VisitStage;
  initialPage?: number;
  totalPages?: number;
}

export interface CloseDetailingMaterialOptions {
  lastPageViewed?: number;
  totalPages?: number;
  closeReason?: CloseReason;
}

export interface DetailingMaterialUsageSession {
  usageDocId: string;
  startTimeMs: number;
  firstCloseReason: CloseReason | null;
  updatePage: (page: number, total?: number) => void;
  closeSession: (options?: CloseDetailingMaterialOptions) => Promise<void>;
}

export function mapCloseReasonToPageExitReason(reason?: CloseReason | string): PageExitReason {
  switch (reason) {
    case "DISMISS_BUTTON":
    case "CLOSE_ICON":
    case "MATERIAL_CLOSED":
      return "MATERIAL_CLOSED";
    case "MATERIAL_SWITCH":
      return "MATERIAL_SWITCH";
    case "NAVIGATION_AWAY":
      return "NAVIGATION_AWAY";
    case "COMPONENT_UNMOUNT":
      return "COMPONENT_UNMOUNT";
    case "PAGE_HIDE":
      return "PAGE_HIDE";
    case "VISIT_CANCELLED":
      return "VISIT_CANCELLED";
    case "PAGE_CHANGE":
      return "PAGE_CHANGE";
    default:
      return "UNKNOWN";
  }
}

/**
 * Creates a new tracking document in `detailingMaterialUsage` when a representative
 * opens a detailing material or brochure, and automatically manages page-level session
 * analytics in `detailingPageAnalytics` (WP-DA2).
 */
export async function openDetailingMaterialSession(
  input: OpenDetailingMaterialInput
): Promise<DetailingMaterialUsageSession | null> {
  const representativeUid = auth.currentUser?.uid;
  if (!representativeUid) {
    console.warn("[detailingUsage] No Firebase Auth UID available for tracking. Proceeding silently.");
    return {
      usageDocId: "NOOP_SESSION",
      startTimeMs: Date.now(),
      get firstCloseReason() { return null; },
      updatePage: () => {},
      closeSession: async () => {},
    };
  }

  // Diagnostic check if visitId is missing
  if (!input.visitId || !input.visitId.trim()) {
    console.warn(
      "[detailingUsage] Development diagnostic: Brochure opened without an active or draft visit ID. Skipping Firestore tracking."
    );
    return {
      usageDocId: "NOOP_SESSION",
      startTimeMs: Date.now(),
      get firstCloseReason() { return null; },
      updatePage: () => {},
      closeSession: async () => {},
    };
  }

  // Resolve Promotion Group ID from canonical product or input
  const resolvedPromotionGroupId = input.promotionGroupId?.trim() || "";
  if (!resolvedPromotionGroupId) {
    console.warn(
      `[detailingUsage] Development diagnostic: Product (${input.productId}) has no valid promotionGroupId assigned.`
    );
  }

  const usageRef = doc(collection(db, "detailingMaterialUsage"));
  const usageDocId = usageRef.id;
  const startTimeMs = Date.now();

  const visitStage: VisitStage = input.visitStage || "PRODUCT_DETAILING";
  let currentPage = input.initialPage ?? 1;
  let totalPages = input.totalPages ?? 1;
  let highestPageViewed = currentPage;
  const pageSequence: number[] = [currentPage];

  const openData: Record<string, any> = {
    visitId: input.visitId,
    physicianId: input.physicianId || "UNSPECIFIED_PHYSICIAN",
    representativeUid,
    productId: input.productId || "UNSPECIFIED_PRODUCT",
    materialId: input.materialId || "UNSPECIFIED_MATERIAL",
    ...(input.materialName ? { materialName: input.materialName } : {}),
    ...(resolvedPromotionGroupId ? { promotionGroupId: resolvedPromotionGroupId } : {}),
    visitStage,
    lastPageViewed: currentPage,
    highestPageViewed: highestPageViewed,
    totalPages: totalPages,
    pageSequence: [...pageSequence],
    openedAt: serverTimestamp(),
    closedAt: null,
    durationSeconds: 0,
    status: "OPEN" as const,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(usageRef, openData);
  } catch (error) {
    console.warn("[detailingUsage] Failed to create open usage record (non-blocking):", error);
    try {
      handleFirestoreError(error, OperationType.WRITE, `detailingMaterialUsage/${usageDocId}`);
    } catch {
      // Non-blocking catch to ensure UI never freezes
    }
  }

  // =========================================================================
  // WP-DA2: Page Analytics Tracking State & Helpers
  // =========================================================================
  let pageVisitIndexCounter = 1;
  let activePageRef: DocumentReference | null = null;
  let activePageDocId: string | null = null;
  let activePageStartTimeMs = Date.now();
  let activePageNumber = currentPage;
  let activePageClosed = false;

  const startPageAnalyticsSession = async (pageNum: number, visitIndex: number) => {
    const pageRef = doc(collection(db, "detailingPageAnalytics"));
    activePageRef = pageRef;
    activePageDocId = pageRef.id;
    activePageStartTimeMs = Date.now();
    activePageNumber = pageNum;
    activePageClosed = false;

    const pageData = {
      usageSessionId: usageDocId,
      visitId: input.visitId,
      physicianId: input.physicianId || "UNSPECIFIED_PHYSICIAN",
      representativeUid,
      productId: input.productId || "UNSPECIFIED_PRODUCT",
      promotionGroupId: resolvedPromotionGroupId,
      materialId: input.materialId || "UNSPECIFIED_MATERIAL",
      pageNumber: pageNum,
      pageVisitIndex: visitIndex,
      enteredAt: serverTimestamp(),
      exitedAt: null,
      durationSeconds: 0,
      exitReason: "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    try {
      await setDoc(pageRef, pageData);
    } catch (error) {
      console.warn("[detailingPageAnalytics] Failed to create page session (non-blocking):", error);
      try {
        handleFirestoreError(error, OperationType.WRITE, `detailingPageAnalytics/${pageRef.id}`);
      } catch {
        // Safe non-blocking catch
      }
    }
  };

  const closeActivePageSession = async (pageExitReason: PageExitReason) => {
    if (!activePageRef || activePageClosed) return;
    activePageClosed = true;

    const endTimeMs = Date.now();
    const durationSeconds = Math.max(0, Math.round((endTimeMs - activePageStartTimeMs) / 1000));

    try {
      await updateDoc(activePageRef, {
        exitedAt: serverTimestamp(),
        durationSeconds,
        exitReason: pageExitReason,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.warn("[detailingPageAnalytics] Failed to close page session (non-blocking):", error);
      try {
        handleFirestoreError(error, OperationType.UPDATE, `detailingPageAnalytics/${activePageDocId}`);
      } catch {
        // Safe non-blocking catch
      }
    }
  };

  // Start the first page session automatically on brochure open (Page 1, Index 1)
  startPageAnalyticsSession(currentPage, 1);

  let hasClosed = false;
  let firstCloseReason: CloseReason | null = null;

  const updatePage = (page: number, total?: number) => {
    if (hasClosed) return;

    if (total !== undefined && total > 0) {
      totalPages = total;
    }

    if (page > highestPageViewed) {
      highestPageViewed = page;
    }

    if (pageSequence.length === 0 || pageSequence[pageSequence.length - 1] !== page) {
      pageSequence.push(page);
    }

    if (page !== activePageNumber) {
      // Close active page session with PAGE_CHANGE reason
      closeActivePageSession("PAGE_CHANGE");
      // Increment global pageVisitIndex counter
      pageVisitIndexCounter += 1;
      // Start NEW page session for the new page
      startPageAnalyticsSession(page, pageVisitIndexCounter);
    }

    currentPage = page;
  };

  const closeSession = async (options?: CloseDetailingMaterialOptions) => {
    if (hasClosed) {
      // Do not overwrite original closeReason or re-trigger close updates
      return;
    }
    hasClosed = true;

    const closeReason: CloseReason = options?.closeReason || "UNKNOWN";
    firstCloseReason = closeReason;

    const finalLastPage = options?.lastPageViewed ?? currentPage;
    const finalTotalPages = options?.totalPages ?? totalPages;

    if (finalLastPage > highestPageViewed) {
      highestPageViewed = finalLastPage;
    }
    if (pageSequence.length === 0 || pageSequence[pageSequence.length - 1] !== finalLastPage) {
      pageSequence.push(finalLastPage);
    }

    // Close active page session with mapped exitReason
    const pageExitReason = mapCloseReasonToPageExitReason(closeReason);
    await closeActivePageSession(pageExitReason);

    const endTimeMs = Date.now();
    const durationSeconds = Math.max(0, Math.round((endTimeMs - startTimeMs) / 1000));

    try {
      await updateDoc(usageRef, {
        status: "CLOSED",
        closedAt: serverTimestamp(),
        durationSeconds,
        lastPageViewed: finalLastPage,
        highestPageViewed,
        totalPages: finalTotalPages,
        pageSequence: [...pageSequence],
        closeReason: closeReason,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.warn("[detailingUsage] Failed to close usage record (non-blocking):", error);
      try {
        handleFirestoreError(error, OperationType.UPDATE, `detailingMaterialUsage/${usageDocId}`);
      } catch {
        // Non-blocking catch
      }
    }
  };

  return {
    usageDocId,
    startTimeMs,
    get firstCloseReason() {
      return firstCloseReason;
    },
    updatePage,
    closeSession,
  };
}

