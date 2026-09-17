import { 
  collection, 
  doc, 
  setDoc, 
  getDocs, 
  onSnapshot,
  writeBatch
} from "firebase/firestore";
import { useState, useEffect } from "react";
import { db, auth } from "../lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { PhysicianSpecialty } from "../types";

// Reusable status and state types
export type SpecialtyStatus = "loading" | "loaded" | "empty" | "permission-denied" | "network-error";

export interface SpecialtyRegistryState {
  specialties: PhysicianSpecialty[];
  loading: boolean;
  status: SpecialtyStatus;
  errorMessage: string | null;
}

// Approved 31-specialty bilingual list
export const APPROVED_31_SPECIALTIES: Omit<PhysicianSpecialty, 'createdAt' | 'createdBy' | 'source'>[] = [
  {
    id: "allergy-clinical-immunology",
    name: "Allergy & Clinical Immunology",
    nameAr: "الحساسية والمناعة السريرية",
    normalizedName: "ALLERGY CLINICAL IMMUNOLOGY",
    aliases: ["ALLERGY AND CLINICAL IMMUNOLOGY", "CLINICAL IMMUNOLOGY", "ALLERGY"],
    isActive: true
  },
  {
    id: "anesthesiology",
    name: "Anesthesiology",
    nameAr: "التخدير",
    normalizedName: "ANESTHESIOLOGY",
    aliases: ["ANESTHESIOLOGIST", "ANESTHETIC"],
    isActive: true
  },
  {
    id: "cardiology",
    name: "Cardiology",
    nameAr: "أمراض القلب",
    normalizedName: "CARDIOLOGY",
    aliases: ["CARDIOLOGIST", "HEART SPECIALIST", "CARDILOGY"],
    isActive: true
  },
  {
    id: "critical-care-medicine",
    name: "Critical Care Medicine",
    nameAr: "العناية المركزة",
    normalizedName: "CRITICAL CARE MEDICINE",
    aliases: ["CRITICAL CARE", "INTENSIVE CARE MEDICINE"],
    isActive: true
  },
  {
    id: "dermatology",
    name: "Dermatology",
    nameAr: "الأمراض الجلدية",
    normalizedName: "DERMATOLOGY",
    aliases: ["DERMATOLOGIST", "SKIN SPECIALIST", "DERMA"],
    isActive: true
  },
  {
    id: "diabetes-endocrinology",
    name: "Diabetes & Endocrinology",
    nameAr: "الغدد الصماء والسكري",
    normalizedName: "DIABETES ENDOCRINOLOGY",
    aliases: ["ENDOCRINOLOGY", "DIABETES", "ENDOCRINOLOGY & DIABETES"],
    isActive: true
  },
  {
    id: "emergency-medicine",
    name: "Emergency Medicine",
    nameAr: "طب الطوارئ",
    normalizedName: "EMERGENCY MEDICINE",
    aliases: ["EMERGENCY PHYSICIAN", "ER SPECIALIST", "EMERGENCY"],
    isActive: true
  },
  {
    id: "family-medicine",
    name: "Family Medicine",
    nameAr: "طب الأسرة",
    normalizedName: "FAMILY MEDICINE",
    aliases: ["FAMILY PRACTITIONER", "FAMILY PHYSICIAN"],
    isActive: true
  },
  {
    id: "gastroenterology",
    name: "Gastroenterology",
    nameAr: "أمراض الجهاز الهضمي",
    normalizedName: "GASTROENTEROLOGY",
    aliases: ["GASTROENTEROLOGIST", "GASTRO"],
    isActive: true
  },
  {
    id: "general-surgery",
    name: "General Surgery",
    nameAr: "الجراحة العامة",
    normalizedName: "GENERAL SURGERY",
    aliases: ["SURGEON", "GENERAL SURGEON"],
    isActive: true
  },
  {
    id: "hematology",
    name: "Hematology",
    nameAr: "أمراض الدم",
    normalizedName: "HEMATOLOGY",
    aliases: ["HEMATOLOGIST", "BLOOD SPECIALIST"],
    isActive: true
  },
  {
    id: "infectious-diseases",
    name: "Infectious Diseases",
    nameAr: "الأمراض المعدية",
    normalizedName: "INFECTIOUS DISEASES",
    aliases: [],
    isActive: true
  },
  {
    id: "internal-medicine",
    name: "Internal Medicine",
    nameAr: "الباطنية",
    normalizedName: "INTERNAL MEDICINE",
    aliases: ["INTERNIST", "INTERNAL"],
    isActive: true
  },
  {
    id: "nephrology",
    name: "Nephrology",
    nameAr: "أمراض الكلى",
    normalizedName: "NEPHROLOGY",
    aliases: ["NEPHROLOGIST", "KIDNEY SPECIALIST"],
    isActive: true
  },
  {
    id: "neurology",
    name: "Neurology",
    nameAr: "الأمراض العصبية",
    normalizedName: "NEUROLOGY",
    aliases: ["NEUROLOGIST", "NEURO"],
    isActive: true
  },
  {
    id: "obstetrics-gynecology",
    name: "Obstetrics & Gynecology",
    nameAr: "أمراض النساء والتوليد",
    normalizedName: "OBSTETRICS GYNECOLOGY",
    aliases: ["OBSTETRICS AND GYNECOLOGY", "OB/GYN", "OB/GYN", "GYNECOLOGY", "OBSTETRICS"],
    isActive: true
  },
  {
    id: "medical-oncology",
    name: "Medical Oncology",
    nameAr: "الأورام",
    normalizedName: "MEDICAL ONCOLOGY",
    aliases: ["ONCOLOGY"],
    isActive: true
  },
  {
    id: "ophthalmology",
    name: "Ophthalmology",
    nameAr: "طب العيون",
    normalizedName: "OPHTHALMOLOGY",
    aliases: ["OPHTHALMOLOGIST", "EYE SPECIALIST"],
    isActive: true
  },
  {
    id: "orthopedics",
    name: "Orthopedics",
    nameAr: "جراحة العظام",
    normalizedName: "ORTHOPEDICS",
    aliases: ["ORTHOPEDIST", "ORTHOPEDIC", "BONE SPECIALIST"],
    isActive: true
  },
  {
    id: "pathology-laboratory-medicine",
    name: "Pathology & Laboratory Medicine",
    nameAr: "علم الأمراض والمختبرات",
    normalizedName: "PATHOLOGY LABORATORY MEDICINE",
    aliases: ["PATHOLOGY", "LABORATORY MEDICINE", "PATHOLOGY AND LABORATORY MEDICINE"],
    isActive: true
  },
  {
    id: "pediatrics",
    name: "Pediatrics",
    nameAr: "طب الأطفال",
    normalizedName: "PEDIATRICS",
    aliases: ["PEDIATRICIAN", "CHILD HEALTH", "PEDIA"],
    isActive: true
  },
  {
    id: "plastic-surgery",
    name: "Plastic Surgery",
    nameAr: "جراحة التجميل",
    normalizedName: "PLASTIC SURGERY",
    aliases: ["PLASTIC SURGEON", "COSMETIC SURGERY"],
    isActive: true
  },
  {
    id: "psychiatry",
    name: "Psychiatry",
    nameAr: "الطب النفسي",
    normalizedName: "PSYCHIATRY",
    aliases: ["PSYCHIATRIST", "PSYCH"],
    isActive: true
  },
  {
    id: "public-health",
    name: "Public Health",
    nameAr: "الصحة العامة",
    normalizedName: "PUBLIC HEALTH",
    aliases: [],
    isActive: true
  },
  {
    id: "pulmonary-medicine",
    name: "Pulmonary Medicine",
    nameAr: "الأمراض الصدرية",
    normalizedName: "PULMONARY MEDICINE",
    aliases: ["PULMONOLOGY", "RESPIRATORY MEDICINE", "CHEST MEDICINE"],
    isActive: true
  },
  {
    id: "radiology",
    name: "Radiology",
    nameAr: "الأشعة",
    normalizedName: "RADIOLOGY",
    aliases: ["RADIOLOGIST", "X-RAY"],
    isActive: true
  },
  {
    id: "rheumatology",
    name: "Rheumatology",
    nameAr: "أمراض الروماتيزم",
    normalizedName: "RHEUMATOLOGY",
    aliases: ["RHEUMATOLOGIST", "ARTHRITIS SPECIALIST"],
    isActive: true
  },
  {
    id: "transplant-medicine",
    name: "Transplant Medicine",
    nameAr: "طب زراعة الأعضاء",
    normalizedName: "TRANSPLANT MEDICINE",
    aliases: ["TRANSPLANTATION", "ORGAN TRANSPLANTATION"],
    isActive: true
  },
  {
    id: "urology",
    name: "Urology",
    nameAr: "جراحة المسالك البولية",
    normalizedName: "UROLOGY",
    aliases: ["UROLOGIST", "URINARY SPECIALIST"],
    isActive: true
  },
  {
    id: "general-practice",
    name: "General Practice",
    nameAr: "الطب العام",
    normalizedName: "GENERAL PRACTICE",
    aliases: ["GENERAL PRACTITIONER", "GP"],
    isActive: true
  },
  {
    id: "other-specialty",
    name: "Other Specialty",
    nameAr: "تخصص آخر",
    normalizedName: "OTHER WORK",
    aliases: [],
    isActive: true
  }
];

