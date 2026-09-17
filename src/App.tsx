import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { EMPTY_PHARMACY_VISIT_READ_STATE, type PharmacyVisitReadState } from "./lib/pharmacyVisitReadClient";
import { createPhysicianAuthoritatively } from "./lib/physicianCreateClient";
import { 
  initialUsers, 
  initialPhysicians, 
  initialPharmacies, 
  initialProducts, 
  initialKeyMessages, 
  initialAuditLogs, 
  initialPermissions,
  initialPhysicianVisits,
  initialPharmacyVisits,
  initialPhysicianSpecialties
} from "./data/mockData";
import { 
  Role, 
  User, 
  Physician, 
  Pharmacy, 
  Product, 
  ProductPromotionGroup,
  KeyMessage, 
  AuditLog, 
  Permissions, 
  PhysicianSpecialty, 
  PhysicianVisit as PhysicianVisitType, 
  PhysicianVisitCompletionResult,
  PharmacyVisit as PharmacyVisitType, 
  ImportHistory as ImportHistoryType,
  UserTerritoryAssignment,
  UserProductAssignment,
  Country,
  District,
  City,
  Area,
  normalizeRole
} from "./types";
import { 
  INITIAL_USER_TERRITORY_ASSIGNMENTS, 
  INITIAL_USER_PRODUCT_ASSIGNMENTS,
  filterBySecurity
} from "./lib/alignmentService";
import { getOrderBusinessNumber } from "./utils/visitNumberUtils";
import { mapImportedRowToSchema } from "./lib/schemaEngine";
import { getReadiness } from "./lib/userPolicyEngine";
import type { AccessGovernanceRecord } from "./lib/accessGovernance";
import { normalizeNavigationRestrictions } from "./lib/navigationRestrictionPolicy";
import { canAccessCanonicalView, resolveAuthorizedRestoredView } from "./lib/canonicalAccessControl";
import { resolveCanonicalAreaIds } from "./lib/securityEngine";
import { evaluateBaseSessionInitialization, resolveSessionDomState } from "./lib/baseSessionInitialization";
import { shouldCommitAuthorizedSnapshot } from "./lib/customerListenerPolicy";
import { classifyPharmacyDuplicate } from "./components/ImportModule";

import { claimActivationViaBackend } from "./lib/authApiClient";
import Sidebar from "./components/Sidebar";
import SidebarPageRouter from "./components/SidebarPageRouter";
import AuthModal from "./components/AuthModal";
import { isExplicitSandboxEnabled, resolveSessionAccessMode } from "./lib/sessionAccessPolicy";
import OfflineSyncModal from "./components/OfflineSyncModal";
import VisitSummaryModal from "./components/VisitSummaryModal";

import { 
  Shield, 
  Globe, 
  Sun, 
  Moon, 
  Users, 
  Database, 
  LayoutDashboard,
  CheckCircle2,
  Menu,
  X,
  Bell,
  Stethoscope,
  MapPin,
  CloudLightning,
  CloudOff,
  CloudCheck,
  Loader2
} from "lucide-react";

import { auth, db, firestoreDatabaseId } from "./lib/firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc, getDocs, writeBatch, onSnapshot, query, where, collection, enableNetwork, disableNetwork } from "firebase/firestore";
import { decorateRecord, listenCollection, saveRolePermissions } from "./lib/firebaseSync";
import { handleFirestoreError, OperationType, addFirestoreErrorListener, FirestoreErrorInfo, clearFirestoreError } from "./lib/firebaseError";
import { getDirectReports, setGlobalSecurityContext } from "./lib/securityEngine";
import { 
  savePhysician, 
  savePharmacy, 
  saveProduct,
  saveProductBatch,
  isRetryableProductPersistenceError,
  deleteProductRecord, 
  deletePhysicianRecord,
  deletePharmacyRecord,
  savePhysicianVisitRecord, 
  savePharmacyVisitRecord, 
  saveAuditLogRecord, 
  saveImportHistoryRecord,
  saveOrder,
  createPendingUserWithActivationProfile,
  getEmailKey,
  createAuthUserViaAdminApi,
  syncImportedUserTerritories,
  verifyCanonicalImportedUser
} from "./lib/firestoreService";
import { onboardImportedUser, type ImportedUserRowResult } from "./lib/userImportOnboarding";

import { removeUndefinedRecursively, stripUndefinedFields } from "./utils/importNormalization";

import { 
  subscribeConnectivityStatus, 
  subscribeQueueChanges, 
  triggerAutomaticSync, 
  forceRetryItem, 
  resolveConflictManually, 
  deleteQueueItem, 
  clearQueue,
  getCurrentConnectivityStatus,
  ConnectivityStatus, 
  OfflineQueueItem,
  enqueueOfflineWrite
} from "./lib/offlineSyncEngine";
import { useSpecialties, initializeSpecialtyRegistry } from "./utils/specialtyService";
import { resolveSubordinateScope } from "./lib/hierarchyService";
import { OperationalScopeSessionProvider } from "./contexts/OperationalScopeSessionContext";
import {
  createOperationalScopeSessionController,
  EMPTY_OPERATIONAL_SCOPE_SESSION,
  type OperationalScopeSessionController,
  type OperationalScopeSessionState,
} from "./lib/operationalScopeSession";
import {
  createPhysicianReadController,
  type PhysicianReadController,
} from "./lib/physicianReadClient";
import {
  createPharmacyReadController,
  type PharmacyReadController,
} from "./lib/pharmacyReadClient";
import {
  createPhysicianVisitReadController,
  refreshScopedPhysicianVisitHistory,
  EMPTY_PHYSICIAN_VISIT_READ_STATE,
  type PhysicianVisitReadController,
  type PhysicianVisitReadState,
} from "./lib/physicianVisitReadClient";
import {
  fetchScopedPhysicianVisitHistory,
  fetchScopedPhysicianVisitSummaries,
  type ScopedPhysicianVisitSummary,
} from "./lib/physicianVisitHistoryClient";
import {
  createPharmacyVisitReadController,
  type PharmacyVisitReadController,
} from "./lib/pharmacyVisitReadClient";


const neutralUser: User = {
  id: "unresolved",
  name: "Loading Account...",
  email: "",
  role: "Pending Approval" as Role,
  territory: "",
  region: "",
  active: false,
};

