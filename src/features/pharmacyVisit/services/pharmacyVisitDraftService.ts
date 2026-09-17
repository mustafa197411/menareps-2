import { PharmacyVisitDraft, normalizeDraftGps } from "../types/domain";
import { sanitizeDraftOffers, sanitizeOfferDraftIntent } from "./canonicalOfferVisit";

const STORAGE_PREFIX = "menareps_pv_draft_v2_";

function getDraftStorageKey(repUid: string, draftId: string): string {
  return `${STORAGE_PREFIX}${repUid}_${draftId}`;
}

function getActiveDraftIndexKey(repUid: string): string {
  return `${STORAGE_PREFIX}index_${repUid}`;
}

export class PharmacyVisitDraftService {
  /**
   * Save draft locally (localStorage / IndexedDB wrapper)
   */
  public static async saveDraftLocally(draft: PharmacyVisitDraft): Promise<void> {
    try {
      const key = getDraftStorageKey(draft.repUid, draft.draftId);
      const serialized = JSON.stringify({
        ...draft,
        offers: undefined,
        offerIntent: sanitizeOfferDraftIntent(draft.offerIntent),
        updatedAt: new Date().toISOString(),
        localRevision: (draft.localRevision || 0) + 1
      });
      localStorage.setItem(key, serialized);

      // Maintain active drafts index for user
      const indexKey = getActiveDraftIndexKey(draft.repUid);
      const existingIndexRaw = localStorage.getItem(indexKey);
      let draftIds: string[] = existingIndexRaw ? JSON.parse(existingIndexRaw) : [];
      if (!draftIds.includes(draft.draftId)) {
        draftIds.push(draft.draftId);
        localStorage.setItem(indexKey, JSON.stringify(draftIds));
      }

      console.info("[PHARMACY_VISIT_DRAFT_JSON]", serialized);
    } catch (err) {
      console.warn("[PharmacyVisitDraftService] Local save draft warning:", err);
    }
  }

  /**
   * Load draft by repUid and draftId
   */
  public static async loadDraftLocally(repUid: string, draftId: string): Promise<PharmacyVisitDraft | null> {
    try {
      const key = getDraftStorageKey(repUid, draftId);
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as PharmacyVisitDraft & { offers?: unknown; offerIntent?: unknown };
      return normalizeDraftGps({ ...parsed, offers: undefined, offerIntent: sanitizeDraftOffers(parsed.offerIntent ?? parsed.offers) });
    } catch (err) {
      console.warn("[PharmacyVisitDraftService] Load draft error:", err);
      return null;
    }
  }

  /**
   * Find an existing active draft for a specific pharmacy and repUid
   */
  public static async findActiveDraftForPharmacy(repUid: string, pharmacyId: string): Promise<PharmacyVisitDraft | null> {
    try {
      const indexKey = getActiveDraftIndexKey(repUid);
      const existingIndexRaw = localStorage.getItem(indexKey);
      if (!existingIndexRaw) return null;
      const draftIds: string[] = JSON.parse(existingIndexRaw);

      for (const id of draftIds) {
        const draft = await this.loadDraftLocally(repUid, id);
        if (draft && draft.pharmacyId === pharmacyId && draft.status !== "COMPLETED" && draft.status !== "CANCELLED") {
          return draft;
        }
      }
      return null;
    } catch (err) {
      console.warn("[PharmacyVisitDraftService] Find active draft error:", err);
      return null;
    }
  }

  /**
   * Get all local active drafts for a repUid
   */
  public static async getAllLocalDrafts(repUid: string): Promise<PharmacyVisitDraft[]> {
    try {
      const indexKey = getActiveDraftIndexKey(repUid);
      const existingIndexRaw = localStorage.getItem(indexKey);
      if (!existingIndexRaw) return [];
      const draftIds: string[] = JSON.parse(existingIndexRaw);

      const drafts: PharmacyVisitDraft[] = [];
      for (const id of draftIds) {
        const draft = await this.loadDraftLocally(repUid, id);
        if (draft && draft.status !== "COMPLETED" && draft.status !== "CANCELLED") {
          drafts.push(draft);
        }
      }
      return drafts;
    } catch (err) {
      console.warn("[PharmacyVisitDraftService] Get all local drafts error:", err);
      return [];
    }
  }

  /**
   * Alias for saveDraftLocally
   */
  public static async saveDraft(draft: PharmacyVisitDraft): Promise<void> {
    return this.saveDraftLocally(draft);
  }

  /**
   * Alias for discardDraft
   */
  public static async deleteDraft(draftId: string, repUid?: string): Promise<void> {
    return this.discardDraft(repUid || "default_rep", draftId);
  }

  /**
   * Discard draft
   */
  public static async discardDraft(repUid: string, draftId: string): Promise<void> {
    try {
      const key = getDraftStorageKey(repUid, draftId);
      localStorage.removeItem(key);

      const indexKey = getActiveDraftIndexKey(repUid);
      const existingIndexRaw = localStorage.getItem(indexKey);
      if (existingIndexRaw) {
        let draftIds: string[] = JSON.parse(existingIndexRaw);
        draftIds = draftIds.filter(id => id !== draftId);
        localStorage.setItem(indexKey, JSON.stringify(draftIds));
      }
    } catch (err) {
      console.warn("[PharmacyVisitDraftService] Discard draft error:", err);
    }
  }
}