// Reusable variables for singleton state subscription
let globalSpecialties: PhysicianSpecialty[] = [];
let globalLoading = true;
let globalStatus: SpecialtyStatus = "loading";
let globalErrorMessage: string | null = null;
const globalListeners = new Set<(state: SpecialtyRegistryState) => void>();
let globalUnsubscribe: (() => void) | null = null;
let globalAuthUnsubscribe: (() => void) | null = null;

function notifyListeners() {
  const state: SpecialtyRegistryState = {
    specialties: globalSpecialties,
    loading: globalLoading,
    status: globalStatus,
    errorMessage: globalErrorMessage,
  };
  globalListeners.forEach(listener => listener(state));
}

// Standardized subscription logic - ONLY ONE active listener
export function startSpecialtySubscription(enableMockData: boolean = false) {
  if (globalUnsubscribe) return;

  if (enableMockData) {
    globalSpecialties = APPROVED_31_SPECIALTIES as PhysicianSpecialty[];
    globalLoading = false;
    globalStatus = "loaded";
    globalErrorMessage = null;
    notifyListeners();
    return;
  }

  // Subscribe to auth state so we can automatically restart the subscription when user logs in or out
  if (!globalAuthUnsubscribe) {
    globalAuthUnsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        console.info("[Specialty Registry Source] Auth state change (logged in). Restarting subscription...");
        restartSubscription();
      } else {
        console.info("[Specialty Registry Source] Auth state change (logged out). Resetting state...");
        if (globalUnsubscribe) {
          globalUnsubscribe();
          globalUnsubscribe = null;
        }
        globalSpecialties = [];
        globalLoading = false;
        globalStatus = "permission-denied";
        globalErrorMessage = "Authentication required to access the registry.";
        notifyListeners();
      }
    });
  }

  let retryCount = 0;
  const maxRetries = 3;

  function restartSubscription() {
    if (globalUnsubscribe) {
      globalUnsubscribe();
      globalUnsubscribe = null;
    }

    globalLoading = true;
    globalStatus = "loading";
    globalErrorMessage = null;
    notifyListeners();

    function setupOnSnapshot() {
      // Do not attempt to subscribe if there is no authenticated user
      if (!auth.currentUser) {
        globalSpecialties = [];
        globalLoading = false;
        globalStatus = "permission-denied";
        globalErrorMessage = "Authentication required to access the specialty registry.";
        notifyListeners();
        return;
      }

      globalUnsubscribe = onSnapshot(
        collection(db, "physicianSpecialties"),
        (snapshot) => {
          const list: PhysicianSpecialty[] = [];
          snapshot.forEach((doc) => {
            const data = doc.data();
            if (!data.isDeleted) {
              list.push({ id: doc.id, ...data } as PhysicianSpecialty);
            }
          });
          globalSpecialties = list;
          globalLoading = false;
          globalStatus = list.length === 0 ? "empty" : "loaded";
          globalErrorMessage = null;
          retryCount = 0; // reset retry counter on success
          notifyListeners();
        },
        (err) => {
          console.error("[Specialty Registry Source] Error subscribing to physicianSpecialties:", err);
          
          if (err.code === "permission-denied" || String(err).includes("permission")) {
            // Auto retry with backoff if user is logged in
            if (auth.currentUser && retryCount < maxRetries) {
              retryCount++;
              const backoff = retryCount * 1200;
              console.warn(`[Specialty Registry Source] Permission Denied with active user. Retrying in ${backoff}ms... (Attempt ${retryCount}/${maxRetries})`);
              
              if (globalUnsubscribe) {
                globalUnsubscribe();
                globalUnsubscribe = null;
              }
              
              setTimeout(() => {
                if (auth.currentUser) {
                  setupOnSnapshot();
                }
              }, backoff);
              return;
            }

            globalSpecialties = [];
            globalLoading = false;
            globalStatus = "permission-denied";
            globalErrorMessage = `Firestore Access Error (Permission Denied): ${err.message || String(err)}. Please log in again or check your account permissions.`;
          } else {
            globalSpecialties = [];
            globalLoading = false;
            globalStatus = "network-error";
            globalErrorMessage = err.message || String(err);
          }
          notifyListeners();
        }
      );
    }

    setupOnSnapshot();
  }

  restartSubscription();
}