export default function App() {
  // Global View states
  const [activeView, setActiveView] = useState<string>("dashboard");
  const [summaryModalVisit, setSummaryModalVisit] = useState<any | null>(null);
  const [lang, setLang] = useState<"en" | "ar">("en");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Sandbox must never activate automatically or in a production build.
  const enableMockData = isExplicitSandboxEnabled({
    isDevelopment: import.meta.env.DEV,
    sandboxRequested: localStorage.getItem("sandbox_mode") === "true",
  });

  // Core Sync Data States (hydrated from rich seed mockup, synced to Firestore)
  const [users, setUsers] = useState<User[]>(enableMockData ? initialUsers : []);
  const [currentUser, setCurrentUser] = useState<User>(neutralUser); // default: neutral user during unresolved auth
  const [currentManager, setCurrentManager] = useState<User | null>(null);
  const [managerHydrated, setManagerHydrated] = useState<boolean>(false);
  const [physicians, setPhysicians] = useState<Physician[]>(enableMockData ? initialPhysicians : []);
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>(enableMockData ? initialPharmacies : []);

  useEffect(() => {
    console.info(
      "[PHARMACY_APP_STATE_COMMITTED_JSON]",
      JSON.stringify({
        count: pharmacies.length,
        documentIds: pharmacies.map(p => p.id)
      })
    );
  }, [pharmacies]);
  const [products, setProducts] = useState<Product[]>(enableMockData ? initialProducts : []);
  const [productPromotionGroups, setProductPromotionGroups] = useState<ProductPromotionGroup[]>([]);
  const [keyMessages, setKeyMessages] = useState<KeyMessage[]>(enableMockData ? initialKeyMessages : []);
  const specialtyState = useSpecialties();
  const physicianSpecialties = specialtyState.specialties;
  const [permissionsMatrix, setPermissionsMatrix] = useState<Record<Role, Permissions>>(initialPermissions);
  const [accessGovernanceMatrix, setAccessGovernanceMatrix] = useState<Partial<Record<Role, AccessGovernanceRecord>>>({});
  
  const [userTerritoryAssignments, setUserTerritoryAssignments] = useState<UserTerritoryAssignment[]>(enableMockData ? INITIAL_USER_TERRITORY_ASSIGNMENTS : []);
  const [userProductAssignments, setUserProductAssignments] = useState<UserProductAssignment[]>(enableMockData ? INITIAL_USER_PRODUCT_ASSIGNMENTS : []);
  
  // Transactions and logs
  const [physicianVisits, setPhysicianVisits] = useState<PhysicianVisitType[]>([]);
  const [physicianVisitReadState, setPhysicianVisitReadState] = useState<PhysicianVisitReadState>(EMPTY_PHYSICIAN_VISIT_READ_STATE);
  const [pharmacyVisitReadState, setPharmacyVisitReadState] = useState<PharmacyVisitReadState>(EMPTY_PHARMACY_VISIT_READ_STATE);
  const [physicianVisitSummaries, setPhysicianVisitSummaries] = useState<Map<string, ScopedPhysicianVisitSummary>>(new Map());
  const [physicianVisitSummaryStatus, setPhysicianVisitSummaryStatus] = useState<"IDLE" | "LOADING" | "READY" | "ERROR">("IDLE");
  const [pharmacyVisits, setPharmacyVisits] = useState<PharmacyVisitType[]>([]);
  const [importHistory, setImportHistory] = useState<ImportHistoryType[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(enableMockData ? initialAuditLogs : []);

  const enrichedPhysicians = useMemo(() => {
    return physicians.map(phys => {
      const primaryGroup = productPromotionGroups.find(g => g.id === phys.primaryPromotionGroupId);
      const primaryBrand = primaryGroup ? primaryGroup.name : (phys.primaryBrand || "");

      const targetBrands = (phys.targetPromotionGroupIds || []).map(tgId => {
        const matched = productPromotionGroups.find(g => g.id === tgId);
        return matched ? matched.name : "";
      }).filter(Boolean);

      const repUser = users.find(u => u.id === phys.assignedRepId);
      const assignedRepName = repUser ? repUser.name : (phys.assignedRepName || "");

      const assignedProducts = phys.alignedProductIds || phys.assignedProducts || [];

      return {
        ...phys,
        primaryBrand,
        targetBrands: targetBrands.length > 0 ? targetBrands : (phys.targetBrands || []),
        assignedRepName,
        assignedProducts,
        primaryPromotionGroupName: primaryGroup ? primaryGroup.name : undefined,
        targetPromotionGroupNames: targetBrands.length > 0 ? targetBrands : undefined
      };
    });
  }, [physicians, productPromotionGroups, users]);

  const handleUpdatePermissions = async (updatedMatrix: Record<Role, Permissions>) => {
    setPermissionsMatrix(updatedMatrix);
    for (const role of Object.keys(updatedMatrix) as Role[]) {
      const current = permissionsMatrix[role];
      const updated = updatedMatrix[role];
      if (JSON.stringify(current) !== JSON.stringify(updated)) {
        await saveRolePermissions(role, updated, currentUser?.id || "ADMIN");
      }
    }
  };

  // Authentication states
  const [firebaseUser, setFirebaseUser] = useState<any>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [dbError, setDbError] = useState<FirestoreErrorInfo | null>(null);
  const [isBannerAcknowledged, setIsBannerAcknowledged] = useState(false);
  const [isSessionInitializing, setIsSessionInitializing] = useState(false);
  const [sessionLoadingSteps, setSessionLoadingSteps] = useState<any[]>([]);
  const [lastAuthUid, setLastAuthUid] = useState<string | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [territoryAssignmentsHydrated, setTerritoryAssignmentsHydrated] = useState(false);
  const [productAssignmentsHydrated, setProductAssignmentsHydrated] = useState(false);
  const [permissionsReady, setPermissionsReady] = useState(false);
  const [policyReady, setPolicyReady] = useState(false);
  const [sessionHydrationComplete, setSessionHydrationComplete] = useState(false);
  const [initError, setInitError] = useState<{ step: string; message: string; classification?: string; code?: string; path?: string } | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const operationalScopeControllerRef = useRef<OperationalScopeSessionController | null>(null);
  if (!operationalScopeControllerRef.current) {
    operationalScopeControllerRef.current = createOperationalScopeSessionController();
  }
  const operationalScopeController = operationalScopeControllerRef.current;
  const physicianReadControllerRef = useRef<PhysicianReadController | null>(null);
  if (!physicianReadControllerRef.current) {
    physicianReadControllerRef.current = createPhysicianReadController();
  }
  const physicianReadController = physicianReadControllerRef.current;
  const pharmacyReadControllerRef = useRef<PharmacyReadController | null>(null);
  if (!pharmacyReadControllerRef.current) {
    pharmacyReadControllerRef.current = createPharmacyReadController();
  }
  const pharmacyReadController = pharmacyReadControllerRef.current;
  const physicianVisitReadControllerRef = useRef<PhysicianVisitReadController | null>(null);
  if (!physicianVisitReadControllerRef.current) {
    physicianVisitReadControllerRef.current = createPhysicianVisitReadController();
  }
  const physicianVisitReadController = physicianVisitReadControllerRef.current;
  const pharmacyVisitReadControllerRef = useRef<PharmacyVisitReadController | null>(null);
  if (!pharmacyVisitReadControllerRef.current) {
    pharmacyVisitReadControllerRef.current = createPharmacyVisitReadController();
  }
  const pharmacyVisitReadController = pharmacyVisitReadControllerRef.current;
  const [operationalScopeSession, setOperationalScopeSession] = useState<OperationalScopeSessionState>(
    EMPTY_OPERATIONAL_SCOPE_SESSION,
  );

  useEffect(
    () => operationalScopeController.subscribe(setOperationalScopeSession),
    [operationalScopeController],
  );
  useEffect(
    () => physicianVisitReadController.subscribe(setPhysicianVisitReadState),
    [physicianVisitReadController],
  );
  useEffect(
    () => pharmacyVisitReadController.subscribe(setPharmacyVisitReadState),
    [pharmacyVisitReadController],
  );

  // Enterprise Offline & Synchronization Engine States
  const [connectivityStatus, setConnectivityStatus] = useState<ConnectivityStatus>("online");
  const [offlineQueues, setOfflineQueues] = useState<{ [key: string]: OfflineQueueItem[] }>({
    pending: [],
    completed: [],
    failed: [],
    retry: [],
    conflict: []
  });
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);

  // Subscribe to offline sync engine updates and audit log creation events
  useEffect(() => {
    const unsubStatus = subscribeConnectivityStatus((status) => {
      setConnectivityStatus(status);
    });
    const unsubQueues = subscribeQueueChanges((queues) => {
      setOfflineQueues(queues);
    });

    // Register global listener for audit log updates
    (window as any).onAuditLogCreated = (newLog: AuditLog) => {
      setAuditLogs(prev => {
        if (prev.some(log => log.id === newLog.id)) {
          return prev;
        }
        return [newLog, ...prev];
      });
    };

    return () => {
      unsubStatus();
      unsubQueues();
      delete (window as any).onAuditLogCreated;
    };
  }, []);


  // Subscribe to Firestore sync error status
  useEffect(() => {
    const unsubscribe = addFirestoreErrorListener((err) => {
      setDbError(err);
    });
    return unsubscribe;
  }, []);

  const logDiagnostic = (event: string, extra?: any) => {
    const timestamp = new Date().toISOString();
    const isSandbox = enableMockData && authReady && !firebaseUser;
    const sessionReady = isSandbox || evaluateBaseSessionInitialization({
      authReady,
      profileLoaded,
      permissionsReady,
      policyReady,
      sessionHydrationComplete,
      readinessStatus: operationalReport.status,
      operationalScopeStatus: operationalScopeSession.status,
    }).ready;
    console.info(`[DIAGNOSTIC] [${timestamp}] ${event}`, {
      authUid: auth.currentUser?.uid || "none",
      role: currentUser?.role || "none",
      activeView,
      readiness: {
        authReady,
        profileLoaded,
        permissionsReady,
        policyReady,
        sessionHydrationComplete,
        operationalScopeStatus: operationalScopeSession.status,
        sessionReady
      },
      ...extra
    });
  };

  useEffect(() => {
    logDiagnostic("App mounted");
  }, []);

  // Apply Theme class to document wrapper
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [theme]);

  // Keep the global security engine context in sync with the state
  useEffect(() => {
    if (currentUser) {
      setGlobalSecurityContext(currentUser, users, userTerritoryAssignments, userProductAssignments, products, productPromotionGroups);
      (window as any).currentUser = currentUser;
    }
  }, [currentUser, users, userTerritoryAssignments, userProductAssignments, products, productPromotionGroups]);

  // Helper to update state only if value changed (avoids triggering effect dependency updates)
  const setStableState = useCallback(<T,>(setter: React.Dispatch<React.SetStateAction<T>>, newValue: T) => {
    setter((prev) => {
      let prevSerialized = "";
      let nextSerialized = "";
      let equal = false;

      try {
        prevSerialized = JSON.stringify(prev ?? []);
        nextSerialized = JSON.stringify(newValue ?? []);
        equal = prevSerialized === nextSerialized;
      } catch (err: any) {
        console.error("[SET_STABLE_STATE_SERIALIZATION_ERROR]", err);
        equal = false;
      }

      if (setter === setPharmacies || (Array.isArray(newValue) && (newValue.length === 0 || (newValue[0] && (newValue[0] as any).address !== undefined)))) {
        console.info("[PHARMACY_STABLE_STATE_COMPARE_JSON]", JSON.stringify({
          previousCount: Array.isArray(prev) ? prev.length : 0,
          nextCount: Array.isArray(newValue) ? (newValue as any).length : 0,
          previousSerializedLength: prevSerialized.length,
          nextSerializedLength: nextSerialized.length,
          equal: equal,
          stateUpdateAccepted: !equal
        }));
      }

      if (equal) {
        return prev;
      }
      return newValue;
    });
  }, []);

  // Compute stable primitive variables for Area assignments and roles
  const activeTaAreaIds = useMemo(() => {
    return (userTerritoryAssignments || [])
      .filter((a) => a.userId === currentUser?.id && (a.status === "Active" || (a as any).active === true))
      .map((a) => a.territoryId || a.areaId || a.territoryName || "")
      .filter(Boolean);
  }, [userTerritoryAssignments, currentUser?.id]);

  const profileAreaIds = useMemo(() => {
    return (currentUser?.areaIds || []).filter(Boolean);
  }, [currentUser?.areaIds]);

  const resolvedAreaIds = useMemo(() => {
    return resolveCanonicalAreaIds(currentUser, userTerritoryAssignments || []);
  }, [currentUser?.id, profileAreaIds, activeTaAreaIds, userTerritoryAssignments]);

  const resolvedAreaKey = useMemo(() => {
    return resolvedAreaIds.join("|");
  }, [resolvedAreaIds]);

  const normalizedRole = useMemo(() => {
    return currentUser?.role ? normalizeRole(currentUser.role) : "";
  }, [currentUser?.role]);

  const assignmentsHydrated = useMemo(() => {
    return territoryAssignmentsHydrated && productAssignmentsHydrated;
  }, [territoryAssignmentsHydrated, productAssignmentsHydrated]);

  const readinessUsers = useMemo(() => {
    if (currentUser?.role === Role.SUPER_ADMIN) {
      return users;
    }
    const list: User[] = [];
    if (currentUser) list.push(currentUser);
    if (currentManager && currentManager.id !== currentUser?.id) {
      list.push(currentManager);
    }
    return list;
  }, [currentUser, currentManager, users]);

  const operationalReport = useMemo(() => {
    if (!currentUser) return { status: "Incomplete", reasons: ["NO_USER"] };

    if (currentUser.role !== Role.SUPER_ADMIN && currentUser.managerId && currentUser.managerId.trim() !== "" && !managerHydrated) {
      const pendingReport = { status: "Pending", reasons: ["LOADING_MANAGER"] };
      console.info(
        "[READINESS_MANAGER_RESULT_JSON]",
        JSON.stringify({
          managerRequired: true,
          managerFound: false,
          managerValid: false,
          failureReason: null,
          pendingReason: "LOADING_MANAGER",
          operationalStatus: "Pending",
          operationalReasons: ["LOADING_MANAGER"]
        })
      );
      return pendingReport;
    }

    const report = getReadiness(currentUser, readinessUsers, {
      territoryAssignments: userTerritoryAssignments,
      productAssignments: userProductAssignments,
      assignmentsHydrated,
      operationalScopeStatus: operationalScopeSession.status,
    });

    console.info(
      "[READINESS_MANAGER_RESULT_JSON]",
      JSON.stringify({
        managerRequired: currentUser.role !== Role.SUPER_ADMIN,
        managerFound: !!currentManager || !!readinessUsers.find(u => u.id === currentUser.managerId),
        managerValid: !report.reasons.includes("MANAGER_MISSING"),
        failureReason: report.reasons.find(r => r.includes("MANAGER")) || null,
        operationalStatus: report.status,
        operationalReasons: report.reasons
      })
    );

    return report;
  }, [currentUser, readinessUsers, managerHydrated, currentManager, userTerritoryAssignments, userProductAssignments, assignmentsHydrated, operationalScopeSession.status]);

  const isOperational = useMemo(() => {
    return operationalReport.status === "Operational";
  }, [operationalReport]);

  // WP5.2F.3 physician directory/profile READ. This is the only physician
  // retrieval path and it never falls back to a direct Firestore listener.
  useEffect(() => {
    physicianReadController.clear();
    setStableState(setPhysicians, []);
    if (
      !authReady
      || !firebaseUser?.uid
      || !profileLoaded
      || operationalScopeSession.status !== "READY"
    ) return;

    let cancelled = false;
    void physicianReadController.load(firebaseUser.uid, firebaseUser).then(() => {
      if (cancelled) return;
      const state = physicianReadController.getState();
      if (state.status === "READY" && state.actorUid === firebaseUser.uid) {
        setStableState(setPhysicians, state.physicians);
      } else {
        setStableState(setPhysicians, []);
      }
    });

    return () => {
      cancelled = true;
      physicianReadController.clear();
      setStableState(setPhysicians, []);
    };
  }, [
    authReady,
    firebaseUser?.uid,
    profileLoaded,
    operationalScopeSession.status,
    physicianReadController,
    setStableState,
  ]);

  useEffect(() => {
    if (!firebaseUser?.uid) return;
    const refreshPlannedPhysicians = () => { void physicianReadController.load(firebaseUser.uid, firebaseUser).then(() => { const state = physicianReadController.getState(); setStableState(setPhysicians, state.status === "READY" ? state.physicians : []); }); };
    window.addEventListener("menareps:medical-planner-saved", refreshPlannedPhysicians);
    return () => window.removeEventListener("menareps:medical-planner-saved", refreshPlannedPhysicians);
  }, [firebaseUser, physicianReadController, setStableState]);

  // WP5.2F.5A physician visit-history READ. Execution and persistence remain separate.
  useEffect(() => {
    physicianVisitReadController.clear();
    setStableState(setPhysicianVisits, []);
    if (!authReady || !firebaseUser?.uid || !profileLoaded || operationalScopeSession.status !== "READY") return;
    let cancelled = false;
    void physicianVisitReadController.load(firebaseUser.uid, firebaseUser).then(() => {
      if (cancelled) return;
      const state = physicianVisitReadController.getState();
      setStableState(setPhysicianVisits, state.status === "READY" && state.actorUid === firebaseUser.uid ? state.visits : []);
    });
    return () => {
      cancelled = true;
      physicianVisitReadController.clear();
      setStableState(setPhysicianVisits, []);
    };
  }, [authReady, firebaseUser?.uid, profileLoaded, operationalScopeSession.status, physicianVisitReadController, setStableState]);

  // All-time scoped summaries are separate from the bounded general visit feed.
  // Never substitute physician master lastVisitDate while this read is pending.
  useEffect(() => {
    setPhysicianVisitSummaries(new Map());
    setPhysicianVisitSummaryStatus("IDLE");
    if (!authReady || !firebaseUser?.uid || !profileLoaded || operationalScopeSession.status !== "READY") return;
    if (physicians.length === 0) {
      setPhysicianVisitSummaryStatus("READY");
      return;
    }
    let cancelled = false;
    setPhysicianVisitSummaryStatus("LOADING");
    void fetchScopedPhysicianVisitSummaries(firebaseUser, physicians.map((physician) => physician.id))
      .then((summaries) => {
        if (cancelled) return;
        setPhysicianVisitSummaries(summaries);
        setPhysicianVisitSummaryStatus("READY");
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[Firestore] Scoped physician visit summaries failed:", error);
        setPhysicianVisitSummaries(new Map());
        setPhysicianVisitSummaryStatus("ERROR");
      });
    return () => { cancelled = true; };
  }, [authReady, firebaseUser?.uid, profileLoaded, operationalScopeSession.status, physicians, physicianVisits]);

  const loadScopedPhysicianHistory = useCallback(async (physicianId: string, subjectUid?: string) => {
    if (!firebaseUser?.uid) throw new Error("Authenticated actor is required for physician history");
    return fetchScopedPhysicianVisitHistory(firebaseUser, physicianId, subjectUid);
  }, [firebaseUser]);

  // WP5.2F.5B pharmacy visit-history READ. Execution and persistence remain separate.
  useEffect(() => {
    pharmacyVisitReadController.clear();
    setStableState(setPharmacyVisits, []);
    if (!authReady || !firebaseUser?.uid || !profileLoaded || operationalScopeSession.status !== "READY") return;
    let cancelled = false;
    void pharmacyVisitReadController.load(firebaseUser.uid, firebaseUser).then(() => {
      if (cancelled) return;
      const state = pharmacyVisitReadController.getState();
      setStableState(setPharmacyVisits, state.status === "READY" && state.actorUid === firebaseUser.uid ? state.visits : []);
    });
    return () => {
      cancelled = true;
      pharmacyVisitReadController.clear();
      setStableState(setPharmacyVisits, []);
    };
  }, [authReady, firebaseUser?.uid, profileLoaded, operationalScopeSession.status, pharmacyVisitReadController, setStableState]);

  // 1. Core System Shared Catalogs Listeners
  useEffect(() => {
    if (!authReady || !firebaseUser?.uid) return;

    const unsubscribeProducts = listenCollection<Product>("products", (records) => {
      setStableState(setProducts, records);
    });
    console.info("SAFE LISTENER STARTED: products");

    const unsubscribePromotionGroups = listenCollection<ProductPromotionGroup>("productPromotionGroups", (records) => {
      setStableState(setProductPromotionGroups, records);
    });
    console.info("SAFE LISTENER STARTED: productPromotionGroups");

    const unsubscribeKeyMessages = listenCollection<KeyMessage>("keyMessages", (records) => {
      setStableState(setKeyMessages, records);
    });
    console.info("SAFE LISTENER STARTED: keyMessages");

    const unsubscribeRolePermissions = onSnapshot(
      collection(db, "rolePermissions"),
      (snap) => {
        const matrix: Record<Role, Permissions> = { ...initialPermissions };
        snap.forEach((doc) => {
          const roleKey = doc.id as Role;
          matrix[roleKey] = {
            ...initialPermissions[roleKey],
            ...(doc.data() as any)
          };
        });
        setStableState(setPermissionsMatrix, matrix);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, "rolePermissions");
      }
    );
    console.info("SAFE LISTENER STARTED: rolePermissions");

    const unsubscribeAccessGovernance = onSnapshot(
      collection(db, "accessGovernance"),
      (snap) => {
        const matrix: Partial<Record<Role, AccessGovernanceRecord>> = {};
        snap.forEach((document) => {
          const data = document.data() as Partial<AccessGovernanceRecord>;
          matrix[document.id as Role] = {
            role: document.id,
            navigation: Array.isArray(data.navigation) ? data.navigation : [],
            navigationRestrictions: normalizeNavigationRestrictions(data.navigationRestrictions),
            capabilities: Array.isArray(data.capabilities) ? data.capabilities : [],
            dataScopeMode: data.dataScopeMode || "CUSTOM",
            scopePolicy: data.scopePolicy,
            active: data.active === true,
          };
        });
        setStableState(setAccessGovernanceMatrix, matrix);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "accessGovernance")
    );
    console.info("SAFE LISTENER STARTED: accessGovernance");

    return () => {
      unsubscribeProducts();
      unsubscribePromotionGroups();
      unsubscribeKeyMessages();
      unsubscribeRolePermissions();
      unsubscribeAccessGovernance();
    };
  }, [authReady, firebaseUser?.uid, setStableState]);

  // Re-evaluate restored/current navigation whenever hydrated authorization
  // records or the canonical role changes. If no authorized fallback exists,
  // retain the route so SidebarPageRouter renders the access-denied state.
  useEffect(() => {
    if (!profileLoaded || !currentUser?.role) return;
    const resolved = resolveAuthorizedRestoredView({
      user: currentUser,
      rolePermissions: permissionsMatrix[currentUser.role],
      accessGovernance: accessGovernanceMatrix[currentUser.role],
    }, activeView, ["dashboard", "field-medical-planner", "pharmacies-list", "finance-approval-ledger", "admin-user-management"]);
    if (resolved && resolved !== activeView) setActiveView(resolved);
  }, [profileLoaded, currentUser, permissionsMatrix, accessGovernanceMatrix, activeView]);

  // 2. Users hydration: global only for Super Admin; otherwise canonical self + descendants.
  useEffect(() => {
    if (!authReady || !firebaseUser?.uid || !profileLoaded) return;

    let unsubscribeUsers = () => {};
    if (currentUser?.role === Role.SUPER_ADMIN) {
      unsubscribeUsers = listenCollection<User>("users", (records) => {
        setStableState(setUsers, records);
      });
      console.info("SAFE LISTENER STARTED: users (Global)");
    } else if (currentUser?.id && currentUser.id === firebaseUser.uid) {
      const userDocRef = doc(db, "users", currentUser.id);
      let cancelled = false;
      unsubscribeUsers = onSnapshot(userDocRef, async (docSnap) => {
        if (docSnap.exists()) {
          const u = { id: docSnap.id, ...docSnap.data() } as User;
          setCurrentUser((prev) => {
            if (JSON.stringify(prev) === JSON.stringify(u)) return prev;
            return u;
          });
          try {
            const hierarchy = await resolveSubordinateScope(firebaseUser.uid, { actor: u });
            if (!cancelled) setStableState(setUsers, hierarchy.allHierarchyUsers);
          } catch (err: any) {
            if (!cancelled) setStableState(setUsers, [u]);
            handleFirestoreError(err, OperationType.LIST, "users (canonical hierarchy)");
          }
        }
      }, (err) => {
        handleFirestoreError(err, OperationType.GET, `users/${currentUser.id}`);
      });
      console.info("SAFE LISTENER STARTED: users (Canonical Hierarchy)");
      return () => {
        cancelled = true;
        unsubscribeUsers();
      };
    }

    return () => unsubscribeUsers();
  }, [authReady, firebaseUser?.uid, currentUser?.id, currentUser?.role, profileLoaded, setStableState]);

  // 2b. Manager Hydration Listener (Non-Admin Manager Doc Read)
  useEffect(() => {
    if (!authReady || !firebaseUser?.uid || !profileLoaded || !currentUser?.id) {
      setManagerHydrated(false);
      return;
    }

    if (currentUser.role === Role.SUPER_ADMIN || !currentUser.managerId || !currentUser.managerId.trim()) {
      setCurrentManager(null);
      setManagerHydrated(true);
      console.info(
        "[MANAGER_HYDRATION_JSON]",
        JSON.stringify({
          currentUserId: currentUser.id,
          managerId: currentUser.managerId || null,
          managerHydrated: true,
          managerDocumentExists: false,
          managerUid: null,
          managerEmail: currentUser.managerEmail || null,
          managerRole: null,
          managerActive: true,
          errorCode: null
        })
      );
      return;
    }

    const managerId = currentUser.managerId.trim();
    setManagerHydrated(false);

    const mgrDocRef = doc(db, "users", managerId);
    const unsubscribeMgr = onSnapshot(
      mgrDocRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const mgr = { id: docSnap.id, ...docSnap.data() } as User;
          setCurrentManager(mgr);
          setManagerHydrated(true);
          console.info(
            "[MANAGER_HYDRATION_JSON]",
            JSON.stringify({
              currentUserId: currentUser.id,
              managerId: managerId,
              managerHydrated: true,
              managerDocumentExists: true,
              managerUid: mgr.id,
              managerEmail: mgr.email || null,
              managerRole: mgr.role || null,
              managerActive: mgr.active ?? true,
              errorCode: null
            })
          );
        } else {
          setCurrentManager(null);
          setManagerHydrated(true);
          console.info(
            "[MANAGER_HYDRATION_JSON]",
            JSON.stringify({
              currentUserId: currentUser.id,
              managerId: managerId,
              managerHydrated: true,
              managerDocumentExists: false,
              managerUid: managerId,
              managerEmail: currentUser.managerEmail || null,
              managerRole: null,
              managerActive: false,
              errorCode: "DOCUMENT_NOT_FOUND"
            })
          );
        }
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, `users/${managerId}`);
        setCurrentManager(null);
        setManagerHydrated(true);
        console.info(
          "[MANAGER_HYDRATION_JSON]",
          JSON.stringify({
            currentUserId: currentUser.id,
            managerId: managerId,
            managerHydrated: true,
            managerDocumentExists: false,
            managerUid: managerId,
            managerEmail: currentUser.managerEmail || null,
            managerRole: null,
            managerActive: false,
            errorCode: err.code || err.message
          })
        );
      }
    );

    return () => {
      unsubscribeMgr();
    };
  }, [authReady, firebaseUser?.uid, profileLoaded, currentUser?.id, currentUser?.managerId, currentUser?.role]);

  // 3. User Territory & Product Assignments Listeners
  useEffect(() => {
    if (!authReady || !firebaseUser?.uid || !profileLoaded) return;

    // Bootstrap hydration is always limited to the authenticated actor. Global
    // Super Admin assignment reads remain post-scope operational reads.
    const canHydrateGlobalAssignments = currentUser?.role === Role.SUPER_ADMIN
      && operationalScopeSession.status === "READY";
    if (canHydrateGlobalAssignments) {
      setTerritoryAssignmentsHydrated(false);
      setProductAssignmentsHydrated(false);
    }

    let unsubscribeUserTerritoryAssignments = () => {};
    if (canHydrateGlobalAssignments) {
      unsubscribeUserTerritoryAssignments = listenCollection<UserTerritoryAssignment>("userTerritoryAssignments", (records) => {
        setStableState(setUserTerritoryAssignments, records);
        setTerritoryAssignmentsHydrated(true);
      });
      console.info("SAFE LISTENER STARTED: userTerritoryAssignments (Global)");
    } else if (currentUser?.id) {
      const q = query(
        collection(db, "userTerritoryAssignments"),
        where("userId", "==", currentUser.id)
      );
      unsubscribeUserTerritoryAssignments = onSnapshot(q, (snap) => {
        const records: UserTerritoryAssignment[] = [];
        snap.forEach((doc) => {
          records.push({ id: doc.id, ...doc.data() } as any);
        });
        setStableState(setUserTerritoryAssignments, records);
        setTerritoryAssignmentsHydrated(true);
      }, (err) => {
        handleFirestoreError(err, OperationType.LIST, "userTerritoryAssignments");
        setTerritoryAssignmentsHydrated(false);
      });
      console.info("SAFE LISTENER STARTED: userTerritoryAssignments (User Scoped)");
    }

    let unsubscribeUserProductAssignments = () => {};
    if (canHydrateGlobalAssignments) {
      unsubscribeUserProductAssignments = listenCollection<UserProductAssignment>("userProductAssignments", (records) => {
        setStableState(setUserProductAssignments, records);
        setProductAssignmentsHydrated(true);
      });
      console.info("SAFE LISTENER STARTED: userProductAssignments (Global)");
    } else if (currentUser?.id) {
      const q = query(
        collection(db, "userProductAssignments"),
        where("userId", "==", currentUser.id)
      );
      unsubscribeUserProductAssignments = onSnapshot(q, (snap) => {
        const records: UserProductAssignment[] = [];
        snap.forEach((doc) => {
          records.push({ id: doc.id, ...doc.data() } as any);
        });
        setStableState(setUserProductAssignments, records);
        setProductAssignmentsHydrated(true);
      }, (err) => {
        handleFirestoreError(err, OperationType.LIST, "userProductAssignments");
        setProductAssignmentsHydrated(false);
      });
      console.info("SAFE LISTENER STARTED: userProductAssignments (User Scoped)");
    }

    return () => {
      unsubscribeUserTerritoryAssignments();
      unsubscribeUserProductAssignments();
    };
  }, [authReady, firebaseUser?.uid, currentUser?.id, currentUser?.role, profileLoaded, operationalScopeSession.status, setStableState]);

  // 4. Import History Listener (visit history migrated in WP5.2F.5A/F.5B)
  useEffect(() => {
    if (!authReady || !firebaseUser?.uid || !profileLoaded) return;

    if (!isOperational) {
      console.info(
        "[NON_OPERATIONAL_LISTENER_GATE_JSON]",
        JSON.stringify({
          uid: currentUser?.id,
          role: currentUser?.role,
          operational: false,
          listenersAttempted: ["physicians", "physicianVisits", "pharmacyVisits", "importHistory"],
          listenersBlocked: ["physicians", "physicianVisits", "pharmacyVisits", "importHistory"],
          gateCondition: "isOperational === false"
        })
      );
      return;
    }

    let unsubscribeImportHistory = () => {};
    if (currentUser?.role === Role.SUPER_ADMIN) {
      unsubscribeImportHistory = listenCollection<ImportHistoryType>("importHistory", (records) => {
        setStableState(setImportHistory, records);
      });
      console.info("SAFE LISTENER STARTED: importHistory");
    } else if (currentUser && (
      currentUser.role === Role.ADMIN ||
      currentUser.role === Role.MEDICAL_SUPERVISOR ||
      currentUser.role === Role.SALES_SUPERVISOR ||
      currentUser.role === Role.AREA_SALES_MANAGER ||
      currentUser.role === Role.REGIONAL_MANAGER ||
      currentUser.role === Role.COUNTRY_MANAGER ||
      currentUser.role === Role.GENERAL_MANAGER ||
      currentUser.role === Role.SALES_MARKETING_MANAGER ||
      currentUser.role === Role.MARKETING_MANAGER
    )) {
      const q = query(
        collection(db, "importHistory"),
        where("isDeleted", "==", false)
      );
      unsubscribeImportHistory = onSnapshot(q, (snap) => {
        const records: ImportHistoryType[] = [];
        snap.forEach((doc) => {
          records.push({ id: doc.id, ...doc.data() } as ImportHistoryType);
        });
        setStableState(setImportHistory, records);
      }, (err) => {
        handleFirestoreError(err, OperationType.LIST, "importHistory");
      });
      console.info("SAFE LISTENER STARTED: importHistory");
    }

    return () => {
      unsubscribeImportHistory();
    };
  }, [authReady, firebaseUser?.uid, currentUser?.id, currentUser?.role, normalizedRole, profileLoaded, isOperational, setStableState, userTerritoryAssignments, resolvedAreaIds, resolvedAreaKey, assignmentsHydrated]);

  // WP5.2F.4 pharmacy directory/profile READ. This is the only pharmacy
  // retrieval path and it never falls back to a direct Firestore listener.
  useEffect(() => {
    pharmacyReadController.clear();
    setStableState(setPharmacies, []);
    if (
      !authReady
      || !firebaseUser?.uid
      || !profileLoaded
      || operationalScopeSession.status !== "READY"
      || !canAccessCanonicalView({
        user: currentUser,
        rolePermissions: permissionsMatrix[currentUser.role],
        accessGovernance: accessGovernanceMatrix[currentUser.role],
      }, "pharmacies-list")
    ) return;

    let cancelled = false;
    void pharmacyReadController.load(firebaseUser.uid, firebaseUser).then(() => {
      if (cancelled) return;
      const state = pharmacyReadController.getState();
      if (state.status === "READY" && state.actorUid === firebaseUser.uid) {
        setStableState(setPharmacies, state.pharmacies);
        setSessionLoadingSteps((previous) => previous.map((step) => step.id === "pharmacies"
          ? { ...step, status: "done", extra: `${state.pharmacies.length} Pharmacies` }
          : step));
      } else {
        setStableState(setPharmacies, []);
      }
    });

    return () => {
      cancelled = true;
      pharmacyReadController.clear();
      setStableState(setPharmacies, []);
    };
  }, [
    authReady,
    firebaseUser?.uid,
    profileLoaded,
    operationalScopeSession.status,
    currentUser,
    permissionsMatrix,
    pharmacyReadController,
    setStableState,
  ]);
  // Stage 2 Pipeline Trace Tracker
  useEffect(() => {
    console.info("[PHARMACY_PIPELINE_TRACE]", {
      stage: "2. App State",
      count: pharmacies.length,
      targetIdPresent: pharmacies.some(r => r.id === "PHM-TAJOURA-A"),
      exclusionReason: pharmacies.some(r => r.id === "PHM-TAJOURA-A") ? undefined : "Missing in App state"
    });
  }, [pharmacies]);

  const resetUserSession = () => {
    setCurrentUser(neutralUser);
    setProfileLoaded(false);
    setPermissionsReady(false);
    setPolicyReady(false);
    setSessionHydrationComplete(false);
    operationalScopeController.clear();
    physicianReadController.clear();
    pharmacyReadController.clear();
    physicianVisitReadController.clear();
    pharmacyVisitReadController.clear();
    setInitError(null);
    setLastAuthUid(null);
    setIsBannerAcknowledged(false);

    setUsers([]);
    setPhysicians([]);
    setPharmacies([]);
    setProducts([]);
    setUserTerritoryAssignments([]);
    setUserProductAssignments([]);
    setTerritoryAssignmentsHydrated(false);
    setProductAssignmentsHydrated(false);
    setPhysicianVisits([]);
    setPharmacyVisits([]);
    setActiveView("dashboard");
    logDiagnostic("Session state cleared and reset");
  };

  // Load and resolve the complete authenticated user context (role, permissions, hierarchy, territories, and assignments)
  const loadUserScopeAndAssignments = async (authUser: any, currentLang: "en" | "ar") => {
    logDiagnostic("Initialization started");
    setIsSessionInitializing(true);
    setInitError(null);
    
    const steps = [
      { id: "auth", label: currentLang === "ar" ? "التحقق من جلسة المصادقة الآمنة" : "Verify Secure Session Persistence", status: "loading", extra: "" },
      { id: "profile", label: currentLang === "ar" ? "تحميل ملف المستخدم والدور التشغيلي" : "Load User Profile & Role", status: "pending", extra: "" },
      { id: "operational-scope", label: currentLang === "ar" ? "تحديد نطاق التشغيل المعتمد" : "Resolve Canonical Operational Scope", status: "pending", extra: "" },
      { id: "permissions", label: currentLang === "ar" ? "تطبيق مصفوفة الصلاحيات الديناميكية" : "Load Dynamically Assigned Permissions", status: "pending", extra: "" },
      { id: "hierarchy", label: currentLang === "ar" ? "تحديد الهيكل الإداري والمرؤوسين المباشرين" : "Resolve Reporting Line Hierarchy", status: "pending", extra: "" },
      { id: "territories", label: currentLang === "ar" ? "تحديث الأقاليم والمسارات الجغرافية" : "Load Assigned Territories & Geography", status: "pending", extra: "" },
      { id: "products", label: currentLang === "ar" ? "توزيع خطوط الأدوية والمستحضرات المعتمدة" : "Map Assigned Product Lines & Brands", status: "pending", extra: "" },
      { id: "physicians", label: currentLang === "ar" ? "مزامنة قائمة الأطباء المعتمدين والمستهدفين" : "Sync Assigned Clinic Physicians", status: "pending", extra: "" },
      { id: "pharmacies", label: currentLang === "ar" ? "ربط الصيدليات وحدود التسهيلات الائتمانية" : "Align Assigned Pharmacy Accounts", status: "pending", extra: "" }
    ];
    setSessionLoadingSteps(steps);

    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
    const markProfileLoadError = (message: string) => {
      setSessionLoadingSteps(prev => prev.map(s => s.id === "profile" ? { ...s, status: "error", extra: message } : s));
      setProfileLoaded(false);
      setIsSessionInitializing(false);
    };
    const firebaseAuthUid = authUser?.uid;
    const appletIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const profileLoadTimeout = window.setTimeout(() => {
      const message = `Profile loading timeout: users/${firebaseAuthUid || "missing"} did not complete`;
      console.error(message);
      markProfileLoadError(message);
      setInitError({ step: "profile", message });
    }, 15000);
    const traceAwait = async <T,>(label: string, promise: Promise<T>): Promise<T> => {
      try {
        return await promise;
      } catch (error) {
        console.error(`${label} exception`, error);
        throw error;
      }
    };
    const authEmail = (authUser.email || "").trim().toLowerCase();

    let currentStepId = "auth";
    try {
      // Step 1: Secure auth session verification
      currentStepId = "auth";
      await traceAwait("TRACE await wait auth", wait(180));
      setSessionLoadingSteps(prev => prev.map(s => s.id === "auth" ? { ...s, status: "done", extra: "Verified" } : s.id === "profile" ? { ...s, status: "loading" } : s));
      logDiagnostic("Auth resolved");

      // Step 2: Load User Profile & Role from Firestore 'users'
      currentStepId = "profile";
      console.info("AUTH UID CHECK", {
        authUserUid: firebaseAuthUid,
        authUserEmail: authUser.email
      });
      if (!firebaseAuthUid || appletIdPattern.test(firebaseAuthUid)) {
        throw new Error("Invalid Firebase Auth UID source");
      }
      const userDocRef = doc(db, "users", firebaseAuthUid);
      console.info("TRACE 3 - user document reference created", `users/${firebaseAuthUid}`);
      
      let userDocSnap;
      try {
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          console.info("TRACE 4 - getDoc started", { attempt });
          userDocSnap = await traceAwait("TRACE getDoc users profile", getDoc(userDocRef));
          console.info("TRACE 5 - getDoc finished", userDocSnap);
          if (userDocSnap.exists()) break;

          if (!userDocSnap.exists()) {
            console.info("[First Login Claim] Invoking trusted backend claim-activation for UID:", firebaseAuthUid);
            const idToken = await authUser.getIdToken();
            const claimRes = await claimActivationViaBackend(idToken);

            if (claimRes.success) {
              userDocSnap = await getDoc(userDocRef);
              if (userDocSnap && userDocSnap.exists()) break;
            } else if (claimRes.status === "IDENTITY_CONFLICT") {
              throw new Error(`Identity Account Conflict: A user record exists for '${authEmail}' under another ID. Automatic repair is stopped to protect data integrity. Please contact an Administrator.`);
            } else if (claimRes.error) {
              console.warn("[First Login Claim] Backend claim response:", claimRes);
            }
          }

          await traceAwait("TRACE await profile link retry", wait(500));
        }
      } catch (error) {
        console.error("TRACE getDoc exception", error);
        handleFirestoreError(error, OperationType.GET, `users/${firebaseAuthUid}`);
        throw error;
      }
      console.info(`TRACE 6 - document exists = ${Boolean(userDocSnap && userDocSnap.exists())}`);

      if (!userDocSnap || !userDocSnap.exists()) {
        throw new Error(`User profile not found: users/${firebaseAuthUid}. Complete signup/linking before normal login.`);
      }

      const profileData = userDocSnap.data() as User;
      console.info("TRACE 7 - profile validation started", profileData);

      if (profileData.id !== firebaseAuthUid) {
        throw new Error(`Invalid user profile: id must match authenticated uid '${firebaseAuthUid}'.`);
      }

      if ((profileData.email || "").toLowerCase() !== authEmail) {
        throw new Error(`Invalid user profile: email must match authenticated email '${authUser.email}'.`);
      }
      if (!profileData.role) {
        throw new Error("Invalid user profile: role is required.");
      }

      // WP5.2F.1 canonical session bootstrap. Business-data listeners retain their
      // existing query and filtering paths until their later migration increments.
      currentStepId = "operational-scope";
      setCurrentUser(profileData);
      setUserTerritoryAssignments([]);
      setUserProductAssignments([]);
      setTerritoryAssignmentsHydrated(false);
      setProductAssignmentsHydrated(false);
      setSessionLoadingSteps(prev => prev.map(s =>
        s.id === "profile"
          ? { ...s, status: "done", extra: profileData.role }
          : s.id === "operational-scope"
            ? { ...s, status: "loading" }
            : s
      ));
      // Query territory and product assignments for this user to ensure we look at the canonical source of truth
      let tempTerritories: UserTerritoryAssignment[] = [];
      let tempProducts: UserProductAssignment[] = [];
      let territoryAssignmentsLoaded = enableMockData;
      let productAssignmentsLoaded = enableMockData;
      
      if (!enableMockData) {
        try {
          const territoryQuery = query(
            collection(db, "userTerritoryAssignments"),
            where("userId", "==", firebaseAuthUid)
          );
          const territorySnap = await getDocs(territoryQuery);
          territorySnap.forEach((doc) => {
            const data = doc.data();
            if (data && data.status === "Active") {
              tempTerritories.push({ id: doc.id, ...data } as any);
            }
          });
          territoryAssignmentsLoaded = true;

          const productQuery = query(
            collection(db, "userProductAssignments"),
            where("userId", "==", firebaseAuthUid)
          );
          const productSnap = await getDocs(productQuery);
          productSnap.forEach((doc) => {
            const data = doc.data();
            if (data && data.status === "Active") {
              tempProducts.push({ id: doc.id, ...data } as any);
            }
          });
          productAssignmentsLoaded = true;
        } catch (err) {
          console.error("Failed to pre-fetch user assignments", err);
        }
      } else {
        // Fallback to mock data
        tempTerritories = INITIAL_USER_TERRITORY_ASSIGNMENTS.filter(t => t.userId === firebaseAuthUid && t.status === "Active");
        tempProducts = INITIAL_USER_PRODUCT_ASSIGNMENTS.filter(p => p.userId === firebaseAuthUid && p.status === "Active");
      }

      setUserTerritoryAssignments(tempTerritories);
      setUserProductAssignments(tempProducts);
      setTerritoryAssignmentsHydrated(territoryAssignmentsLoaded);
      setProductAssignmentsHydrated(productAssignmentsLoaded);

      // Assignment evidence required by readiness is hydrated first. Resource
      // authority remains a separate fail-closed backend decision.
      await operationalScopeController.bootstrap(firebaseAuthUid, authUser);
      const canonicalSession = operationalScopeController.getState();
      setSessionLoadingSteps(prev => prev.map(s =>
        s.id === "operational-scope"
          ? {
              ...s,
              status: "done",
              extra: canonicalSession.status === "READY"
                ? canonicalSession.scope?.boundaryKind || "Bounded"
                : `Resource ${canonicalSession.status}`,
            }
          : s.id === "permissions"
            ? { ...s, status: "loading" }
            : s
      ));

      const checkActive = profileData.active === true;
      const checkRole = profileData.role && (profileData.role as string) !== "Pending Approval";
      const checkNotDeleted = profileData.isDeleted !== true;

      const checkEmployment = profileData.employmentStatus === "Active";
      // Assignment completeness belongs exclusively to getReadiness(); duplicating
      // role checks here created a competing bootstrap policy before hydration.
      const hasAccess = checkActive && checkEmployment && checkRole && checkNotDeleted;

      if (!hasAccess) {
        console.info("PROFILE LOAD SUCCESS (ACCESS DENIED)", {
          uid: authUser.uid,
          email: authUser.email,
          role: profileData.role,
          active: profileData.active,
          employmentStatus: profileData.employmentStatus,
          access: "Blocked"
        });
        setCurrentUser(profileData);
        setProfileLoaded(true);
        await traceAwait("TRACE await wait pending profile", wait(180));
        setSessionLoadingSteps(prev => prev.map(s => s.id === "profile" ? { ...s, status: "done", extra: profileData?.employmentStatus || "Blocked" } : s));
        logDiagnostic("Profile loaded (access denied)");

        setPermissionsReady(true);
        setPolicyReady(true);
        setSessionHydrationComplete(true);
        return;
      }

      setCurrentUser(profileData);
      setProfileLoaded(true);
      await traceAwait("TRACE await wait active profile", wait(180));
      logDiagnostic("Profile loaded");

      // Step 3: Permissions
      currentStepId = "permissions";
      await traceAwait("TRACE await wait permissions", wait(180));
      setSessionLoadingSteps(prev => prev.map(s => s.id === "permissions" ? { ...s, status: "done", extra: "Active" } : s.id === "hierarchy" ? { ...s, status: "loading" } : s));
      setPermissionsReady(true);
      logDiagnostic("Permissions loaded");

      // Step 4: Hierarchy
      currentStepId = "hierarchy";
      const subordinates = getDirectReports(users, profileData);
      await traceAwait("TRACE await wait hierarchy", wait(180));
      setSessionLoadingSteps(prev => prev.map(s => s.id === "hierarchy" ? { ...s, status: "done", extra: `${subordinates.length} Direct Reports` } : s.id === "territories" ? { ...s, status: "loading" } : s));
      logDiagnostic("Hierarchy ready", { subordinateCount: subordinates.length });

      // Step 5: Territories
      currentStepId = "territories";
      const assignedTerritories = profileData.territories || [profileData.territory].filter(t => t && t !== "-");
      await traceAwait("TRACE await wait territories", wait(180));
      setSessionLoadingSteps(prev => prev.map(s => s.id === "territories" ? { ...s, status: "done", extra: `${assignedTerritories.length} Territories` } : s.id === "products" ? { ...s, status: "loading" } : s));
      logDiagnostic("Geography ready", { assignedTerritories });

      // Step 6: Assigned Products
      currentStepId = "products";
      const userProducts = filterBySecurity(profileData, products, "territoryId", "id", "repId", userTerritoryAssignments, userProductAssignments);
      await traceAwait("TRACE await wait products", wait(180));
      setSessionLoadingSteps(prev => prev.map(s => s.id === "products" ? { ...s, status: "done", extra: `${userProducts.length} Products` } : s.id === "physicians" ? { ...s, status: "loading" } : s));
      logDiagnostic("Products ready", { productCount: userProducts.length });

      // Step 7: Sync Assigned Physicians
      currentStepId = "physicians";
      const userPhysicians = filterBySecurity(profileData, physicians, "territory", "primaryBrand", "assignedRepId", userTerritoryAssignments, userProductAssignments);
      await traceAwait("TRACE await wait physicians", wait(180));
      setSessionLoadingSteps(prev => prev.map(s => s.id === "physicians" ? { ...s, status: "done", extra: `${userPhysicians.length} Physicians` } : s.id === "pharmacies" ? { ...s, status: "loading" } : s));
      logDiagnostic("Physicians ready", { physicianCount: userPhysicians.length });

      // Step 8: Align Pharmacy Accounts
      currentStepId = "pharmacies";
      setSessionLoadingSteps(prev => prev.map(s => s.id === "pharmacies" ? { ...s, status: "loading" } : s));

      setPolicyReady(true);
      logDiagnostic("Policy ready");

      setSessionHydrationComplete(true);
      logDiagnostic("Session ready");
      clearFirestoreError();

      await traceAwait("TRACE await wait audit login", wait(220));
      handleLogAudit("Login", "Auth", `Secure session established for ${profileData.name} (${profileData.role}) via cloud authentication.`);

      // Restore activeView or find first permitted view
      let targetView = activeView;
      const accessContext = {
        user: profileData,
        rolePermissions: permissionsMatrix[profileData.role],
        accessGovernance: accessGovernanceMatrix[profileData.role],
      };
      targetView = resolveAuthorizedRestoredView(
        accessContext,
        targetView,
        ["dashboard", "field-medical-planner", "pharmacies-list", "finance-approval-ledger", "admin-user-management"],
      ) || targetView;
      setActiveView(targetView);
      logDiagnostic("View selection completed", { resolvedView: targetView });
    } catch (err: any) {
      console.error("[Session Load Error]", err);
      const errCode = err?.code || "unknown";
      let classification = "unknown";
      const errMsg = getErrorMessage(err);
      const lowercaseCode = String(errCode).toLowerCase();
      const lowercaseMsg = String(errMsg).toLowerCase();

      if (lowercaseCode === 'permission-denied' || lowercaseMsg.includes('permission-denied') || lowercaseMsg.includes('permission denied')) {
        classification = 'permission-denied';
      } else if (lowercaseCode === 'unavailable' || lowercaseMsg.includes('offline') || lowercaseMsg.includes('unavailable')) {
        classification = 'unavailable';
      } else if (lowercaseCode === 'not-found' || lowercaseMsg.includes('not-found') || lowercaseMsg.includes('not found')) {
        classification = 'not-found';
      } else if (lowercaseCode === 'deadline-exceeded' || lowercaseMsg.includes('timeout') || lowercaseMsg.includes('deadline-exceeded')) {
        classification = 'deadline-exceeded';
      }

      setInitError({ 
        step: currentStepId, 
        message: errMsg,
        code: errCode,
        classification,
        path: currentStepId === "profile" ? `users/${firebaseAuthUid || "unknown"}` : undefined
      });
      markProfileLoadError(errMsg);
    } finally {
      window.clearTimeout(profileLoadTimeout);
      setIsSessionInitializing(false);
    }
  };

  // Monitor Firebase Authentication state
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      logDiagnostic("Auth status changed", { hasUser: !!user, uid: user?.uid });
      if (user) {
        setFirebaseUser(user);
        setAuthReady(true);
        if (user.uid !== lastAuthUid) {
          resetUserSession();
          setLastAuthUid(user.uid);
          await loadUserScopeAndAssignments(user, lang);
        }
      } else {
        setFirebaseUser(null);
        setAuthReady(true);
        resetUserSession();
        if (enableMockData) {
          setCurrentUser(initialUsers[0]);
          setUsers(initialUsers);
          setPhysicians(initialPhysicians);
          setPharmacies(initialPharmacies);
          setProducts(initialProducts);
          setProfileLoaded(true);
          setPermissionsReady(true);
          setPolicyReady(true);
          setSessionHydrationComplete(true);
          logDiagnostic("Sandbox mode initialized");
        }
      }
    });

    return () => unsubscribeAuth();
  }, [lastAuthUid, lang, enableMockData]);

  // Temporary development-only diagnostic logging for Physician and Specialty data sources
  useEffect(() => {
    const isFirestoreSource = physicians.some(p => p.id === "PHY-001" || p.id === "PHY-002" || p.id === "PHY-003" || p.id === "test");
    const physicianSource = isFirestoreSource ? "Firestore" : (enableMockData ? "Mock" : "Empty/Firestore");

    const isSpecialtyFirestoreSource = !enableMockData;
    const specialtySource = enableMockData ? "Explicit Demo" : "Firestore";

    console.info(`%c[Physician Directory Source]
Source: ${physicianSource}
Collection: physicians
Cloud Records: ${isFirestoreSource ? physicians.length : 0}
Mock Records: ${!isFirestoreSource && enableMockData ? initialPhysicians.length : 0}
Cached Records: 0
Final Displayed Records: ${physicians.length}

[Specialty Registry Source]
Source: ${specialtySource}
Collection: physicianSpecialties
Cloud Specialties: ${isSpecialtyFirestoreSource ? physicianSpecialties.length : 0}
Fallback Specialties: ${!isSpecialtyFirestoreSource && enableMockData ? initialPhysicianSpecialties.length : 0}
Final Options: ${physicianSpecialties.length}`, "color: #10b981; font-weight: bold;");
  }, [physicians, physicianSpecialties, enableMockData]);

  const isRtl = lang === "ar";

  // Helper to log a secure audit entry directly to Firestore
  const handleLogAudit = async (action: string, entity: string, details: string) => {
    const auditUserId = auth.currentUser?.uid || currentUser.id;
    const newLog: AuditLog = {
      id: `AL-${Math.floor(1000 + Math.random() * 9000)}`,
      timestamp: new Date().toISOString().replace("T", " ").substring(0, 19) + " UTC",
      userId: auditUserId,
      userName: currentUser.name,
      action,
      entityType: entity,
      entityName: entity,
      details
    };
    try {
      await saveAuditLogRecord(newLog);
    } catch (e) {
      console.error("[Firestore] Error writing audit log:", e);
      // fallback local
      setAuditLogs(prev => [newLog, ...prev]);
    }
  };

  // Switch Active Rep Role Helper (Instant RBAC sandbox previewing!)
  const handleUserSwap = (userId: string) => {
    const found = users.find(u => u.id === userId);
    if (found) {
      setCurrentUser(found);
      handleLogAudit("Switch", "Profile", `Impersonated security role: '${found.role}' (${found.name})`);
    }
  };

  // Completion Callbacks for Detailing Visit
  const handleCompletePhysicianVisit = async (visit: PhysicianVisitType): Promise<PhysicianVisitCompletionResult> => {
    try {
      const result = await savePhysicianVisitRecord(visit, currentUser.id, currentUser.name, currentUser.role);
      if (result.status === "COMPLETED") {
        if (firebaseUser?.uid) {
          try {
            const refreshedVisits = await refreshScopedPhysicianVisitHistory(
              physicianVisitReadController,
              firebaseUser.uid,
              firebaseUser,
            );
            setStableState(setPhysicianVisits, refreshedVisits);
          } catch (refreshError) {
            console.error("[Firestore] Physician visit saved, but visit history refresh failed:", refreshError);
          }
        }
      }
      return result;
    } catch (e) {
      console.error("[Firestore] Error completing physician visit:", e);
      throw e;
    }
  };

  // Completion Callbacks for Pharmacy Visit
  const handleCompletePharmacyVisit = async (visit: PharmacyVisitType) => {
    try {
      await savePharmacyVisitRecord(visit, currentUser.id, currentUser.name, currentUser.role);
      
      // If visit contains items (order intake), create a commercial order record following canonical WP7.1 workflow
      if (visit.items && visit.items.length > 0) {
        const orderTotal = visit.netAmount || visit.totalAmount;
        const now = new Date().toISOString();
        const generatedId = `ORD-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;

        const orderItems = visit.items.map((item, idx) => ({
          id: `ITEM-${idx + 1}-${Date.now()}`,
          name: item.productName || "Product",
          quantity: item.quantity,
          price: item.price || 0,
          total: (item.price || 0) * item.quantity
        }));

        const submissionHistoryEntry = {
          transitionId: `TR_${Date.now()}_SUBMIT`,
          orderId: generatedId,
          orderDisplayNumber: generatedId,
          fromStatus: "DRAFT" as const,
          toStatus: "PENDING_FINANCE_REVIEW" as const,
          fromStage: "DRAFT" as const,
          toStage: "FINANCE_REVIEW" as const,
          action: "SUBMIT",
          actorUid: currentUser.id || "SYS",
          actorName: currentUser.name || "Sales Representative",
          actorGeneralRole: String(currentUser.role),
          orderCapabilityUsed: "ORDER_SUBMIT",
          comments: `Order submitted via Pharmacy Visit ${(visit as any).visitNumber || visit.displayNumber || visit.id}`,
          reasonCode: "OK",
          createdAt: now,
          source: "WEB" as const
        };

        const newOrder = {
          id: generatedId,
          displayNumber: getOrderBusinessNumber({ id: generatedId }, 100),
          visitId: visit.id,
          visitDisplayNumber: (visit as any).visitNumber || visit.displayNumber || visit.id,
          pharmacyId: visit.pharmacyId,
          pharmacyName: visit.pharmacyName,
          pharmacyNameSnapshot: visit.pharmacyName,
          pharmacyAddress: "Assigned Pharmacy Territory Area",
          createdByUid: currentUser.id,
          createdByName: currentUser.name,
          salesRepUid: currentUser.id,
          salesRep: visit.repName || currentUser.name,
          date: new Date(visit.visitDate || Date.now()).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
          total: orderTotal,
          subtotal: (visit as any).totalAmount || orderTotal,
          discount: (visit as any).discountAmount || 0,
          netTotal: orderTotal,
          paidStatus: ((visit.paymentCollected && visit.paymentCollected >= orderTotal) ? "Paid" : "Unpaid") as "Paid" | "Unpaid",
          paidAmount: visit.paymentCollected || 0,
          stage: "FINANCE_REVIEW" as const,
          status: "PENDING_FINANCE_REVIEW" as const,
          reservationStatus: "RESERVED",
          submittedAt: now,
          submittedByUid: currentUser.id,
          items: orderItems,
          notes: (visit as any).notes || (visit as any).remarks || "",
          createdAt: now,
          updatedAt: now,
          version: 1,
          history: [submissionHistoryEntry]
        };

        try {
          await saveOrder(newOrder as any, currentUser.id);
        } catch (e) {
          console.error("[Firestore] Error saving order:", e);
        }

        handleLogAudit(
          "Create",
          "Order",
          `Initiated canonical commercial workflow for order ${newOrder.displayNumber} at ${newOrder.pharmacyName}. Initial Stage: FINANCE_REVIEW (Status: PENDING_FINANCE_REVIEW).`
        );
      } else {
        handleLogAudit(
          "Order",
          "Pharmacies",
          `Registered visit purpose '${visit.visitPurpose}' at ${visit.pharmacyName}. Order total: $${visit.netAmount || 0}. Outstanding balance remaining: $${visit.outstandingBalanceAfter}.`
        );
      }
    } catch (e) {
      console.error("[Firestore] Error completing pharmacy visit:", e);
    }
  };

  const handleAddPhysician = async (newPhys: Physician) => {
    try {
      const { id: _clientId, creationIdempotencyKey, ...physician } = newPhys as Physician & { creationIdempotencyKey?: string };
      const idempotencyKey = creationIdempotencyKey || _clientId;
      const result = await createPhysicianAuthoritatively(auth.currentUser, idempotencyKey, physician as Omit<Physician, "id">);
      if (result.status === "DUPLICATE_CANDIDATES") throw new Error(`DUPLICATE_CANDIDATES:${result.candidates.map(candidate => candidate.id).join(",")}`);
      handleLogAudit("Create", "Physicians", `Added new physician Dr. ${newPhys.name} in region ${newPhys.region || ""}.`);
    } catch (e) {
      console.error("[Firestore] Error saving physician:", e);
      throw e;
    }
  };

  const handleUpdatePhysician = async (updatedPhys: Physician) => {
    try {
      await savePhysician(updatedPhys, currentUser.id);
      handleLogAudit("Update", "Physicians", `Updated physician parameters for Dr. ${updatedPhys.name}.`);
    } catch (e) {
      console.error("[Firestore] Error updating physician:", e);
      throw e;
    }
  };

  const handleDeletePhysician = async (physId: string) => {
    try {
      await deletePhysicianRecord(physId, currentUser.id);
      handleLogAudit("Delete", "Physicians", `Purged/Deactivated physician master record with ID: ${physId}.`);
    } catch (e) {
      console.error("[Firestore] Error deleting physician:", e);
    }
  };

  const handleAddPharmacy = async (newPharm: Pharmacy) => {
    try {
      await savePharmacy(newPharm, currentUser.id);
      handleLogAudit("Create", "Pharmacies", `Added new pharmacy ${newPharm.name} in region ${newPharm.region}.`);
    } catch (e) {
      console.error("[Firestore] Error saving pharmacy:", e);
    }
  };

  const handleUpdatePharmacy = async (updatedPharm: Pharmacy) => {
    try {
      await savePharmacy(updatedPharm, currentUser.id);
      handleLogAudit("Update", "Pharmacies", `Updated pharmacy master details for ID: ${updatedPharm.id}.`);
    } catch (e) {
      console.error("[Firestore] Error updating pharmacy:", e);
    }
  };

  const handleDeletePharmacy = async (pharmId: string) => {
    try {
      await deletePharmacyRecord(pharmId, currentUser.id);
      handleLogAudit("Delete", "Pharmacies", `Purged/Deactivated pharmacy master record with ID: ${pharmId}.`);
    } catch (e) {
      console.error("[Firestore] Error deleting pharmacy:", e);
    }
  };

  const handleAddProduct = async (newProd: Product) => {
    try {
      const savedProduct = await saveProduct(newProd, currentUser.id, "create");
      setProducts((prev) => {
        const filtered = prev.filter(p => p.id !== savedProduct.id);
        return [savedProduct, ...filtered];
      });
      handleLogAudit("Create", "Products", `Added new product SKU ${newProd.name} under brand ${newProd.brand}.`);
      return { success: true, mode: "cloud" };
    } catch (e: any) {
      if (!isRetryableProductPersistenceError(e)) throw e;
      console.warn("[Firestore] Cloud save failed, trying local offline sync queue fallback:", e);
      try {
        const pendingProd = { ...newProd, syncStatus: "pending" };
        enqueueOfflineWrite("products", "create", pendingProd, currentUser.id, currentUser.name, currentUser.role);
        setProducts((prev) => {
          const filtered = prev.filter(p => p.id !== newProd.id);
          return [pendingProd, ...filtered];
        });
        handleLogAudit("Create", "Products", `Added new product SKU ${newProd.name} (Offline Pending Sync).`);
        return { success: true, mode: "local", error: e };
      } catch (queueErr: any) {
        console.error("[Offline Queue] Local queue write failed:", queueErr);
        console.error("CRITICAL FAILURE: Products create failed on both cloud and local queue.", {
          collection: "products",
          operation: "create",
          errorCode: e?.code || "UNKNOWN",
          errorMessage: e?.message || String(e)
        });
        throw new Error(e?.message || "Cloud connection failed and local queue is unavailable.");
      }
    }
  };

  const handleUpdateProduct = async (updatedProd: Product) => {
    try {
      const savedProduct = await saveProduct(updatedProd, currentUser.id, "edit");
      setProducts((prev) => {
        return prev.map(p => p.id === savedProduct.id ? savedProduct : p);
      });
      handleLogAudit("Update", "Products", `Updated product SKU ${updatedProd.name}.`);
      return { success: true, mode: "cloud" };
    } catch (e: any) {
      if (!isRetryableProductPersistenceError(e)) throw e;
      console.warn("[Firestore] Cloud update failed, trying local offline sync queue fallback:", e);
      try {
        const pendingProd = { ...updatedProd, syncStatus: "pending" };
        enqueueOfflineWrite("products", "update", pendingProd, currentUser.id, currentUser.name, currentUser.role);
        setProducts((prev) => {
          return prev.map(p => p.id === updatedProd.id ? pendingProd : p);
        });
        handleLogAudit("Update", "Products", `Updated product SKU ${updatedProd.name} (Offline Pending Sync).`);
        return { success: true, mode: "local", error: e };
      } catch (queueErr: any) {
        console.error("[Offline Queue] Local queue write failed:", queueErr);
        console.error("CRITICAL FAILURE: Products update failed on both cloud and local queue.", {
          collection: "products",
          operation: "update",
          errorCode: e?.code || "UNKNOWN",
          errorMessage: e?.message || String(e)
        });
        throw new Error(e?.message || "Cloud connection failed and local queue is unavailable.");
      }
    }
  };

  const handleDeleteProduct = async (prodId: string) => {
    try {
      await deleteProductRecord(prodId, currentUser.id);
      handleLogAudit("Delete", "Products", `Deleted product SKU ID ${prodId}.`);
    } catch (e) {
      console.error("[Firestore] Error deleting product:", e);
    }
  };

  // Handle Master Import Commit & Duplication Check (Persisted in Firestore)
  const handleImportSuccess = async (
    module: "Users" | "Physicians" | "Pharmacies" | "Products" | "Key Messages" | "Area Import (Geographic Master)",
    importedRecords: any[],
    importMode: "UPSERT" | "CREATE_NEW_ONLY" | "UPDATE_EXISTING_ONLY" = "UPSERT"
  ): Promise<{
    success: boolean;
    status?: "COMPLETED" | "PARTIAL" | "FAILED";
    attemptedCount?: number;
    createdCount?: number;
    updatedCount?: number;
    reactivatedCount?: number;
    skippedCount?: number;
    failedCount?: number;
    persistedDocumentIds?: string[];
    errors?: string[];
    error?: string;
    rowResults?: ImportedUserRowResult[];
  }> => {
    const newHistoryId = `IMP-${Math.floor(100 + Math.random() * 900)}`;
    const newHistory: ImportHistoryType = {
      id: newHistoryId,
      fileName: `${module.toLowerCase()}_worksheet_${new Date().toISOString().split("T")[0]}.csv`,
      module,
      recordCount: importedRecords.length,
      importedBy: currentUser.name,
      importedAt: new Date().toISOString().replace("T", " ").substring(0, 16),
      status: "Completed",
      recordsBackup: [] // Filled dynamically with created document refs for robust rollback
    };

    // Resilient schema extraction helpers to align with official master templates
    const getValue = (obj: any, key: string, fallback: any = ""): string => {
      if (!obj) return fallback;
      const normalizedTarget = key.toLowerCase().replace(/[\s_-]+/g, "");
      for (const k of Object.keys(obj)) {
        if (k.toLowerCase().replace(/[\s_-]+/g, "") === normalizedTarget) {
          return String(obj[k]).trim();
        }
      }
      return fallback;
    };

    const getNumber = (obj: any, key: string, fallback = 0): number => {
      const val = getValue(obj, key, "");
      if (!val) return fallback;
      const parsed = Number(val.replace(/[$,\s]/g, ""));
      return isNaN(parsed) ? fallback : parsed;
    };

    const mapRole = (roleStr: string): Role => {
      const norm = roleStr.toLowerCase().trim().replace(/[\s\-_&/]+/g, "");
      
      if (norm.includes("superadmin") || norm === "super_admin") return Role.SUPER_ADMIN;
      if (norm === "admin") return Role.ADMIN;
      if (norm.includes("systemadministrator") || norm === "system_administrator" || norm.includes("sysadmin")) return Role.ADMIN;
      
      if (norm.includes("generalmanager") || norm === "gm") return Role.GENERAL_MANAGER;
      if (norm.includes("regionalmanager")) return Role.REGIONAL_MANAGER;
      if (norm.includes("countrymanager")) return Role.COUNTRY_MANAGER;
      
      if (norm.includes("salesmarketingmanager") || norm.includes("salesandmarketingmanager")) return Role.SALES_MARKETING_MANAGER;
      if (norm.includes("marketingmanager")) return Role.MARKETING_MANAGER;
      if (norm.includes("medicalmanager")) return Role.MEDICAL_MANAGER;
      if (norm.includes("salesmanager")) return Role.SALES_MANAGER;
      if (norm.includes("productmanager")) return Role.PRODUCT_MANAGER;
      
      if (norm.includes("areasalesmanager") || norm.includes("areasales")) return Role.AREA_SALES_MANAGER;
      if (norm.includes("medicalsupervisor") || norm.includes("medsuper") || norm === "supervisor") return Role.MEDICAL_SUPERVISOR;
      if (norm.includes("salessupervisor") || norm.includes("salessuper")) return Role.SALES_SUPERVISOR;
      
      if (norm.includes("medicalrepresentative") || norm.includes("medicalrep") || norm === "rep" || norm === "medrep") return Role.MEDICAL_REP;
      if (norm.includes("salesrepresentative") || norm.includes("salesrep")) return Role.SALES_REP;
      
      if (norm.includes("treasury") || norm.includes("treasuryofficer")) return Role.TREASURY_OFFICER;
      if (norm.includes("finance") || norm.includes("financial")) return Role.FINANCE;
      
      if (norm.includes("warehousemanager") || norm.includes("warehouse") || norm.includes("inventory")) return Role.WAREHOUSE_MANAGER;
      if (norm.includes("storemanager") || norm === "store") return Role.STORE_MANAGER;
      if (norm.includes("deliveryofficer") || norm.includes("delivery")) return Role.DELIVERY_OFFICER;
      if (norm.includes("orderoperationsofficer") || norm.includes("orderops") || norm.includes("orderoperations")) return Role.ORDER_OPS_OFFICER;
      
      if (norm.includes("marketing")) return Role.MARKETING_OFFICER;
      
      if (norm.includes("manager")) return Role.COUNTRY_MANAGER;
      
      return Role.MEDICAL_REP;
    };

    try {
      const batch = writeBatch(db);
      const createdBackup: { id: string; collection: string; operation?: "CREATED" | "UPDATED" | "REACTIVATED"; beforeSnapshot?: any }[] = [];

      if (module === "Users") {
        console.log(`[User Import Debug] Starting processing for ${importedRecords.length} records...`);

        // Fetch canonical areas/users. Auth UID and manager identity are resolved before any operational write.
        let allAreas: Area[] = [];
        let existingUsers: User[] = [];
        const existingEmails = new Set<string>();
        const emailToUserDocIdMap = new Map<string, string>();
        const ambiguousUserEmails = new Set<string>();
        try {
          const [areasSnap, existingUsersSnap] = await Promise.all([
            getDocs(collection(db, "areas")),
            getDocs(collection(db, "users"))
          ]);
          allAreas = areasSnap.docs.map(d => ({ id: d.id, ...d.data() } as Area));
          existingUsers = existingUsersSnap.docs.map(snapshot => ({ ...snapshot.data(), id: snapshot.id } as User));
          existingUsersSnap.docs.forEach(doc => {
            const data = doc.data();
            if (data.email) {
              const emailNormalized = data.email.trim().toLowerCase();
              existingEmails.add(emailNormalized);
              const priorId = emailToUserDocIdMap.get(emailNormalized);
              if (priorId && priorId !== doc.id) ambiguousUserEmails.add(emailNormalized);
              emailToUserDocIdMap.set(emailNormalized, doc.id);
            }
          });
        } catch (e) {
          console.error("[User Import] Failed to fetch database records for resolution/duplication check:", e);
        }

        // Perform strict duplicate validation first
        const duplicatesInTemplate: string[] = [];
        const uniqueEmailsInUpload = new Set<string>();

        importedRecords.forEach((rec, idx) => {
          const rawEmail = getValue(rec, "Email");
          if (rawEmail) {
            const email = rawEmail.trim().toLowerCase();
            const isDbDuplicate = existingEmails.has(email);
            if (uniqueEmailsInUpload.has(email)) {
              duplicatesInTemplate.push(`Row ${idx + 2}: ${email} (Duplicated in spreadsheet file)`);
            } else if (importMode === "CREATE_NEW_ONLY" && isDbDuplicate) {
              duplicatesInTemplate.push(`Row ${idx + 2}: ${email} (Already exists in database under CREATE_NEW_ONLY mode)`);
            } else if (importMode === "UPDATE_EXISTING_ONLY" && !isDbDuplicate) {
              duplicatesInTemplate.push(`Row ${idx + 2}: ${email} (Does not exist in database under UPDATE_EXISTING_ONLY mode)`);
            }
            uniqueEmailsInUpload.add(email);
          }
        });

        if (duplicatesInTemplate.length > 0) {
          const errorMsg = `Upload Rejected: The following email address conflicts occurred:\n${duplicatesInTemplate.join("\n")}`;
          alert(errorMsg);
          throw new Error(errorMsg);
        }

        const rowResults: ImportedUserRowResult[] = [];
        for (const rec of importedRecords) {
          const email = getValue(rec, "Email").trim().toLowerCase();
          const firstName = getValue(rec, "First Name");
          const lastName = getValue(rec, "Last Name");
          const rawRole = getValue(rec, "Role");
          const managerEmail = getValue(rec, "Manager Email").trim().toLowerCase();
          const importedCountry = getValue(rec, "Country");
          if (!importedCountry) {
            rowResults.push({ email, territoryAssignmentCount: 0, productAssignmentCount: 0, readiness: "Awaiting Operational Assignment", status: "FAILED", resourceIds: [], error: "Country is required; no default market is assigned." });
            continue;
          }

          // Columns for Area Codes & Area Names
          const rawAreaCodes = getValue(rec, "Area Codes");
          const rawAreaNames = getValue(rec, "Area Names") || getValue(rec, "Areas");
          const legacyTerritory = getValue(rec, "Territory");

          let areaIds: string[] = [];
          let areaNames: string[] = [];

          if (rawAreaCodes) {
            areaIds = rawAreaCodes.split(/[,;]+/).map(x => x.trim()).filter(Boolean);
          }

          if (rawAreaNames) {
            areaNames = rawAreaNames.split(/[,;]+/).map(x => x.trim()).filter(Boolean);
          } else if (legacyTerritory && !rawAreaCodes) {
            // Keep backward compatibility only for old Replit migration: Territory -> Area Name
            areaNames = legacyTerritory.split(/[,;]+/).map(x => x.trim()).filter(Boolean);
          }

          // Prefer Area Codes as source of truth.
          // If Area Codes are empty but Area Names exist, resolve Area Names through Geographic Master.
          if (areaIds.length === 0 && areaNames.length > 0) {
            areaNames.forEach(name => {
              const matches = allAreas.filter(a => a.name.toLowerCase().trim() === name.toLowerCase().trim());
              const matchedArea = matches.length === 1 ? matches[0] : undefined;
              if (matchedArea) {
                if (!areaIds.includes(matchedArea.id)) {
                  areaIds.push(matchedArea.id);
                }
              }
            });
            if (areaIds.length !== areaNames.length) {
              rowResults.push({ email, territoryAssignmentCount: 0, productAssignmentCount: 0, readiness: "Awaiting Operational Assignment", status: "FAILED", resourceIds: [], error: "Every Area Name must resolve uniquely. Use canonical Area Codes when names are ambiguous." });
              continue;
            }
          }

          // If Area Codes are populated but Area Names are empty, let's resolve them
          if (areaIds.length > 0 && areaNames.length === 0) {
            areaIds.forEach(id => {
              const matchedArea = allAreas.find(a => a.id === id);
              if (matchedArea) {
                if (!areaNames.includes(matchedArea.name)) {
                  areaNames.push(matchedArea.name);
                }
              }
            });
          }

          const mappedRole = mapRole(rawRole || getValue(rec, "role"));
          const existingUserId = emailToUserDocIdMap.get(email);
          const existingUserRecord = existingUserId ? existingUsers.find(user => user.id === existingUserId) : undefined;
          if (ambiguousUserEmails.has(email)) {
            rowResults.push({
              email, territoryAssignmentCount: 0, productAssignmentCount: 0,
              readiness: "Awaiting Operational Assignment", status: "FAILED", resourceIds: [],
              error: `Identity conflict: multiple canonical users documents exist for '${email}'.`,
            });
            continue;
          }
          const effectiveAreaIds = areaIds.length > 0 ? areaIds : (existingUserRecord?.areaIds || []);
          const effectiveAreaNames = areaNames.length > 0 ? areaNames : (existingUserRecord?.areaNames || []);
          const result = await onboardImportedUser({
            email,
            username: getValue(rec, "Username") || email.split("@")[0],
            firstName,
            lastName,
            role: mappedRole,
            managerEmail,
            country: importedCountry,
            district: getValue(rec, "District"),
            city: getValue(rec, "City"),
            areaIds: effectiveAreaIds,
            areaNames: effectiveAreaNames,
          }, existingUsers, {
            provisionAuth: async ({ email: targetEmail, name, role: targetRole }) => createAuthUserViaAdminApi({ email: targetEmail, name, role: targetRole, disabled: true }),
            persistCanonical: async (input) => {
              await createPendingUserWithActivationProfile({
                authUid: input.authUid,
                email: input.email,
                name: `${input.firstName} ${input.lastName}`.trim() || input.username,
                firstName: input.firstName,
                lastName: input.lastName,
                role: input.role,
                managerEmail: input.managerEmail,
                managerId: input.managerId,
                active: false,
                status: "Pending Activation",
                employmentStatus: "Inactive",
                loginAllowed: false,
                username: input.username,
                sidebarVisibility: [],
                areaIds: input.areaIds,
                areaNames: input.areaNames,
                assignedCountries: Array.from(new Set(allAreas.filter((area) => input.areaIds.includes(area.id)).map((area) => area.countryId).filter(Boolean))),
                assignedProductIds: existingUserRecord?.products || [],
                primaryPromotionGroupId: existingUserRecord?.primaryPromotionGroupId,
                targetPromotionGroupIds: existingUserRecord?.targetPromotionGroupIds,
                assignmentSyncStatus: existingUserRecord?.assignmentSyncStatus || "PENDING",
                securityScope: "Territory Only",
                country: input.country,
                district: input.district,
                city: input.city,
                region: input.city || input.district,
                territory: input.areaNames.length === 1 ? input.areaNames[0] : "",
                territories: input.areaNames,
              }, `Imported canonical Auth-linked user ${input.email}. Role: ${input.role}.`);
            },
            syncTerritories: ({ authUid, role, areaIds: importedAreaIds }) => syncImportedUserTerritories({ userId: authUid, userRole: role, areaIds: importedAreaIds, areas: allAreas, actorUid: currentUser.id }),
            verify: (input) => verifyCanonicalImportedUser({ ...input, expectNoProducts: !existingUserRecord || !(existingUserRecord.products?.length) }),
          }, existingUserId);
          rowResults.push(result);
          createdBackup.push(...result.resourceIds.filter(resource => resource.operation === "CREATED"));
          if (result.authUid) {
            existingEmails.add(email);
            emailToUserDocIdMap.set(email, result.authUid);
          }
        }

        const createdCount = rowResults.filter(result => result.status === "CREATED").length;
        const updatedCount = rowResults.filter(result => result.status === "UPDATED").length;
        const failed = rowResults.filter(result => result.status === "FAILED" || result.status === "PARTIAL");
        const persistedDocumentIds = rowResults.flatMap(result => result.status === "CREATED" || result.status === "UPDATED" ? [result.usersDocumentId!] : []);
        newHistory.status = failed.length === 0 ? "Completed" : persistedDocumentIds.length > 0 ? "Partial" : "Failed";
        newHistory.recordCount = persistedDocumentIds.length;
        newHistory.attemptedCount = importedRecords.length;
        newHistory.createdCount = createdCount;
        newHistory.updatedCount = updatedCount;
        newHistory.failedCount = failed.length;
        newHistory.errorsCount = failed.length;
        newHistory.errors = failed.map(result => `${result.email}: ${result.error}`);
        newHistory.persistedDocumentIds = persistedDocumentIds;
        newHistory.recordsBackup = createdBackup;
        newHistory.rowResults = rowResults;
        await saveImportHistoryRecord(newHistory, currentUser.id);
        return {
          success: persistedDocumentIds.length > 0,
          status: failed.length === 0 ? "COMPLETED" : persistedDocumentIds.length > 0 ? "PARTIAL" : "FAILED",
          attemptedCount: importedRecords.length,
          createdCount,
          updatedCount,
          failedCount: failed.length,
          persistedDocumentIds,
          errors: newHistory.errors,
          rowResults,
        };

      } else if (module === "Physicians") {
        const snap = await getDocs(collection(db, "physicians"));
        const existingPhysicians = snap.docs.map(d => ({ id: d.id, ...d.data() } as Physician));

        importedRecords.forEach((rec) => {
          const name = getValue(rec, "Physician Name");
          const specialty = getValue(rec, "Specialty");
          const specialtyId = getValue(rec, "Specialty ID");
          const specialtyName = getValue(rec, "Specialty Name");
          const country = getValue(rec, "Country");
          if (!country) throw new Error(`Physician import requires Country for '${name || "unnamed physician"}'.`);
          const district = getValue(rec, "District");
          const city = getValue(rec, "City");
          
          // Backward compatibility mapping for Territory -> Area
          const legacyTerritory = getValue(rec, "Territory");
          const area = getValue(rec, "Area/Territory") || getValue(rec, "Area") || legacyTerritory;

          // Backward compatibility mapping for Classification -> Segment
          const legacyClassification = getValue(rec, "Classification");
          const segment = getValue(rec, "Segment") || legacyClassification;

          const kolStr = getValue(rec, "Key Opinion Leader");
          const freq = getNumber(rec, "Target Frequency (Visits/Month)");
          const primaryBrand = getValue(rec, "Primary Promotion Group") || getValue(rec, "Primary Brand");
          const targetBrandsStr = getValue(rec, "Target Promotion Groups") || getValue(rec, "Target Brands");
          const clinic = getValue(rec, "Clinic/Hospital Name");
          const sector = getValue(rec, "Sector");
          const address = getValue(rec, "Address");
          const phone = getValue(rec, "Phone");
          const email = getValue(rec, "Email");

          const assignedRepIdVal = getValue(rec, "Assigned Rep ID") || (currentUser.role === Role.MEDICAL_REP ? currentUser.id : undefined);
          const assignedSupervisorIdVal = getValue(rec, "Assigned Supervisor ID");
          const assignedManagerIdVal = getValue(rec, "Assigned Manager ID");

          const targetBrandsArray = targetBrandsStr
            ? targetBrandsStr.split(/[,;]+/).map(b => b.trim()).filter(Boolean)
            : [];

          // Resolve Primary Promotion Group
          let primaryPgId: string | undefined = undefined;
          let primaryPgName: string | undefined = undefined;
          if (primaryBrand) {
            const matched = productPromotionGroups.find(g => {
              const norm = primaryBrand.toLowerCase().trim();
              return g.normalizedName === norm || g.name.toLowerCase().trim() === norm || g.aliases?.some(alias => alias.toLowerCase().trim() === norm);
            });
            if (matched) {
              primaryPgId = matched.id;
              primaryPgName = matched.name;
            } else {
              throw new Error(`Physician Primary Promotion Group '${primaryBrand}' could not be resolved against the canonical registry.`);
            }
          }

          // Resolve Target Promotion Groups
          const targetPgIds: string[] = [];
          const targetPgNames: string[] = [];
          targetBrandsArray.forEach(tb => {
            const matched = productPromotionGroups.find(g => {
              const norm = tb.toLowerCase().trim();
              return g.normalizedName === norm || g.name.toLowerCase().trim() === norm || g.aliases?.some(alias => alias.toLowerCase().trim() === norm);
            });
            if (matched) {
              targetPgIds.push(matched.id);
              targetPgNames.push(matched.name);
            } else {
              throw new Error(`Physician Target Promotion Group '${tb}' could not be resolved against the canonical registry.`);
            }
          });

          const existingPhys = existingPhysicians.find(p => {
            return (email && String(p.email || "").toLowerCase() === email.trim().toLowerCase()) ||
                   (phone && String(p.phone || "").replace(/\D/g, "") === phone.trim().replace(/\D/g, "")) ||
                   (name && String(p.name || "").toLowerCase().trim() === name.toLowerCase().trim());
          });

          if (importMode === "CREATE_NEW_ONLY" && existingPhys) {
            console.warn(`Skipping existing physician '${name}' under CREATE_NEW_ONLY mode`);
            return;
          }
          if (importMode === "UPDATE_EXISTING_ONLY" && !existingPhys) {
            console.warn(`Skipping new physician '${name}' under UPDATE_EXISTING_ONLY mode`);
            return;
          }

          const docId = existingPhys ? existingPhys.id : `DOC-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
          const operation = existingPhys ? "update" : "create";
          
          const rawLat = getValue(rec, "latitude") || getValue(rec, "Latitude") || getValue(rec, "lat") || getValue(rec, "GPS Latitude");
          const rawLng = getValue(rec, "longitude") || getValue(rec, "Longitude") || getValue(rec, "lng") || getValue(rec, "GPS Longitude");
          const parsedLatNum = rawLat ? parseFloat(rawLat) : NaN;
          const parsedLngNum = rawLng ? parseFloat(rawLng) : NaN;
          const validPhysGps = !isNaN(parsedLatNum) && !isNaN(parsedLngNum) && parsedLatNum !== 0 && parsedLngNum !== 0 && parsedLatNum >= -90 && parsedLatNum <= 90 && parsedLngNum >= -180 && parsedLngNum <= 180;
          const physLat = validPhysGps ? parsedLatNum : null;
          const physLng = validPhysGps ? parsedLngNum : null;
          const physGpsStatus = validPhysGps ? "IMPORTED_UNVERIFIED" : "UNVERIFIED";

          const phys: Physician = {
            id: docId,
            name: name || "Dr. Anonymous",
            specialty: specialtyName || specialty || "General Practitioner",
            specialtyId: specialtyId || undefined,
            specialtyName: specialtyName || undefined,
            classification: (segment === "A" || segment === "B" || segment === "C" ? segment : "B") as any,
            region: city || "",
            territory: area || "",
            address: address || clinic || "",
            latitude: physLat as any,
            longitude: physLng as any,
            gpsVerified: false,
            gpsVerificationStatus: physGpsStatus as any,
            gpsVerifiedAt: undefined,
            gpsVerifiedBy: undefined,
            primaryBrand: primaryBrand || undefined,
            targetBrands: targetBrandsArray.length > 0 ? targetBrandsArray : undefined,
            primaryPromotionGroupId: primaryPgId,
            primaryPromotionGroupName: primaryPgName,
            targetPromotionGroupIds: targetPgIds.length > 0 ? targetPgIds : undefined,
            targetPromotionGroupNames: targetPgNames.length > 0 ? targetPgNames : undefined,

            // Master Template specific extended fields
            country,
            district,
            city,
            area,
            countryId: getValue(rec, "Country ID") || undefined,
            countryName: getValue(rec, "Country") || undefined,
            districtId: getValue(rec, "District ID") || undefined,
            districtName: getValue(rec, "District") || undefined,
            cityId: getValue(rec, "City ID") || undefined,
            cityName: getValue(rec, "City") || undefined,
            areaId: getValue(rec, "Area ID") || undefined,
            areaName: getValue(rec, "Area") || undefined,
            segment: segment || "B",
            keyOpinionLeader: kolStr,
            targetFrequency: freq || 4,
            clinic,
            sector,
            phone,
            email,
            assignedRepId: assignedRepIdVal || undefined,
            assignedSupervisorId: assignedSupervisorIdVal || undefined,
            assignedManagerId: assignedManagerIdVal || undefined,
            prescriptionIntent: 5,
            scientificInterests: specialty ? [specialty] : [],
            isTestData: rec.isTestData || false,
            importBatchId: rec.importBatchId || "",
            importedAt: rec.importedAt || "",
            importedBy: rec.importedBy || "",
            sourceTemplateCode: rec.sourceTemplateCode || "",
            source: rec.source || ""
          };

          const decorated = removeUndefinedRecursively(decorateRecord(phys, currentUser.id, operation));
          batch.set(doc(db, "physicians", docId), decorated, { merge: true });
          if (!existingPhys) {
            createdBackup.push({ id: docId, collection: "physicians" });
          }
        });

      } else if (module === "Pharmacies") {
        const snap = await getDocs(collection(db, "pharmacies"));
        const existingPharmacies = snap.docs.map(d => ({ id: d.id, ...d.data() } as Pharmacy));

        const usersSnap = await getDocs(collection(db, "users"));
        const allUsers = usersSnap.docs.map(d => ({ id: d.id, ...d.data() } as User));

        let attemptedCount = 0;
        let createdCount = 0;
        let updatedCount = 0;
        let reactivatedCount = 0;
        let skippedCount = 0;
        let failedCount = 0;
        const attemptedDocIds: string[] = [];
        const failedErrors: string[] = [];

        console.log("[PHARMACY_IMPORT_COMMIT_START]", JSON.stringify({
          filename: newHistory.fileName,
          batchId: newHistory.id,
          parsedRowCount: importedRecords.length,
          validRowCount: importedRecords.length,
          actorUid: currentUser.id,
          databaseId: firestoreDatabaseId
        }));

        for (let index = 0; index < importedRecords.length; index++) {
          const rec = importedRecords[index];
          const name = getValue(rec, "Pharmacy Name");
          const nameAr = getValue(rec, "Pharmacy Name (Arabic)") || getValue(rec, "Arabic Name") || getValue(rec, "nameAr") || undefined;
          const type = getValue(rec, "Type");
          const country = getValue(rec, "Country");
          const district = getValue(rec, "District");
          const city = getValue(rec, "City");
          const area = getValue(rec, "Area");
          const address = getValue(rec, "Address");
          const contactPerson = getValue(rec, "Contact Person");
          const phone = getValue(rec, "Phone");
          const email = getValue(rec, "Email");
          const balance = getNumber(rec, "Outstanding Balance") || getNumber(rec, "Credit Balance");
          const payDays = getNumber(rec, "Payment Term (Days)") || getNumber(rec, "Payment Days");

          if (!name) {
            failedCount++;
            failedErrors.push(`Row ${index + 1}: Required field 'Pharmacy Name' is empty.`);
            continue;
          }
          if (!country) {
            failedCount++;
            failedErrors.push(`Row ${index + 1}: Required field 'Country' is empty; no default market is assigned.`);
            continue;
          }
          if (!country) {
            failedCount++;
            failedErrors.push(`Row ${index + 1}: Required field 'Country' is empty.`);
            continue;
          }
          if (!district) {
            failedCount++;
            failedErrors.push(`Row ${index + 1}: Required field 'District' is empty.`);
            continue;
          }
          if (!city) {
            failedCount++;
            failedErrors.push(`Row ${index + 1}: Required field 'City' is empty.`);
            continue;
          }
          if (!area) {
            failedCount++;
            failedErrors.push(`Row ${index + 1}: Required field 'Area' is empty.`);
            continue;
          }
          if (!address) {
            failedCount++;
            failedErrors.push(`Row ${index + 1}: Required field 'Address' is empty.`);
            continue;
          }

          const dupResult = classifyPharmacyDuplicate(rec, existingPharmacies);

          if (dupResult.type === "AMBIGUOUS_DUPLICATE") {
            failedCount++;
            failedErrors.push(`Row ${index + 1}: Ambiguous duplicate match found for Pharmacy '${name}' by ${dupResult.matchingKey}.`);
            continue;
          }

          if (importMode === "CREATE_NEW_ONLY") {
            if (dupResult.type === "ACTIVE_DUPLICATE" || dupResult.type === "SOFT_DELETED_DUPLICATE") {
              skippedCount++;
              console.warn(`Skipping existing pharmacy '${name}' under CREATE_NEW_ONLY mode (matched by ${dupResult.matchingKey})`);
              continue;
            }
          } else if (importMode === "UPDATE_EXISTING_ONLY") {
            if (dupResult.type === "NO_DUPLICATE") {
              skippedCount++;
              console.warn(`Skipping non-existent pharmacy '${name}' under UPDATE_EXISTING_ONLY mode`);
              continue;
            }
            if (dupResult.type === "SOFT_DELETED_DUPLICATE") {
              skippedCount++;
              console.warn(`Skipping soft-deleted pharmacy '${name}' under UPDATE_EXISTING_ONLY mode`);
              continue;
            }
          }

          const existingPharm = dupResult.matchedDoc;

          // Assigned Rep ID Normalization
          const rawRepInput = getValue(rec, "Assigned Rep ID");
          let resolvedRepUid: string | undefined = undefined;
          if (rawRepInput) {
            const uidMatch = allUsers.find(u => u.id === rawRepInput);
            if (uidMatch) {
              if (uidMatch.role === Role.MEDICAL_REP) {
                failedCount++;
                failedErrors.push(`Row ${index + 1}: Medical Representative '${rawRepInput}' is rejected for Pharmacy assignment. Pharmacies must be assigned to a Sales Representative.`);
                continue;
              }
              resolvedRepUid = uidMatch.id;
            } else {
              const emailMatches = allUsers.filter(u => u.email && u.email.toLowerCase().trim() === rawRepInput.toLowerCase().trim());
              if (emailMatches.length === 0) {
                failedCount++;
                failedErrors.push(`Row ${index + 1}: Unknown email or UID '${rawRepInput}' for Assigned Rep ID.`);
                continue;
              }
              if (emailMatches.length > 1) {
                failedCount++;
                failedErrors.push(`Row ${index + 1}: Ambiguous duplicate email '${rawRepInput}' found for Assigned Rep ID.`);
                continue;
              }
              const matchedUser = emailMatches[0];
              if (matchedUser.role === Role.MEDICAL_REP) {
                failedCount++;
                failedErrors.push(`Row ${index + 1}: Medical Representative email '${rawRepInput}' is rejected for Pharmacy assignment. Pharmacies must be assigned to a Sales Representative.`);
                continue;
              }
              resolvedRepUid = matchedUser.id;
            }
          } else if (existingPharm && existingPharm.assignedRepId) {
            resolvedRepUid = existingPharm.assignedRepId;
          } else if (currentUser.role === Role.SALES_REP) {
            resolvedRepUid = currentUser.id;
          }

          // Assigned Supervisor ID Normalization
          const rawSupInput = getValue(rec, "Assigned Supervisor ID");
          let resolvedSupUid: string | undefined = undefined;
          if (rawSupInput) {
            const uidMatch = allUsers.find(u => u.id === rawSupInput);
            if (uidMatch) {
              resolvedSupUid = uidMatch.id;
            } else {
              const emailMatches = allUsers.filter(u => u.email && u.email.toLowerCase().trim() === rawSupInput.toLowerCase().trim());
              if (emailMatches.length === 1) {
                resolvedSupUid = emailMatches[0].id;
              }
            }
          } else if (existingPharm && existingPharm.assignedSupervisorId) {
            resolvedSupUid = existingPharm.assignedSupervisorId;
          }

          let docId: string;
          let opType: "CREATED" | "UPDATED" | "REACTIVATED";

          if (dupResult.type === "ACTIVE_DUPLICATE") {
            docId = existingPharm!.id;
            opType = "UPDATED";
            updatedCount++;
            createdBackup.push({ id: docId, collection: "pharmacies", operation: "UPDATED", beforeSnapshot: existingPharm });
          } else if (dupResult.type === "SOFT_DELETED_DUPLICATE") {
            docId = existingPharm!.id;
            opType = "REACTIVATED";
            reactivatedCount++;
            createdBackup.push({ id: docId, collection: "pharmacies", operation: "REACTIVATED", beforeSnapshot: existingPharm });

            await saveAuditLogRecord({
              id: `AUD-REACTIVATE-${Date.now()}-${index + 1}`,
              userId: currentUser.id,
              userName: currentUser.name || currentUser.email || currentUser.id,
              userRole: currentUser.role,
              action: "Reactivate",
              entityType: "Pharmacies",
              entityName: name || existingPharm!.name,
              entityId: docId,
              details: `Reactivated soft-deleted Pharmacy '${name || existingPharm!.name}' (ID: ${docId}) via UPSERT import batch ${newHistory.id}. Matched by key: ${dupResult.matchingKey}.`,
              timestamp: new Date().toISOString()
            });
          } else {
            docId = getValue(rec, "Pharmacy ID") || getValue(rec, "ID") || `PHM-${Date.now()}-${index + 1}-${Math.floor(1000 + Math.random() * 9000)}`;
            opType = "CREATED";
            createdCount++;
            createdBackup.push({ id: docId, collection: "pharmacies", operation: "CREATED" });
          }

          const operationName = opType === "CREATED" ? "create" : "update";

          // Trace log for default GPS source identification
          console.log("[PHARMACY_DEFAULT_GPS_SOURCE_JSON]", JSON.stringify({
            sourceFile: "src/App.tsx",
            sourceFunction: "handleImportPharmacies",
            fallbackType: "Hardcoded default fallback coordinates (32.88 / 13.18) removed in favor of strict absent/UNVERIFIED classification",
            fallbackLatitude: null,
            fallbackLongitude: null,
            appliedDuringImport: false,
            appliedDuringManualCreate: false,
            appliedDuringEditLoad: false
          }));

          const rawLatStr = getValue(rec, "latitude") || getValue(rec, "Latitude") || getValue(rec, "lat") || getValue(rec, "GPS Latitude");
          const rawLngStr = getValue(rec, "longitude") || getValue(rec, "Longitude") || getValue(rec, "lng") || getValue(rec, "GPS Longitude");

          let parsedLat: number | null = null;
          let parsedLng: number | null = null;
          let importGpsStatus = "UNVERIFIED";

          if (rawLatStr && rawLngStr) {
            const latNum = parseFloat(rawLatStr);
            const lngNum = parseFloat(rawLngStr);
            if (!isNaN(latNum) && !isNaN(lngNum) && latNum !== 0 && lngNum !== 0 && latNum >= -90 && latNum <= 90 && lngNum >= -180 && lngNum <= 180) {
              const isDemoFallback = (Math.abs(latNum - 32.88) < 0.001 && Math.abs(lngNum - 13.18) < 0.001) ||
                                     (Math.abs(latNum - 32.8872) < 0.001 && Math.abs(lngNum - 13.1913) < 0.001);
              if (!isDemoFallback) {
                parsedLat = latNum;
                parsedLng = lngNum;
                importGpsStatus = "IMPORTED_UNVERIFIED";
              }
            }
          }

          const pharm: Pharmacy = {
            id: docId,
            name: name || "Unnamed Pharmacy",
            nameAr: nameAr || undefined,
            region: city || "",
            territory: area || "",
            address: address || "Street Address",
            outstandingBalance: balance,
            latitude: parsedLat as any,
            longitude: parsedLng as any,
            gpsVerified: false,
            gpsVerificationStatus: importGpsStatus as any,
            gpsVerifiedAt: undefined,
            gpsVerifiedByUid: undefined,
            gpsSource: parsedLat != null ? "CSV_IMPORT" : undefined,
            contact: contactPerson || undefined,
            type: type || "retail",

            // Master Template specific extended fields
            country,
            district,
            city,
            area,
            countryId: getValue(rec, "Country ID") || undefined,
            countryName: getValue(rec, "Country") || undefined,
            districtId: getValue(rec, "District ID") || undefined,
            districtName: getValue(rec, "District") || undefined,
            cityId: getValue(rec, "City ID") || undefined,
            cityName: getValue(rec, "City") || undefined,
            areaId: getValue(rec, "Area ID") || undefined,
            areaName: getValue(rec, "Area") || undefined,
            contactPerson,
            phone,
            email,
            paymentInDays: payDays || 30,
            assignedRepId: resolvedRepUid || undefined,
            assignedSupervisorId: resolvedSupUid || undefined,
            salesPotential: getValue(rec, "Sales Potential") || "Medium",
            active: true,
            status: "Active",
            isDeleted: false, // Explicit isDeleted = false for new & reactivated records
            isTestData: rec.isTestData || false,
            importBatchId: rec.importBatchId || newHistory.id,
            importedAt: rec.importedAt || new Date().toISOString(),
            importedBy: rec.importedBy || currentUser.email || currentUser.id,
            sourceTemplateCode: rec.sourceTemplateCode || "Pharmacies",
            source: rec.source || "Enterprise Import"
          };

          const decorated = removeUndefinedRecursively(decorateRecord(pharm, currentUser.id, operationName));
          console.log("[PHARMACY_IMPORT_WRITE_ATTEMPT]", JSON.stringify({
            rowNumber: index + 1,
            docId,
            collectionPath: "pharmacies",
            opType,
            payload: decorated,
            isDeleted: decorated.isDeleted,
            active: decorated.active
          }));

          batch.set(doc(db, "pharmacies", docId), decorated, { merge: true });
          attemptedCount++;
          attemptedDocIds.push(docId);
        }

        // Execute batch commit and log result
        try {
          await batch.commit();
          console.log("[PHARMACY_IMPORT_WRITE_SUCCESS]", JSON.stringify({ attemptedCount, committedDocumentIds: attemptedDocIds }));
          console.log("[PHARMACY_IMPORT_BATCH_RESULT]", JSON.stringify({
            attempted: attemptedCount,
            created: createdCount,
            updated: updatedCount,
            reactivated: reactivatedCount,
            skipped: skippedCount,
            failed: failedCount,
            committedDocumentIds: attemptedDocIds
          }));
        } catch (batchErr: any) {
          console.error("[PHARMACY_IMPORT_WRITE_FAILURE]", batchErr);
          newHistory.status = "Failed";
          newHistory.errorsCount = attemptedCount + failedCount;
          newHistory.errors = [batchErr.message || String(batchErr)];
          await saveImportHistoryRecord(newHistory, currentUser.id);
          return {
            success: false,
            status: "FAILED",
            attemptedCount,
            createdCount: 0,
            updatedCount: 0,
            reactivatedCount: 0,
            skippedCount,
            failedCount: attemptedCount + failedCount,
            persistedDocumentIds: [],
            errors: [batchErr.message || String(batchErr)]
          };
        }

        // Post-commit direct getDoc verification
        const verifiedDocIds: string[] = [];
        for (const docId of attemptedDocIds) {
          const verifySnap = await getDoc(doc(db, "pharmacies", docId));
          if (verifySnap.exists()) {
            verifiedDocIds.push(docId);
            const vData = verifySnap.data();
            console.log("[PHARMACY_IMPORT_POST_COMMIT_VERIFY]", JSON.stringify({
              docId,
              exists: true,
              payloadSummary: {
                name: vData.name,
                areaId: vData.areaId,
                assignedRepId: vData.assignedRepId,
                active: vData.active,
                isDeleted: vData.isDeleted,
                createdAt: vData.createdAt,
                updatedAt: vData.updatedAt
              }
            }));
          } else {
            console.error("[PHARMACY_IMPORT_POST_COMMIT_VERIFY]", JSON.stringify({ docId, exists: false }));
          }
        }

        if (verifiedDocIds.length === 0) {
          newHistory.status = "Failed";
          newHistory.recordCount = 0;
          newHistory.createdCount = 0;
          newHistory.updatedCount = 0;
          newHistory.reactivatedCount = 0;
          newHistory.skippedCount = skippedCount;
          newHistory.errorsCount = attemptedCount + failedCount;
          newHistory.errors = ["Post-commit verification failed: Zero Pharmacy documents persisted in Firestore."];
          await saveImportHistoryRecord(newHistory, currentUser.id);
          return {
            success: false,
            status: "FAILED",
            attemptedCount,
            createdCount: 0,
            updatedCount: 0,
            reactivatedCount: 0,
            skippedCount,
            failedCount: attemptedCount + failedCount,
            persistedDocumentIds: [],
            errors: ["Post-commit verification failed: Zero Pharmacy documents persisted in Firestore."]
          };
        }

        const finalStatus = verifiedDocIds.length < (attemptedCount + failedCount) ? "PARTIAL" : "COMPLETED";
        newHistory.status = finalStatus === "COMPLETED" ? "Completed" : "Partial";
        newHistory.recordCount = verifiedDocIds.length;
        newHistory.createdCount = createdCount;
        newHistory.updatedCount = updatedCount;
        newHistory.reactivatedCount = reactivatedCount;
        newHistory.skippedCount = skippedCount;
        newHistory.errorsCount = failedCount + (attemptedCount - verifiedDocIds.length);
        newHistory.recordsBackup = createdBackup;
        newHistory.persistedDocumentIds = verifiedDocIds;
        newHistory.errors = failedErrors;
        await saveImportHistoryRecord(newHistory, currentUser.id);

        handleLogAudit(
          "Create",
          "Imports",
          `Successfully committed pharmacy import file: ${newHistory.fileName}. Persisted ${verifiedDocIds.length} records (${createdCount} created, ${updatedCount} updated, ${reactivatedCount} reactivated).`
        );

        return {
          success: true,
          status: finalStatus,
          attemptedCount,
          createdCount,
          updatedCount,
          reactivatedCount,
          skippedCount,
          failedCount: failedCount + (attemptedCount - verifiedDocIds.length),
          persistedDocumentIds: verifiedDocIds,
          errors: failedErrors
        };

      } else if (module === "Products") {
        const snap = await getDocs(collection(db, "products"));
        const existingProducts = snap.docs.map(d => ({ id: d.id, ...d.data() } as Product));
        const productCommands: Array<{ operation: "create" | "edit"; productId: string; product: Product }> = [];

        importedRecords.forEach((rec) => {
          const sku = getValue(rec, "SKU");
          const name = getValue(rec, "Product Name");
          const nameAr = getValue(rec, "Arabic Product Name") || getValue(rec, "Arabic Name");
          const brand = getValue(rec, "Product Promotion Group") || getValue(rec, "Brand");
          const productFamily = getValue(rec, "Product Family");
          const manufacturer = getValue(rec, "Manufacturer");
          const therapeuticArea = getValue(rec, "Therapeutic Area") || getValue(rec, "Category") || "Vascular & Cardiology";
          const productType = getValue(rec, "Product Type");
          const price = getNumber(rec, "Price");
          const stock = getNumber(rec, "Initial Stock") || getNumber(rec, "Stock Quantity") || getNumber(rec, "Stock");
          const promoType = getValue(rec, "Promotion Type");
          const desc = getValue(rec, "Description");
          const isSampleable = getValue(rec, "Can Generate Samples") || getValue(rec, "Is Sampleable");
          const repLimit = getNumber(rec, "Monthly Rep Sample Limit");
          const phyLimit = getNumber(rec, "Monthly Physician Sample Limit");
          const isSample = getValue(rec, "Sample SKU") || getValue(rec, "Is Sample");
          const parentSku = getValue(rec, "Parent Product SKU");
          const mktStatus = getValue(rec, "Marketing Status");
          const pkgSize = getValue(rec, "Package Size");
          const strengthVal = getValue(rec, "Strength");
          const rxStatus = getValue(rec, "Prescription Status");
          const productImageUrl = getValue(rec, "Product Image") || getValue(rec, "Product Image Url");
          const activeVal = getValue(rec, "Active");
          const activeValNorm = activeVal ? activeVal.toLowerCase().trim() : "";
          const isActive = activeValNorm ? (activeValNorm === "true" || activeValNorm === "yes" || activeValNorm === "active" || activeValNorm === "1" || activeValNorm === "enabled") : true;

          const existingProd = existingProducts.find(p => String(p.sku || p.id || "").toLowerCase() === sku.toLowerCase());

          if (importMode === "CREATE_NEW_ONLY" && existingProd) {
            console.warn(`Skipping existing product '${sku}' under CREATE_NEW_ONLY mode`);
            return;
          }
          if (importMode === "UPDATE_EXISTING_ONLY" && !existingProd) {
            console.warn(`Skipping new product '${sku}' under UPDATE_EXISTING_ONLY mode`);
            return;
          }

          const docId = existingProd?.id || (sku ? sku.replace(/[^A-Za-z0-9-]/g, "") : `PRD-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`);
          const operation = existingProd ? "edit" : "create";

          // Resolve Promotion Group
          let resolvedGroupId = "";
          let resolvedGroupName = "";
          const groupNameInput = brand || name || "Generic";
          
          const matchedGroup = productPromotionGroups.find(g => {
            const norm = groupNameInput.toLowerCase().trim();
            return g.normalizedName === norm || g.name.toLowerCase().trim() === norm || g.aliases?.some(alias => alias.toLowerCase().trim() === norm);
          });

          if (matchedGroup) {
            resolvedGroupId = matchedGroup.id;
            resolvedGroupName = matchedGroup.name;
          } else {
            resolvedGroupId = groupNameInput.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
            resolvedGroupName = groupNameInput;
          }

          const prod: Product = {
            id: docId,
            name: name || "New Product",
            nameAr: nameAr || undefined,
            brand: resolvedGroupName,
            promotionGroupId: resolvedGroupId,
            promotionGroupName: resolvedGroupName,
            productFamily: productFamily || undefined,
            therapeuticArea: therapeuticArea,
            price: price || 15.0,
            stock: stock || 500,
            description: desc || "Pharmaceutical product catalog record",
            manufacturer,
            promotionType: promoType,

            // Master Template specific extended fields
            sku: sku || docId,
            productType,
            stockQuantity: stock || 500,
            isSampleable,
            monthlyRepSampleLimit: repLimit || 50,
            monthlyPhysicianSampleLimit: phyLimit || 10,
            isSample,
            parentProductSku: parentSku,
            marketingStatus: mktStatus,
            packageSize: pkgSize,
            strength: strengthVal,
            prescriptionStatus: rxStatus,
            productImageUrl: productImageUrl || undefined,
            productImages: productImageUrl ? [productImageUrl] : [],
            isActive,
            isTestData: rec.isTestData || false,
            importBatchId: rec.importBatchId || "",
            sourceTemplateCode: rec.sourceTemplateCode || "",
            source: rec.source || ""
          };

          productCommands.push({ operation, productId: docId, product: prod });
          if (!existingProd) {
            createdBackup.push({ id: docId, collection: "products" });
          }
        });
        if (productCommands.length > 0) await saveProductBatch(productCommands, currentUser.id);

      } else if (module === "Key Messages") {
        const snap = await getDocs(collection(db, "keyMessages"));
        const existingMessages = snap.docs.map(d => ({ id: d.id, ...d.data() } as KeyMessage));

        importedRecords.forEach((rec) => {
          const productSku = getValue(rec, "Product SKU");
          const keyFocus = getValue(rec, "Key Focus");
          const messageContent = getValue(rec, "Message Content");

          const existingMsg = existingMessages.find(m => String(m.message || m.messageContent || "").toLowerCase() === messageContent.toLowerCase());

          if (importMode === "CREATE_NEW_ONLY" && existingMsg) {
            console.warn(`Skipping existing message under CREATE_NEW_ONLY mode`);
            return;
          }
          if (importMode === "UPDATE_EXISTING_ONLY" && !existingMsg) {
            console.warn(`Skipping new message under UPDATE_EXISTING_ONLY mode`);
            return;
          }

          const docId = existingMsg ? existingMsg.id : `MSG-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
          const operation = existingMsg ? "update" : "create";

          const msg: KeyMessage = {
            id: docId,
            brandId: productSku || "GENERAL",
            brandName: productSku || "General Medicine",
            message: messageContent || "Scientific detailing communication",
            therapeuticArea: "General Medicine",

            // Master Template specific extended fields
            productSku,
            keyFocus,
            messageContent,
            detailingSequence: 1,
            isTestData: rec.isTestData || false,
            importBatchId: rec.importBatchId || "",
            importedAt: rec.importedAt || "",
            importedBy: rec.importedBy || "",
            sourceTemplateCode: rec.sourceTemplateCode || "",
            source: rec.source || ""
          };

          const decorated = removeUndefinedRecursively(decorateRecord(msg, currentUser.id, operation));
          batch.set(doc(db, "keyMessages", docId), decorated, { merge: true });
          if (!existingMsg) {
            createdBackup.push({ id: docId, collection: "keyMessages" });
          }
        });
      } else if (module === "Area Import (Geographic Master)") {
        let createdCount = 0;
        let updatedCount = 0;
        let skippedCount = 0;
        let errorsCount = 0;
        const startTime = Date.now();

        const [countriesSnap, districtsSnap, citiesSnap, areasSnap] = await Promise.all([
          getDocs(collection(db, "countries")),
          getDocs(collection(db, "districts")),
          getDocs(collection(db, "cities")),
          getDocs(collection(db, "areas"))
        ]);

        const existingCountries = countriesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Country));
        const existingDistricts = districtsSnap.docs.map(d => ({ id: d.id, ...d.data() } as District));
        const existingCities = citiesSnap.docs.map(d => ({ id: d.id, ...d.data() } as City));
        const existingAreas = areasSnap.docs.map(d => ({ id: d.id, ...d.data() } as Area));

        const countriesMap = new Map<string, Country>();
        existingCountries.forEach(c => countriesMap.set(c.name.toLowerCase().trim(), c));

        const districtsMap = new Map<string, District>();
        existingDistricts.forEach(d => {
          const key = `${d.countryId}_${d.name.toLowerCase().trim()}`;
          districtsMap.set(key, d);
        });

        const citiesMap = new Map<string, City>();
        existingCities.forEach(c => {
          const key = `${c.districtId}_${c.name.toLowerCase().trim()}`;
          citiesMap.set(key, c);
        });

        const areasMap = new Map<string, Area>();
        existingAreas.forEach(a => {
          areasMap.set(a.id.toLowerCase().trim(), a);
        });

        importedRecords.forEach((rec) => {
          const countryName = getValue(rec, "Country");
          const districtName = getValue(rec, "District");
          const cityName = getValue(rec, "City");
          const areaName = getValue(rec, "Area");
          let areaCode = getValue(rec, "Area Code");
          const activeStr = getValue(rec, "Active");

          if (!countryName || !districtName || !cityName || !areaName) {
            errorsCount++;
            skippedCount++;
            return;
          }

          if (!areaCode) {
            const cleanCity = cityName.replace(/[^A-Za-z0-9]/g, "").toUpperCase().substring(0, 3);
            const cleanArea = areaName.replace(/[^A-Za-z0-9]/g, "").toUpperCase().substring(0, 5);
            areaCode = `A-${cleanCity}-${cleanArea}-${Math.floor(100 + Math.random() * 900)}`;
          }

          // 1. Resolve Country
          const cKey = countryName.toLowerCase().trim();
          let countryObj = countriesMap.get(cKey);
          if (!countryObj) {
            const cId = `C-${countryName.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}`;
            countryObj = {
              id: cId,
              name: countryName,
              code: countryName.substring(0, 2).toUpperCase()
            };
            const decoratedC = removeUndefinedRecursively(decorateRecord(countryObj, currentUser.id, "create"));
            batch.set(doc(db, "countries", cId), decoratedC);
            createdBackup.push({ id: cId, collection: "countries" });
            countriesMap.set(cKey, countryObj);
            createdCount++;
          }

          // 2. Resolve District
          const dKey = `${countryObj.id}_${districtName.toLowerCase().trim()}`;
          let districtObj = districtsMap.get(dKey);
          if (!districtObj) {
            const dId = `D-${districtName.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}-${countryObj.id}`;
            districtObj = {
              id: dId,
              name: districtName,
              countryId: countryObj.id,
              countryName: countryObj.name
            };
            const decoratedD = removeUndefinedRecursively(decorateRecord(districtObj, currentUser.id, "create"));
            batch.set(doc(db, "districts", dId), decoratedD);
            createdBackup.push({ id: dId, collection: "districts" });
            districtsMap.set(dKey, districtObj);
            createdCount++;
          }

          // 3. Resolve City
          const ctKey = `${districtObj.id}_${cityName.toLowerCase().trim()}`;
          let cityObj = citiesMap.get(ctKey);
          if (!cityObj) {
            const ctId = `CT-${cityName.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}-${districtObj.id}`;
            cityObj = {
              id: ctId,
              name: cityName,
              districtId: districtObj.id,
              districtName: districtObj.name,
              countryId: countryObj.id,
              countryName: countryObj.name
            };
            const decoratedCt = removeUndefinedRecursively(decorateRecord(cityObj, currentUser.id, "create"));
            batch.set(doc(db, "cities", ctId), decoratedCt);
            createdBackup.push({ id: ctId, collection: "cities" });
            citiesMap.set(ctKey, cityObj);
            createdCount++;
          }

          // 4. Resolve Area
          const aKey = areaCode.toLowerCase().trim();
          const areaObj = areasMap.get(aKey);
          const isActive = activeStr ? (activeStr.toLowerCase() === "yes" || activeStr.toLowerCase() === "true") : true;

          const newArea: Area = {
            id: areaCode,
            name: areaName,
            cityId: cityObj.id,
            cityName: cityObj.name,
            districtId: districtObj.id,
            districtName: districtObj.name,
            countryId: countryObj.id,
            countryName: countryObj.name,
            code: areaCode,
            active: isActive,
            isTestData: rec.isTestData || false,
            importBatchId: rec.importBatchId || "",
            importedAt: rec.importedAt || "",
            importedBy: rec.importedBy || "",
            sourceTemplateCode: rec.sourceTemplateCode || "",
            source: rec.source || ""
          };

          if (areaObj) {
            // Update Area if Area Code already exists!
            const decoratedA = removeUndefinedRecursively(decorateRecord(newArea, currentUser.id, "update"));
            batch.set(doc(db, "areas", areaCode), decoratedA);
            updatedCount++;
          } else {
            // Create Area
            const decoratedA = removeUndefinedRecursively(decorateRecord(newArea, currentUser.id, "create"));
            batch.set(doc(db, "areas", areaCode), decoratedA);
            createdBackup.push({ id: areaCode, collection: "areas" });
            areasMap.set(aKey, newArea);
            createdCount++;
          }
        });

        const durationMs = Date.now() - startTime;
        newHistory.createdCount = createdCount;
        newHistory.updatedCount = updatedCount;
        newHistory.skippedCount = skippedCount;
        newHistory.errorsCount = errorsCount;
        newHistory.durationMs = durationMs;
      }

      newHistory.recordsBackup = createdBackup;
      if (module !== "Products") await batch.commit();
      await saveImportHistoryRecord(newHistory, currentUser.id);

      handleLogAudit(
        "Create",
        "Imports",
        `Successfully loaded and validated worksheet file: ${newHistory.fileName}. Committed ${newHistory.recordCount} records.`
      );
      return { success: true };
    } catch (e: any) {
      console.error("[Firestore] Error executing import:", e);
      return { success: false, error: e.message || String(e) };
    }
  };

  // Rollback Imported Transactions Handler
  const handleRollbackImport = async (importId: string) => {
    try {
      const historyDocRef = doc(db, "importHistory", importId);
      const snap = await getDoc(historyDocRef);
      if (snap.exists()) {
        const historyData = snap.data();
        const recordsBackup = historyData.recordsBackup || [];
        const batch = writeBatch(db);
        
        recordsBackup.forEach((item: any) => {
          const itemRef = doc(db, item.collection, item.id);
          const op = item.operation || "CREATED";
          if (op === "CREATED") {
            batch.delete(itemRef);
          } else if (op === "UPDATED") {
            if (item.beforeSnapshot) {
              batch.set(itemRef, item.beforeSnapshot);
            }
          } else if (op === "REACTIVATED") {
            if (item.beforeSnapshot) {
              batch.set(itemRef, {
                ...item.beforeSnapshot,
                isDeleted: true,
                active: false,
                status: "Inactive",
                updatedAt: new Date().toISOString()
              });
            } else {
              batch.set(itemRef, {
                isDeleted: true,
                active: false,
                status: "Inactive",
                updatedAt: new Date().toISOString()
              }, { merge: true });
            }
          }
        });
        
        batch.set(historyDocRef, { status: "Rolled Back" }, { merge: true });
        await batch.commit();

        handleLogAudit(
          "Delete",
          "Rollback",
          `Executed complete rollback for import session ID '${importId}'. Restored/deleted ${recordsBackup.length} imported documents from '${historyData.module}' collection.`
        );
      }
    } catch (e) {
      console.error("[Firestore] Error rolling back import:", e);
    }
  };

  const handleRetryInitialization = async () => {
    if (isRetrying) {
      console.warn("[Retry Initialization] Retry already in progress. Ignoring concurrent request.");
      return;
    }
    setIsRetrying(true);
    setInitError(null);

    try {
      console.info("[Retry Initialization] Initiating session retry checklist...");
      
      // 1. Verify browser online status before initiating any remote reads
      if (!navigator.onLine) {
        throw new Error("Cannot retry: Device is offline. Please check your network connection.");
      }

      // 2. Force the client to attempt reconnecting with enableNetwork
      console.info("[Retry Initialization] Re-enabling Firestore network connection...");
      await enableNetwork(db);
      console.info("[Retry Initialization] Firestore network connection enabled successfully.");

      if (auth.currentUser) {
        // 3. Directly attempt reading user profile from users/{auth.uid} first to verify network and document existence
        console.info(`[Retry Initialization] Directly verifying profile document exists for: users/${auth.currentUser.uid}`);
        const userDocRef = doc(db, "users", auth.currentUser.uid);
        const directSnap = await getDoc(userDocRef);
        
        if (!directSnap.exists()) {
          throw new Error(`Profile document users/${auth.currentUser.uid} not found. Please verify your activation profile or contact your administrator.`);
        }
        
        console.info("[Retry Initialization] Direct profile read succeeded. Restarting complete session hydration flow...");

        // 4. Clear existing states before reloading to avoid stale references
        resetUserSession();
        // 5. Run loadUserScopeAndAssignments and ensure profile read succeeds
        await loadUserScopeAndAssignments(auth.currentUser, lang);
      } else {
        window.location.reload();
      }
    } catch (err: any) {
      console.error("[Retry Initialization] Failed during retry:", err);
      const errCode = err?.code || "unknown";
      let classification = "unknown";
      const errMsg = err instanceof Error ? err.message : String(err);
      const lowercaseCode = String(errCode).toLowerCase();
      const lowercaseMsg = String(errMsg).toLowerCase();

      if (lowercaseCode === 'permission-denied' || lowercaseMsg.includes('permission-denied') || lowercaseMsg.includes('permission denied')) {
        classification = 'permission-denied';
      } else if (lowercaseCode === 'unavailable' || lowercaseMsg.includes('offline') || lowercaseMsg.includes('unavailable')) {
        classification = 'unavailable';
      } else if (lowercaseCode === 'not-found' || lowercaseMsg.includes('not-found') || lowercaseMsg.includes('not found')) {
        classification = 'not-found';
      } else if (lowercaseCode === 'deadline-exceeded' || lowercaseMsg.includes('timeout') || lowercaseMsg.includes('deadline-exceeded')) {
        classification = 'deadline-exceeded';
      }

      setInitError({ 
        step: "retry", 
        message: errMsg,
        code: errCode,
        classification,
        path: auth.currentUser ? `users/${auth.currentUser.uid}` : undefined
      });
    } finally {
      setIsRetrying(false);
    }
  };

  const handleSignOutAndReset = async () => {
    try {
      await signOut(auth);
      resetUserSession();
      setInitError(null);
      setFirebaseUser(null);
      window.location.reload();
    } catch (e) {
      console.error("[Session Sign Out Error]", e);
    }
  };

  const handleActivateSandbox = () => {
    localStorage.setItem("sandbox_mode", "true");
    window.location.reload();
  };

  const handleDisableSandbox = () => {
    localStorage.removeItem("sandbox_mode");
    window.location.reload();
  };

  const sessionAccessMode = resolveSessionAccessMode({
    authReady,
    hasFirebaseUser: Boolean(firebaseUser),
    explicitSandboxEnabled: enableMockData,
  });
  const isSandbox = sessionAccessMode === "SANDBOX";
  
  const getConnectivityClassification = (): "CLOUD_CONNECTED" | "CLOUD_CONNECTED_WITH_MEMORY_PERSISTENCE" | "DEGRADED_OPTIONAL_SERVICE" | "COLLECTION_PERMISSION_ERROR" | "AUTHORIZATION_DENIED" | "CLOUD_UNAVAILABLE" => {
    if (dbError) {
      const pathStr = dbError.path || "";
      const classification = dbError.classification || "";
      const code = String(dbError.code || "").toLowerCase();
      const msg = String(dbError.error || "").toLowerCase();

      // 1. Check if it's an auditLogs permission error
      if (pathStr.includes("auditLogs") && classification === "permission-denied") {
        return "COLLECTION_PERMISSION_ERROR";
      }
      
      // 2. Check for AI quota (429) or geographic block (403)
      if (code === "resource-exhausted" || msg.includes("quota") || msg.includes("429") || code === "429" || msg.includes("geographic") || msg.includes("403") || code === "403") {
        return "DEGRADED_OPTIONAL_SERVICE";
      }

      // 3. True network/firestore offline or deadline exceeded
      if (classification === "unavailable" || classification === "deadline-exceeded" || msg.includes("offline") || msg.includes("unreachable")) {
        return "CLOUD_UNAVAILABLE";
      }

      // 4. Other permission errors on specific collections
      if (classification === "permission-denied") {
        return "COLLECTION_PERMISSION_ERROR";
      }
    }

    return "CLOUD_CONNECTED_WITH_MEMORY_PERSISTENCE";
  };

  const connClass = getConnectivityClassification();

  useEffect(() => {
    console.info("[CONNECTIVITY_DIAGNOSTIC]", {
      authReady,
      firebaseUserPresent: !!firebaseUser,
      dbError,
      connectivityClassification: connClass
    });
  }, [authReady, firebaseUser, dbError, connClass]);

  const sessionReady = isSandbox || evaluateBaseSessionInitialization({
    authReady,
    profileLoaded,
    permissionsReady,
    policyReady,
    sessionHydrationComplete,
    readinessStatus: operationalReport.status,
    operationalScopeStatus: operationalScopeSession.status,
  }).ready;
  const sessionDomState = resolveSessionDomState({
    sessionReady,
    isSessionInitializing,
    hasInitializationError: Boolean(initError),
  });
  const readinessReason = operationalReport.reasons.join(",");

  const showSandboxBanner = sessionReady && (
    (!isSandbox && connClass === "CLOUD_CONNECTED_WITH_MEMORY_PERSISTENCE") ||
    !!dbError ||
    connClass === "CLOUD_UNAVAILABLE" ||
    connClass === "DEGRADED_OPTIONAL_SERVICE" ||
    connClass === "COLLECTION_PERMISSION_ERROR"
  ) && !isBannerAcknowledged;

  if (initError) {
    const isRtl = lang === "ar";
    const databaseId = firestoreDatabaseId;
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 font-sans select-none animate-fade-in" id="session-error-viewport" data-session-state={sessionDomState} data-readiness-status={operationalReport.status} data-readiness-reason={readinessReason} data-initialization-error={initError.message}>
        <div className="w-full max-w-lg bg-slate-900 border border-rose-950 rounded-2xl p-6 md:p-8 shadow-2xl space-y-6 relative overflow-hidden" id="session-error-card">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-32 bg-rose-500/10 blur-3xl rounded-full" />
          <div className="text-center space-y-2 relative z-10">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-rose-950/30 border border-rose-500/20 text-rose-400 mb-2">
              <Shield size={24} />
            </div>
            <h1 className="text-lg font-black tracking-tight text-white uppercase font-sans">
              {isRtl ? "فشل تهيئة جلسة MENAREPS 2.0" : "MENAREPS 2.0 Initialization Failed"}
            </h1>
            <p className="text-xs text-rose-400 font-medium leading-relaxed">
              {isRtl 
                ? `حدث خطأ أثناء إجراء: ${initError.step}` 
                : `An error occurred during step: ${initError.step}`}
            </p>
          </div>
          
          <div className="p-4 bg-rose-950/20 border border-rose-900/35 rounded-xl text-xs font-mono text-rose-300 break-all space-y-2.5">
            <div>
              <strong className="text-rose-400">Error Message:</strong> {initError.message}
            </div>
            {initError.code && (
              <div>
                <strong className="text-rose-400">Error Code:</strong> <span className="bg-rose-950 px-1.5 py-0.5 rounded text-white font-bold border border-rose-900/40">{initError.code}</span>
              </div>
            )}
            {initError.classification && (
              <div>
                <strong className="text-rose-400">Classification:</strong> <span className="text-amber-400 font-bold uppercase">{initError.classification}</span>
              </div>
            )}
            {initError.path && (
              <div>
                <strong className="text-rose-400">Document Path:</strong> <span className="text-blue-300">{initError.path}</span>
              </div>
            )}
            <div className="border-t border-rose-900/30 pt-2 text-[10px] text-slate-400 space-y-1">
              <div><strong>Target Database ID:</strong> {databaseId}</div>
              <div><strong>Verified Security Rules Timestamp:</strong> 2026-07-11 20:48:00 UTC</div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 items-center justify-center">
            <button
              onClick={handleRetryInitialization}
              disabled={isRetrying}
              className="w-full sm:w-auto px-5 py-2.5 bg-rose-600 hover:bg-rose-700 disabled:bg-rose-800 disabled:opacity-50 text-white font-semibold rounded-xl text-xs transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              {isRetrying ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  {isRtl ? "جاري إعادة المحاولة..." : "Retrying..."}
                </>
              ) : (
                isRtl ? "إعادة المحاولة" : "Retry Initialization"
              )}
            </button>
            <button
              onClick={handleSignOutAndReset}
              className="w-full sm:w-auto px-5 py-2.5 bg-slate-850 hover:bg-slate-850/80 text-white font-semibold rounded-xl text-xs transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              {isRtl ? "تسجيل الخروج" : "Sign Out"}
            </button>
          </div>

          {enableMockData && <div className="pt-2 text-center border-t border-rose-950/20">
            <button
              onClick={handleActivateSandbox}
              className="text-slate-500 hover:text-amber-400 text-[10px] font-bold tracking-wider uppercase transition-colors cursor-pointer"
            >
              {isRtl ? "تفعيل نمط البيئة التجريبية" : "Developer: Activate Sandbox Mode"}
            </button>
          </div>}
        </div>
      </div>
    );
  }

  if (sessionAccessMode === "AUTHENTICATION_REQUIRED") {
    return (
      <div
        id="production-authentication-gate"
        data-session-state="NON_OPERATIONAL"
        data-readiness-status={operationalReport.status}
        data-readiness-reason="AUTHENTICATION_REQUIRED"
      >
        <AuthModal
          isOpen
          onClose={() => undefined}
          lang={lang}
          onAuthSuccess={(profile) => setCurrentUser(profile)}
          currentRealUser={null}
        />
      </div>
    );
  }

  if (!sessionReady) {
    const isRtl = lang === "ar";
    const doneCount = sessionLoadingSteps.filter(s => s.status === "done").length;
    const progressPercent = sessionLoadingSteps.length > 0 
      ? Math.round((doneCount / sessionLoadingSteps.length) * 100)
      : 0;

    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 font-sans selection:bg-blue-600/30 select-none animate-fade-in" id="session-initialization-viewport" data-session-state={sessionDomState} data-readiness-status={operationalReport.status} data-readiness-reason={readinessReason}>
        <div className="w-full max-w-lg bg-slate-900 border border-slate-800/80 rounded-2xl p-6 md:p-8 shadow-2xl space-y-6 relative overflow-hidden" id="session-initialization-card">
          {/* Subtle glow effect */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-32 bg-blue-500/10 blur-3xl rounded-full" />

          {/* Header */}
          <div className="text-center space-y-2 relative z-10">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-blue-900/30 border border-blue-500/20 text-blue-400 mb-2 animate-pulse">
              <Shield size={24} />
            </div>
            <h1 className="text-lg font-black tracking-tight text-white uppercase font-sans">
              {isRtl ? "تهيئة صلاحيات جلسة MENAREPS 2.0" : "MENAREPS 2.0 Session Alignment"}
            </h1>
            <p className="text-xs text-slate-400 font-medium leading-relaxed">
              {isRtl 
                ? "جاري مواءمة الصلاحيات، نطاق الأقاليم الجغرافية وتراخيص الأدوية..." 
                : "Synchronizing operator role-permissions, geographic scope, and alignment models..."}
            </p>
          </div>

          {/* Checklist steps */}
          <div className="space-y-3 relative z-10" id="session-loading-steps">
            {sessionLoadingSteps.map((step, idx) => {
              const isDone = step.status === "done";
              const isLoading = step.status === "loading";
              const isError = step.status === "error";
              
              return (
                <div 
                  key={step.id} 
                  className={`flex items-center justify-between p-3 rounded-xl border text-xs font-semibold transition-all duration-300 ${
                    isDone 
                      ? "bg-emerald-950/25 border-emerald-900/30 text-emerald-100" 
                      : isError
                        ? "bg-rose-950/25 border-rose-900/30 text-rose-100"
                        : isLoading 
                          ? "bg-blue-950/20 border-blue-900/40 text-blue-100 shadow-sm shadow-blue-500/5 scale-[1.01]" 
                          : "bg-slate-900/50 border-slate-850 text-slate-500"
                  }`}
                  id={`step-${step.id}`}
                >
                  <div className="flex items-center gap-3">
                    {isDone ? (
                      <CheckCircle2 size={15} className="text-emerald-500 shrink-0" />
                    ) : isError ? (
                      <X size={15} className="text-rose-500 shrink-0" />
                    ) : isLoading ? (
                      <Loader2 size={15} className="text-blue-400 animate-spin shrink-0" />
                    ) : (
                      <span className="w-3.5 h-3.5 rounded-full border-2 border-slate-700 shrink-0" />
                    )}
                    <span className="tracking-tight">{step.label}</span>
                  </div>

                  {step.extra && (
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-mono tracking-wider font-bold ${
                      isDone 
                        ? "bg-emerald-950/50 text-emerald-400 border border-emerald-900/40" 
                        : isError
                          ? "bg-rose-950/50 text-rose-400"
                          : "bg-blue-950/50 text-blue-400"
                    }`}>
                      {step.extra}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Progress Bar */}
          <div className="space-y-2 pt-2 relative z-10" id="progress-container">
            <div className="flex justify-between items-center text-xxs font-mono text-slate-500 font-bold">
              <span>{isRtl ? "نسبة التقدم" : "ALIGNED PROFILE"}</span>
              <span>{progressPercent}%</span>
            </div>
            <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-500 rounded-full transition-all duration-500 ease-out" 
                style={{ width: `${progressPercent}%` }} 
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <OperationalScopeSessionProvider value={operationalScopeSession}>
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 font-sans transition-colors duration-300 pb-16 md:pb-0" id="menareps-crm-app" data-session-state={sessionDomState} data-readiness-status={operationalReport.status} data-readiness-reason={readinessReason}>
      
      {/* Dynamic Top Bar */}
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-50 px-4 md:px-6 py-3.5 flex justify-between items-center shadow-xs" id="main-header">
        
        {/* Logo and title with mobile hamburger toggle */}
        <div className="flex items-center gap-2" id="header-brand">
          <button
            onClick={() => setIsMobileSidebarOpen(true)}
            className="md:hidden p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer shrink-0"
            id="mobile-drawer-toggle"
            title="Open Menu"
          >
            <Menu size={18} />
          </button>

          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-black text-sm shrink-0" id="logo-icon">
            MR
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-800 dark:text-white leading-tight tracking-tight uppercase">
              MENAREPS CRM
            </h1>
            <p className="text-xxs text-slate-400 font-mono tracking-wide hidden xs:block">
              Middle East Field Pharmaceutical CRM
            </p>
          </div>
        </div>

        {/* Action Controls & Impersonator Switch */}
        <div className="flex items-center gap-2 md:gap-4" id="header-controls">
          
          {/* Cloud Auth Session Badge Trigger */}
          <button
            onClick={() => setIsAuthModalOpen(true)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] md:text-xxs font-bold transition-all cursor-pointer ${
              firebaseUser 
                ? "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/40 text-emerald-600 dark:text-emerald-400 shadow-xs" 
                : "bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"
            }`}
            id="cloud-auth-toggle-badge"
            title={firebaseUser ? "Connected to Cloud" : "Disconnected (Sandbox mode)"}
          >
            {firebaseUser ? (
              <>
                <CheckCircle2 size={12} className="text-emerald-500 animate-pulse" />
                <span>Cloud Auth: {currentUser.name.split(" ")[0]}</span>
              </>
            ) : (
              <>
                <CloudOff size={12} className="text-slate-400" />
                <span>Sandbox Session</span>
              </>
            )}
          </button>

          {/* Enterprise Offline Sync Indicator */}
          <button
            onClick={() => setIsSyncModalOpen(true)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] md:text-xxs font-bold transition-all cursor-pointer shadow-xs ${
              connectivityStatus === "online" 
                ? "bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900/40 text-blue-600 dark:text-blue-400" 
                : connectivityStatus === "recovered"
                ? "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/40 text-emerald-600 dark:text-emerald-400 animate-pulse"
                : connectivityStatus === "poor"
                ? "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/40 text-amber-600 dark:text-amber-400"
                : "bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/40 text-rose-600 dark:text-rose-400"
            }`}
            id="enterprise-sync-indicator"
            title={`Offline Sync Queue: ${offlineQueues.pending.length} pending, ${offlineQueues.conflict.length} conflicts. Click to open sync engine panel.`}
          >
            <div className="relative flex h-1.5 w-1.5 shrink-0">
              {connectivityStatus === "online" || connectivityStatus === "recovered" ? (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500"></span>
                </>
              ) : connectivityStatus === "poor" ? (
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500"></span>
              ) : (
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-rose-500 animate-pulse"></span>
              )}
            </div>
            <span>
              {connectivityStatus === "online" && `Online (${offlineQueues.pending.length})`}
              {connectivityStatus === "recovered" && "Syncing..."}
              {connectivityStatus === "poor" && `Poor Connection (${offlineQueues.pending.length})`}
              {connectivityStatus === "offline" && `Offline (${offlineQueues.pending.length})`}
            </span>
          </button>


          {/* Active Sandbox Role Swap (Essential for reviewing RBAC) */}
          {isSandbox && (
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-slate-700" id="role-impersonator-dropdown">
              <span className="text-[10px] text-slate-400 hidden lg:inline px-1 font-mono uppercase font-bold">Impersonate:</span>
              <select
                value={currentUser.id}
                onChange={(e) => handleUserSwap(e.target.value)}
                className="px-1 py-0.5 text-[10px] md:text-xxs font-bold text-slate-700 dark:text-slate-200 bg-transparent border-none outline-none cursor-pointer max-w-[100px] xs:max-w-none truncate"
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name.split(" ")[0]} ({u.role.substring(0, 10)}...)
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Bilingual Translation Switcher */}
          <button
            onClick={() => setLang(lang === "en" ? "ar" : "en")}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 flex items-center gap-1 text-[10px] md:text-xxs cursor-pointer"
            id="lang-toggle-btn"
          >
            <Globe size={13} />
            <span className="font-bold hidden xs:inline">{lang === "en" ? "العربية" : "English"}</span>
          </button>

          {/* Color theme mode switcher */}
          <button
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 cursor-pointer"
            id="theme-toggle-btn"
          >
            {theme === "light" ? <Moon size={13} /> : <Sun size={13} />}
          </button>

        </div>
      </header>

      {showSandboxBanner && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border-b border-amber-200/50 dark:border-amber-900/30 px-4 py-2 flex items-center justify-between gap-3 animate-fade-in" id="db-error-banner">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 text-xs font-semibold">
            <span className="flex h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
            <span>
              {connClass === "CLOUD_CONNECTED_WITH_MEMORY_PERSISTENCE" ? (
                lang === "ar"
                  ? "متصل بالسحابة. التخزين المؤقت المحلي في المتصفح غير متاح في هذا العرض التجريبي."
                  : "Cloud connected. Browser offline persistence is unavailable in this preview."
              ) : connClass === "DEGRADED_OPTIONAL_SERVICE" ? (
                lang === "ar"
                  ? "تحليلات الذكاء الاصطناعي غير متاحة مؤقتًا. بيانات CRM الأساسية تظل متصلة."
                  : "AI insights temporarily unavailable. Core CRM data remains connected."
              ) : connClass === "COLLECTION_PERMISSION_ERROR" ? (
                lang === "ar"
                  ? "متصل بالسحابة. بعض القيود المفروضة على مجموعات البيانات نشطة، ميزات CRM الأساسية متصلة بالكامل."
                  : "Cloud connected. Minor collection restrictions active (e.g. backend-only logs). Core CRM features fully online."
              ) : (
                lang === "ar"
                  ? "الاتصال بالسحابة غير متاح. نمط الاسترجاع المحلي للقراءة فقط نشط حاليًا."
                  : "Cloud connection unavailable. Local read-only recovery mode active."
              )}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {enableMockData && (
              <button
                onClick={handleDisableSandbox}
                className="text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded border border-amber-300 dark:border-amber-900 bg-white/40 dark:bg-amber-950/20 cursor-pointer"
              >
                {lang === "ar" ? "العودة للربط السحابي" : "Switch to Cloud Mode"}
              </button>
            )}
            <button 
              onClick={() => setIsBannerAcknowledged(true)}
              className="text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md hover:bg-amber-100 dark:hover:bg-amber-950/40 cursor-pointer shrink-0"
            >
              {lang === "ar" ? "إغلاق" : "Acknowledge"}
            </button>
          </div>
        </div>
      )}

      {/* Mobile Drawer Backdrop overlay */}
      {isMobileSidebarOpen && (
        <div 
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs md:hidden"
          onClick={() => setIsMobileSidebarOpen(false)}
        />
      )}

      {/* Mobile Slide-out Drawer */}
      <div 
        className={`fixed top-0 bottom-0 z-50 w-64 bg-slate-900 border-r border-slate-850 shadow-2xl transition-transform duration-300 md:hidden ${
          isMobileSidebarOpen 
            ? "translate-x-0" 
            : isRtl ? "translate-x-full" : "-translate-x-full"
        } ${isRtl ? "right-0" : "left-0"}`}
        id="mobile-sidebar-drawer"
      >
        {/* Header to close drawer */}
        <div className="flex justify-between items-center p-4 border-b border-slate-800 bg-slate-950">
          <span className="text-xxs font-bold uppercase tracking-wider text-slate-400">Navigation Menu</span>
          <button 
            onClick={() => setIsMobileSidebarOpen(false)}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>
        
        {/* Nested Sidebar */}
        <div className="h-[calc(100vh-50px)] overflow-y-auto">
          <Sidebar
            activeView={activeView}
            setActiveView={(view) => {
              setActiveView(view);
              setIsMobileSidebarOpen(false); // Auto close on click!
            }}
            currentUser={currentUser}
            lang={lang}
            permissionsMatrix={permissionsMatrix}
            accessGovernanceMatrix={accessGovernanceMatrix}
          />
        </div>
      </div>

      {/* Main split dashboard view */}
      <div className={`flex flex-col md:flex-row min-h-[calc(100vh-64px)] ${isRtl ? "md:flex-row-reverse" : ""}`} id="split-layout">
        
        {/* Navigation Sidebar (Desktop only) */}
        <div className="hidden md:block w-64 shrink-0 bg-slate-900 border-r border-slate-850" id="sidebar-container">
          <Sidebar
            activeView={activeView}
            setActiveView={setActiveView}
            currentUser={currentUser}
            lang={lang}
            permissionsMatrix={permissionsMatrix}
            accessGovernanceMatrix={accessGovernanceMatrix}
          />
        </div>

        {/* Scrollable Work area content with bottom nav padding offset on mobile */}
        <main className="flex-1 p-4 md:p-8 pb-20 md:pb-8 overflow-y-auto w-full max-w-full overflow-x-hidden" id="workspace-viewport">
          
          {/* Active View Router */}
          {(() => {
            console.info(
              "[PHYSICIAN_PROP_APP_JSON]",
              JSON.stringify({
                activeView,
                physicianCount: Array.isArray(enrichedPhysicians) ? enrichedPhysicians.length : 0,
                physicianIds: Array.isArray(enrichedPhysicians) ? enrichedPhysicians.map(p => p.id) : []
              })
            );
            return null;
          })()}
          <SidebarPageRouter
            activeView={activeView}
            setActiveView={setActiveView}
            currentUser={currentUser}
            setCurrentUser={setCurrentUser}
            users={users}
            setUsers={setUsers}
            physicians={enrichedPhysicians}
            pharmacies={pharmacies}
            products={products}
            productPromotionGroups={productPromotionGroups}
            keyMessages={keyMessages}
            permissionsMatrix={permissionsMatrix}
            accessGovernanceMatrix={accessGovernanceMatrix}
            setPermissionsMatrix={handleUpdatePermissions}
            physicianVisits={physicianVisits}
            physicianVisitReadState={physicianVisitReadState}
            physicianVisitSummaries={physicianVisitSummaries}
            physicianVisitSummaryStatus={physicianVisitSummaryStatus}
            loadScopedPhysicianHistory={loadScopedPhysicianHistory}
            pharmacyVisits={pharmacyVisits}
            pharmacyVisitReadState={pharmacyVisitReadState}
            importHistory={importHistory}
            auditLogs={auditLogs}
            handleLogAudit={handleLogAudit}
            handleCompletePhysicianVisit={handleCompletePhysicianVisit}
            handleCompletePharmacyVisit={handleCompletePharmacyVisit}
            handleImportSuccess={handleImportSuccess}
            handleRollbackImport={handleRollbackImport}
            onAddPhysician={handleAddPhysician}
            onUpdatePhysician={handleUpdatePhysician}
            onDeletePhysician={handleDeletePhysician}
            onAddPharmacy={handleAddPharmacy}
            onUpdatePharmacy={handleUpdatePharmacy}
            onDeletePharmacy={handleDeletePharmacy}
            onAddProduct={handleAddProduct}
            onUpdateProduct={handleUpdateProduct}
            onDeleteProduct={handleDeleteProduct}
            lang={lang}
            userTerritoryAssignments={userTerritoryAssignments}
            userProductAssignments={userProductAssignments}
            profileLoaded={profileLoaded}
            managerHydrated={managerHydrated}
            assignmentsHydrated={assignmentsHydrated}
            territoryAssignmentsHydrated={territoryAssignmentsHydrated}
            productAssignmentsHydrated={productAssignmentsHydrated}
            isOperational={isOperational}
            operationalReport={operationalReport}
            dbError={dbError}
            onViewVisitSummary={setSummaryModalVisit}
          />

        </main>

      </div>

      {/* Mobile Bottom Navigation Bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 h-16 flex items-center justify-around px-2 shadow-lg" id="mobile-bottom-nav">
        
        {/* Home option */}
        <button
          onClick={() => setActiveView("dashboard")}
          className={`flex flex-col items-center gap-0.5 cursor-pointer transition-all ${
            activeView === "dashboard" 
              ? "text-blue-600 dark:text-blue-400 font-extrabold scale-105" 
              : "text-slate-400 dark:text-slate-500 hover:text-slate-600"
          }`}
          id="mobile-btn-home"
        >
          <LayoutDashboard size={18} />
          <span className="text-[10px] font-medium tracking-tight">{isRtl ? "الرئيسية" : "Home"}</span>
        </button>

        {/* Team option */}
        <button
          onClick={() => setActiveView("territory-team-list")}
          className={`flex flex-col items-center gap-0.5 cursor-pointer transition-all ${
            activeView === "territory-team-list" 
              ? "text-blue-600 dark:text-blue-400 font-extrabold scale-105" 
              : "text-slate-400 dark:text-slate-500 hover:text-slate-600"
          }`}
          id="mobile-btn-team"
        >
          <Users size={18} />
          <span className="text-[10px] font-medium tracking-tight">{isRtl ? "الفريق" : "Team"}</span>
        </button>

        {/* Physicians option */}
        <button
          onClick={() => setActiveView("field-physician-list")}
          className={`flex flex-col items-center gap-0.5 cursor-pointer transition-all ${
            activeView === "field-physician-list" 
              ? "text-blue-600 dark:text-blue-400 font-extrabold scale-105" 
              : "text-slate-400 dark:text-slate-500 hover:text-slate-600"
          }`}
          id="mobile-btn-physicians"
        >
          <Stethoscope size={18} />
          <span className="text-[10px] font-medium tracking-tight">{isRtl ? "الأطباء" : "Physicians"}</span>
        </button>

        {/* GPS option */}
        <button
          onClick={() => setActiveView("field-gps-verified")}
          className={`flex flex-col items-center gap-0.5 cursor-pointer transition-all ${
            activeView === "field-gps-verified" 
              ? "text-blue-600 dark:text-blue-400 font-extrabold scale-105" 
              : "text-slate-400 dark:text-slate-500 hover:text-slate-600"
          }`}
          id="mobile-btn-gps"
        >
          <MapPin size={18} />
          <span className="text-[10px] font-medium tracking-tight">{isRtl ? "الموقع" : "GPS"}</span>
        </button>

        {/* Alerts option with counter notification badge */}
        <button
          onClick={() => setActiveView("productivity-notifications")}
          className={`flex flex-col items-center gap-0.5 relative cursor-pointer transition-all ${
            activeView === "productivity-notifications" 
              ? "text-blue-600 dark:text-blue-400 font-extrabold scale-105" 
              : "text-slate-400 dark:text-slate-500 hover:text-slate-600"
          }`}
          id="mobile-btn-alerts"
        >
          <div className="relative">
            <Bell size={18} />
            <span className="absolute -top-1 -right-1.5 bg-red-500 text-white text-[8px] font-bold px-1 rounded-full animate-pulse">
              1
            </span>
          </div>
          <span className="text-[10px] font-medium tracking-tight">{isRtl ? "التنبيهات" : "Alerts"}</span>
        </button>
      </div>

      {/* Secure Authentication Overlay Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        lang={lang}
        onAuthSuccess={(profile) => {
          setCurrentUser(profile);
          setIsAuthModalOpen(false);
        }}
        currentRealUser={firebaseUser}
      />

      {/* Enterprise Offline Synchronization Engine Management Modal */}
      <OfflineSyncModal
        isOpen={isSyncModalOpen}
        onClose={() => setIsSyncModalOpen(false)}
        connectivityStatus={connectivityStatus}
        offlineQueues={offlineQueues}
      />

      {summaryModalVisit && (
        <VisitSummaryModal
          visit={summaryModalVisit}
          onClose={() => setSummaryModalVisit(null)}
          lang={lang}
          products={products}
          keyMessages={keyMessages}
        />
      )}

    </div>
    </OperationalScopeSessionProvider>
  );
}