// Core shared react hook
export function useSpecialties() {
  const enableMockData = import.meta.env.DEV && import.meta.env.VITE_ENABLE_MOCK_DATA === "true";
  const [state, setState] = useState<SpecialtyRegistryState>({
    specialties: globalSpecialties,
    loading: globalLoading,
    status: globalStatus,
    errorMessage: globalErrorMessage,
  });

  useEffect(() => {
    startSpecialtySubscription(enableMockData);

    const listener = (newState: SpecialtyRegistryState) => {
      setState(newState);
    };

    globalListeners.add(listener);
    setState({
      specialties: globalSpecialties,
      loading: globalLoading,
      status: globalStatus,
      errorMessage: globalErrorMessage,
    });

    return () => {
      globalListeners.delete(listener);
    };
  }, [enableMockData]);

  // Development-only diagnostic logging
  useEffect(() => {
    if (import.meta.env.DEV) {
      const activeCount = state.specialties.filter(s => s.isActive !== false).length;
      console.info(`%c[Specialty Registry Source]
Source: ${enableMockData ? "Explicit Demo" : "Firestore"}
Collection: physicianSpecialties
Cloud Records: ${enableMockData ? 0 : state.specialties.length}
Active Records: ${activeCount}
Fallback Records: 0
Final Options: ${state.specialties.length}
Status: ${state.status}`, "color: #0ea5e9; font-weight: bold;");
    }
  }, [state, enableMockData]);

  const retry = () => {
    console.info("[Specialty Registry Source] Manual retry triggered.");
    if (globalUnsubscribe) {
      globalUnsubscribe();
      globalUnsubscribe = null;
    }
    startSpecialtySubscription(enableMockData);
  };

  return {
    ...state,
    retry
  };
}

// Fetch specialties list once (stateless helper)
export async function fetchSpecialties(): Promise<PhysicianSpecialty[]> {
  const enableMockData = import.meta.env.DEV && import.meta.env.VITE_ENABLE_MOCK_DATA === "true";
  if (enableMockData) {
    return APPROVED_31_SPECIALTIES as PhysicianSpecialty[];
  }
  try {
    const snap = await getDocs(collection(db, "physicianSpecialties"));
    if (snap.empty) {
      return [];
    }
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() } as PhysicianSpecialty))
      .filter(s => !(s as any).isDeleted);
  } catch (err) {
    console.error("[Specialty Registry Source] Error fetching specialties from Firestore:", err);
    throw err; // Prohibit silent fallback to mock data
  }
}

// Subscribe to specialties list in real-time (callback version, back-compat)
export function subscribeSpecialties(callback: (specs: PhysicianSpecialty[]) => void) {
  const enableMockData = import.meta.env.DEV && import.meta.env.VITE_ENABLE_MOCK_DATA === "true";
  if (enableMockData) {
    callback(APPROVED_31_SPECIALTIES as PhysicianSpecialty[]);
    return () => {};
  }
  return onSnapshot(
    collection(db, "physicianSpecialties"),
    (snap) => {
      const docs = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as PhysicianSpecialty))
        .filter(s => !(s as any).isDeleted);
      callback(docs);
    },
    (err) => {
      console.error("[Specialty Registry Source] Error subscribing to specialties:", err);
      // Let caller handle error or use empty list. Do not silently fallback to mock.
    }
  );
}

// Normalize a specialty string to search or compare
export function normalizeSpecialtyString(str: string): string {
  return str.trim().toUpperCase().replace(/[\s_-]+/g, " ");
}

// Case-insensitive duplicate check and registration
export async function registerNewSpecialty(
  nameEn: string,
  nameAr: string,
  aliases: string[],
  createdBy: string
): Promise<{ success: boolean; error?: string; specialty?: PhysicianSpecialty }> {
  const trimmedEn = nameEn.trim();
  const trimmedAr = nameAr.trim();

  if (!trimmedEn) {
    return { success: false, error: "English name is required" };
  }

  const normalized = normalizeSpecialtyString(trimmedEn);

  try {
    const currentSpecialties = await fetchSpecialties();
    const isDuplicate = currentSpecialties.some(s => 
      normalizeSpecialtyString(s.name) === normalized || 
      (trimmedAr && normalizeSpecialtyString(s.nameAr || "") === normalizeSpecialtyString(trimmedAr))
    );

    if (isDuplicate) {
      return { 
        success: false, 
        error: `A specialty with name "${trimmedEn}" or "${trimmedAr}" already exists in the registry.` 
      };
    }

    const safeSlug = trimmedEn.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "");
    const specId = safeSlug || `spec_${Date.now()}`;

    const cleanAliases = Array.from(new Set(
      [normalized, trimmedEn.toUpperCase(), ...aliases.map(a => normalizeSpecialtyString(a))]
    )).filter(Boolean);

    const newSpecialty: PhysicianSpecialty = {
      id: specId,
      name: trimmedEn,
      nameAr: trimmedAr || undefined,
      normalizedName: normalized,
      aliases: cleanAliases,
      isActive: true,
      createdAt: new Date().toISOString(),
      createdBy: createdBy || "system",
      source: "manual"
    } as any;

    await setDoc(doc(db, "physicianSpecialties", specId), newSpecialty);
    return { success: true, specialty: newSpecialty };
  } catch (err) {
    console.error("[Specialty Registry Source] Failed to register new specialty:", err);
    return { success: false, error: (err as Error).message || "Database write failed" };
  }
}

// Controlled idempotent initialization of the 31-specialty bilingual register
export async function initializeSpecialtyRegistry(userId: string): Promise<{ success: boolean; count: number; skipped: number; conflicts: string[]; error?: string }> {
  try {
    const snap = await getDocs(collection(db, "physicianSpecialties"));
    const existingList: PhysicianSpecialty[] = [];
    snap.forEach((doc) => {
      const data = doc.data();
      if (!data.isDeleted) {
        existingList.push({ id: doc.id, ...data } as PhysicianSpecialty);
      }
    });

    const batch = writeBatch(db);
    let count = 0;
    let skipped = 0;
    const conflicts: string[] = [];
    const addedNormalized = new Set<string>();

    for (const spec of APPROVED_31_SPECIALTIES) {
      const normalized = spec.normalizedName || normalizeSpecialtyString(spec.name);
      if (addedNormalized.has(normalized)) continue;
      addedNormalized.add(normalized);

      // Check if a record with the same ID already exists
      const existingById = existingList.find(s => s.id === spec.id);
      // Check if a record with the same normalized name already exists
      const existingByName = existingList.find(s => normalizeSpecialtyString(s.name) === normalized);

      if (existingById) {
        const isCompatible = normalizeSpecialtyString(existingById.name) === normalized;
        if (isCompatible) {
          // Exact existing record, skip to preserve everything
          skipped++;
          continue;
        } else {
          // Conflict: ID matches but Name is different
          conflicts.push(`ID Conflict: ID '${spec.id}' belongs to '${existingById.name}' instead of '${spec.name}'`);
          continue;
        }
      }

      if (existingByName) {
        // Name matches, but ID is different
        conflicts.push(`Name Conflict: Specialty '${spec.name}' already exists with a different ID '${existingByName.id}'`);
        continue;
      }

      const docRef = doc(db, "physicianSpecialties", spec.id);
      const data = {
        ...spec,
        normalizedName: normalized,
        isDeleted: false,
        isActive: true,
        createdAt: new Date().toISOString(),
        createdBy: userId,
        source: "System Initialization"
      };
      batch.set(docRef, data);
      count++;
    }

    if (count > 0) {
      await batch.commit();
    }
    return { success: true, count, skipped, conflicts };
  } catch (err) {
    console.error("[Specialty Registry Source] Failed to initialize specialty registry:", err);
    return { 
      success: false, 
      count: 0, 
      skipped: 0, 
      conflicts: [], 
      error: (err as Error).message || "Database write failed" 
    };
  }
}

/**
 * Resolves any custom or legacy free-text specialty name to its canonical counterpart,
 * matching by Name (EN), Name (AR), Normalized Name, or Aliases.
 */
export function resolveCanonicalSpecialty(
  rawName: string,
  canonicalList: PhysicianSpecialty[]
): string | null {
  if (!rawName) return null;
  const normalizedInput = normalizeSpecialtyString(rawName);

  // Exact, normalized or alias match
  const matched = canonicalList.find(s => 
    normalizeSpecialtyString(s.name) === normalizedInput ||
    normalizeSpecialtyString(s.nameAr || "") === normalizedInput ||
    s.aliases?.some(alias => normalizeSpecialtyString(alias) === normalizedInput)
  );

  if (matched) {
    return matched.name;
  }

  // Common aliases if not found explicitly (for fallback resolution only)
  if (normalizedInput === "GP" || normalizedInput === "GENERAL PRACTITIONER" || normalizedInput === "GENERAL PRACTICE") {
    const gpSpec = canonicalList.find(s => s.normalizedName === "GENERAL PRACTICE" || s.name === "General Practice");
    return gpSpec ? gpSpec.name : "General Practice";
  }
  if (normalizedInput.includes("DERMA")) {
    const dermaSpec = canonicalList.find(s => s.normalizedName === "DERMATOLOGY" || s.name === "Dermatology");
    return dermaSpec ? dermaSpec.name : "Dermatology";
  }
  if (normalizedInput.includes("CARDIO")) {
    const cardioSpec = canonicalList.find(s => s.normalizedName === "CARDIOLOGY" || s.name === "Cardiology");
    return cardioSpec ? cardioSpec.name : "Cardiology";
  }
  if (normalizedInput.includes("PEDIA")) {
    const pediaSpec = canonicalList.find(s => s.normalizedName === "PEDIATRICS" || s.name === "Pediatrics");
    return pediaSpec ? pediaSpec.name : "Pediatrics";
  }
  if (normalizedInput.includes("GYNE") || normalizedInput.includes("OBSTET")) {
    const obsgyneSpec = canonicalList.find(s => s.normalizedName === "OBSTETRICS & GYNECOLOGY" || s.name === "Obstetrics & Gynecology" || s.name === "Gynecology");
    return obsgyneSpec ? obsgyneSpec.name : "Gynecology";
  }

  return null;
}

export function getEditDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1).toLowerCase() === a.charAt(j - 1).toLowerCase()) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

export function suggestSpecialty(
  rawName: string,
  canonicalList: PhysicianSpecialty[]
): { suggestion: string | null; confidence: "high" | "low" } {
  if (!rawName) return { suggestion: null, confidence: "low" };
  const normalizedInput = rawName.trim().toUpperCase();

  let bestMatch: PhysicianSpecialty | null = null;
  let minDistance = Infinity;

  for (const s of canonicalList) {
    const targets = [
      s.name.toUpperCase(),
      (s.nameAr || "").toUpperCase(),
      ...(s.aliases || []).map(a => a.toUpperCase())
    ].filter(Boolean);

    for (const target of targets) {
      const distance = getEditDistance(normalizedInput, target);
      if (distance < minDistance) {
        minDistance = distance;
        bestMatch = s;
      }
    }
  }

  // If distance is small, confidence is High
  if (bestMatch && minDistance <= 2) {
    return { suggestion: bestMatch.name, confidence: "high" };
  }

  return { suggestion: null, confidence: "low" };
}

// Update an existing specialty's bilingual names
export async function updateSpecialty(
  specialtyId: string,
  nameEn: string,
  nameAr: string,
  aliases: string[],
  updatedBy: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const trimmedEn = nameEn.trim();
    const trimmedAr = nameAr.trim();
    if (!trimmedEn) {
      return { success: false, error: "English name is required" };
    }
    const normalized = normalizeSpecialtyString(trimmedEn);

    // Duplicate check for other documents
    const currentSpecialties = await fetchSpecialties();
    const isDuplicate = currentSpecialties.some(s => 
      s.id !== specialtyId && (
        normalizeSpecialtyString(s.name) === normalized || 
        (trimmedAr && normalizeSpecialtyString(s.nameAr || "") === normalizeSpecialtyString(trimmedAr))
      )
    );

    if (isDuplicate) {
      return { 
        success: false, 
        error: `A specialty with name "${trimmedEn}" or "${trimmedAr}" already exists in the registry.` 
      };
    }

    const cleanAliases = Array.from(new Set(
      [normalized, trimmedEn.toUpperCase(), ...aliases.map(a => normalizeSpecialtyString(a))]
    )).filter(Boolean);

    const docRef = doc(db, "physicianSpecialties", specialtyId);
    await setDoc(docRef, {
      name: trimmedEn,
      nameAr: trimmedAr || null,
      normalizedName: normalized,
      aliases: cleanAliases,
      updatedAt: new Date().toISOString(),
      updatedBy
    }, { merge: true });

    return { success: true };
  } catch (err) {
    console.error("[Specialty Registry Source] Failed to update specialty:", err);
    return { success: false, error: (err as Error).message || "Database write failed" };
  }
}

// Change the active status (Deactivate / Reactivate) of a specialty
export async function setSpecialtyActiveStatus(
  specialtyId: string,
  isActive: boolean,
  updatedBy: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const docRef = doc(db, "physicianSpecialties", specialtyId);
    await setDoc(docRef, {
      isActive,
      updatedAt: new Date().toISOString(),
      updatedBy
    }, { merge: true });
    return { success: true };
  } catch (err) {
    console.error("[Specialty Registry Source] Failed to change specialty active status:", err);
    return { success: false, error: (err as Error).message || "Database write failed" };
  }
}

