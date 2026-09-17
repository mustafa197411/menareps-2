import React, { useState } from "react";
import { 
  Users, 
  UserPlus, 
  Search, 
  MapPin, 
  AlertTriangle, 
  Edit2, 
  Trash2, 
  X, 
  RefreshCw,
  Eye,
  Key,
  LayoutGrid,
  Check,
  Shield,
  Activity,
  UserCheck,
  Lock,
  EyeOff,
  Sparkles,
  Info,
  Layers,
  SearchIcon,
  BookOpen,
  Download
} from "lucide-react";
import { Role, User, Country, District, City, Area, Product, ProductPromotionGroup, UserTerritoryAssignment, UserProductAssignment, CANONICAL_USER_ROLES } from "../types";
import { canViewUser, isLinkedPendingRecord } from "../lib/securityEngine";
import { doc, setDoc, getDoc, updateDoc, collection, onSnapshot, deleteDoc, getDocs, writeBatch, query, where } from "firebase/firestore";
import { handleFirestoreError, OperationType } from "../lib/firebaseError";
import { db, auth } from "../lib/firebase";
import { decorateRecord } from "../lib/firebaseSync";
import { createPendingUserWithActivationProfile, getEmailKey, createAuthUserViaAdminApi } from "../lib/firestoreService";
import { canCreateRole, canEditRole, validateManager, getReadiness, getValidManagerRoles } from "../lib/userPolicyEngine";
import { resolveCanonicalProductById, buildCanonicalProductAssignment, deriveEligibleProducts, getAssignableCanonicalProducts, calculateGroupRemovalImpact, validateSyncInputs, calculateSyncDiff, withoutFirestoreDocumentId } from "../lib/productAssignmentService";
import { removeUndefinedRecursively, sanitizeAndAuditPayload, isRepresentativeRole, sanitizeUserSavePayload } from "../utils/importNormalization";
import { getRepresentativeEditMasterDataReadiness, hydrateRepresentativeEditState, validateRepresentativePrimaryGroup } from "../lib/representativeEditState";
import { resolveUserIdentity } from "../lib/userIdentityResolver";
import { canonicalPathForArea, resolveAssignedRepresentativeScope } from "../lib/canonicalRepresentativeScope";
import { isDescendantInheritedScopeRole, resolveRoleAssignmentAdministrationContract, resolveRoleScopePolicy } from "../lib/roleScopePolicy";
import { getUserOperationalBadge } from "../lib/userOperationalBadge";
import { addCascadeSelections, applyCascadeRemoval, areasForSelectedCities, availableCountries, citiesForDistricts, districtsForCountries, hydrateMultiAreaCascade, removalImpact, selectionState, toggleCascadeArea, type CascadeRemovalImpact, type MultiAreaCascadeState } from "../lib/multiAreaCascade";

interface UserManagementProps {
  lang: "en" | "ar";
  users: User[];
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
  currentUser: User;
  setCurrentUser: (user: User) => void;
  handleLogAudit: (action: string, entity: string, details: string) => void;
  userTerritoryAssignments: UserTerritoryAssignment[];
  userProductAssignments: UserProductAssignment[];
  territoryAssignmentsHydrated: boolean;
  productAssignmentsHydrated: boolean;
}

export default function UserManagement({
  lang,
  users,
  setUsers,
  currentUser,
  setCurrentUser,
  handleLogAudit,
  userTerritoryAssignments,
  userProductAssignments,
  territoryAssignmentsHydrated,
  productAssignmentsHydrated,
}: UserManagementProps) {
  const isRtl = lang === "ar";

  // Diagnostic State
  const [diagnosticResults, setDiagnosticResults] = useState<any[] | null>(null);
  const [isRunningDiagnostics, setIsRunningDiagnostics] = useState(false);

  const runPermissionsDiagnostics = async () => {
    setIsRunningDiagnostics(true);
    setDiagnosticResults([]);
    const results: any[] = [];

    const authUid = auth.currentUser?.uid || "No Auth UID";
    const authEmail = auth.currentUser?.email || "No Auth Email";

    const addLog = (step: number, collection: string, path: string, payload: any, result: "SUCCESS" | "FAILED", code = "", message = "") => {
      const logEntry = {
        step,
        collection,
        path,
        authUid,
        authEmail,
        currentUserId: currentUser?.id || "N/A",
        currentUserRole: currentUser?.role || "N/A",
        currentUserActive: currentUser?.active !== undefined ? String(currentUser.active) : "N/A",
        employmentStatus: currentUser?.employmentStatus || "N/A",
        result,
        errorCode: code,
        errorMessage: message,
        payload
      };
      console.info(`[Diagnostic Step ${step}] ${collection} -> ${result}`, logEntry);
      results.push(logEntry);
      setDiagnosticResults([...results]);
    };

    // Diagnostics are deliberately read-only. Production diagnostics must not
    // create synthetic identities or probe authorization through writes.
    try {
      const path = `users/${authUid}`;
      const snapshot = await getDoc(doc(db, "users", authUid));
      addLog(1, "users", path, { exists: snapshot.exists() }, "SUCCESS");
    } catch (err: any) {
      addLog(1, "users", `users/${authUid}`, {}, "FAILED", err.code || "unknown", err.message || String(err));
    }

    try {
      const path = `userActivationProfiles/${authUid}`;
      const snapshot = await getDoc(doc(db, "userActivationProfiles", authUid));
      addLog(2, "userActivationProfiles", path, { exists: snapshot.exists() }, "SUCCESS");
    } catch (err: any) {
      addLog(2, "userActivationProfiles", `userActivationProfiles/${authUid}`, {}, "FAILED", err.code || "unknown", err.message || String(err));
    }

    try {
      const path = `rolePermissions/${currentUser.role}`;
      const snapshot = await getDoc(doc(db, "rolePermissions", currentUser.role));
      addLog(3, "rolePermissions", path, { exists: snapshot.exists() }, "SUCCESS");
    } catch (err: any) {
      addLog(3, "rolePermissions", `rolePermissions/${currentUser.role}`, {}, "FAILED", err.code || "unknown", err.message || String(err));
    }

    setIsRunningDiagnostics(false);
  };

  // State and logic for duplicate identity consolidation
  const [isCleaningUp, setIsCleaningUp] = useState(false);

  // WP-IDENTITY-1C: Eligibility filter for active operational identities
  const isEligibleActiveUser = React.useCallback((u: User) => {
    const usr = u as any;
    return (
      u.active !== false &&
      u.loginAllowed !== false &&
      u.isDeleted !== true &&
      usr.isOperational !== false &&
      usr.identityStatus !== "ARCHIVED_DUPLICATE" &&
      usr.identityStatus !== "ARCHIVED_USER" &&
      u.status !== "Archived" &&
      u.employmentStatus !== "Archived"
    );
  }, []);

  const duplicateReport = React.useMemo(() => {
    const emailGroups: { [email: string]: User[] } = {};
    users.filter(isEligibleActiveUser).forEach(u => {
      if (!u.email) return;
      const email = u.email.trim().toLowerCase();
      if (!emailGroups[email]) {
        emailGroups[email] = [];
      }
      emailGroups[email].push(u);
    });

    const duplicatePairs: { email: string; pendingUser: User; operationalUser: User }[] = [];
    Object.entries(emailGroups).forEach(([email, group]) => {
      if (group.length > 1) {
        const operational = group.find(u => u.authLinked === true || u.uid || u.firstLoginAt);
        const pending = group.find(u => !u.authLinked && !u.uid && !u.firstLoginAt);
        if (operational && pending && operational.id !== pending.id) {
          duplicatePairs.push({
            email,
            pendingUser: pending,
            operationalUser: operational
          });
        }
      }
    });

    return duplicatePairs;
  }, [users, isEligibleActiveUser]);

  const archivedHistoricalPairs = React.useMemo(() => {
    return users.filter(u => {
      const usr = u as any;
      return (
        usr.identityStatus === "ARCHIVED_DUPLICATE" || 
        usr.identityStatus === "ARCHIVED_USER" || 
        !!usr.duplicateOfUid
      );
    }).map(u => ({
      email: u.email || "",
      archivedDocumentId: u.id,
      canonicalUid: (u as any).duplicateOfUid || (u as any).canonicalUid || "",
      archiveReason: (u as any).archiveReason || "Canonical Firebase Auth UID migration",
      archivedAt: (u as any).archivedAt || (u as any).updatedAt || "",
      migrationRunId: (u as any).migrationRunId || ""
    }));
  }, [users]);

  const handlePurgeDuplicates = async () => {
    if (duplicateReport.length === 0) {
      alert(isRtl ? "لم يتم العثور على أي ملفات تعريف مكررة لتنقيتها!" : "No duplicate profiles found to purge!");
      return;
    }

    if (!window.confirm(
      isRtl 
        ? `هل أنت متأكد من رغبتك في دمج وتطهير ${duplicateReport.length} من الهويات المكررة؟ سيؤدي هذا إلى دمج السجلات والاحتفاظ بالملفات التشغيلية فقط بشكل نهائي.`
        : `Are you sure you want to consolidate and purge ${duplicateReport.length} duplicate user identity records? This will delete redundant pending documents and permanently preserve only the registered operational profiles.`
    )) {
      return;
    }

    setIsCleaningUp(true);
    let successCount = 0;
    let failedCount = 0;

    for (const pair of duplicateReport) {
      try {
        console.log(`[Consolidation Engine] Purging redundant pending document ${pair.pendingUser.id} for ${pair.email}...`);
        
        // Delete the pending user document in 'users' collection
        const pendingDocRef = doc(db, "users", pair.pendingUser.id);
        await deleteDoc(pendingDocRef);

        // Log audit event
        await handleLogAudit(
          "Delete", 
          "Users", 
          `Consolidated duplicate identity for email ${pair.email}. Purged redundant pending document ID: ${pair.pendingUser.id}. Preserved operational document ID: ${pair.operationalUser.id}.`
        );

        successCount++;
      } catch (err) {
        console.error(`[Consolidation Engine] Failed to purge redundant pending document for ${pair.email}:`, err);
        failedCount++;
      }
    }

    setIsCleaningUp(false);
    alert(
      isRtl 
        ? `اكتمل التطهير بنجاح! تم دمج وتصفية ${successCount} سجل مكرر بنجاح.${failedCount > 0 ? ` فشل في دمج ${failedCount} سجل.` : ""}`
        : `Consolidation and purge complete! Successfully cleared ${successCount} redundant pending user records.${failedCount > 0 ? ` Failed to clear ${failedCount} records.` : ""}`
    );
  };

  // State Management for filters
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("All");

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  // Reset pagination on filter or search change
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, roleFilter]);

  // Active Modals state: 'view_territories' | 'add_edit' | 'credentials' | 'sidebar' | 'delete' | null
  const [activeModal, setActiveModal] = useState<'view_territories' | 'add_edit' | 'credentials' | 'sidebar' | 'delete' | null>(null);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  // Form states for Add/Edit
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>(Role.SALES_REP);
  const [manager, setManager] = useState("");
  const [requiresDailyCheckIn, setRequiresDailyCheckIn] = useState(true);
  const [orderImageScanner, setOrderImageScanner] = useState(false);
  const [aiQuickAdd, setAiQuickAdd] = useState(false);
  const [activeAccount, setActiveAccount] = useState(true);

  // Geographic fields
  const [country, setCountry] = useState("");
  const [district, setDistrict] = useState("");
  const [city, setCity] = useState("");

  // Employment & Security fields
  const [employmentStatus, setEmploymentStatus] = useState("Active");
  const [securityScope, setSecurityScope] = useState("Territory Only");
  const [loginAllowed, setLoginAllowed] = useState(true);
  
  // Product & Territory checklists for Form drawer
  const [productSearch, setProductSearch] = useState("");
  const [territorySearch, setTerritorySearch] = useState("");
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [primaryPromotionGroupId, setPrimaryPromotionGroupId] = useState<string | null>(null);
  const [targetPromotionGroupIds, setTargetPromotionGroupIds] = useState<string[]>([]);
  const [legacyUnresolvedProducts, setLegacyUnresolvedProducts] = useState<string[]>([]);
  const [groupRemovalPending, setGroupRemovalPending] = useState<{
    groupId: string;
    groupName: string;
    isPrimary: boolean;
    newPrimaryGroupId?: string | null;
    affectedProducts: string[];
    unaffectedProductIds: string[];
  } | null>(null);
  const [selectedTerritories, setSelectedTerritories] = useState<string[]>([]);

  // Cascade state for selecting areas
  const [assignCountryIds, setAssignCountryIds] = useState<string[]>([]);
  const [assignDistrictIds, setAssignDistrictIds] = useState<string[]>([]);
  const [assignCityIds, setAssignCityIds] = useState<string[]>([]);
  const [geographyRemovalPending, setGeographyRemovalPending] = useState<CascadeRemovalImpact | null>(null);

  // Track assigned areas for the user in the form
  const [assignedAreas, setAssignedAreas] = useState<{ id: string; name: string }[]>([]);
  const assignedAreaItem = (area: Area) => ({
    id: area.id,
    name: `${area.countryName} / ${area.districtName} / ${area.cityName} / ${area.name}`,
  });
  const assignedAreaItemsForIds = (areaIds: string[]) => areaIds.flatMap(areaId => {
    const area = areasList.find(candidate => candidate.id === areaId);
    return area ? [assignedAreaItem(area)] : [];
  });
  const assignmentAdminContract = resolveRoleAssignmentAdministrationContract(role);
  const roleScopePolicy = resolveRoleScopePolicy(role);
  const inheritedScope = isDescendantInheritedScopeRole(role);
  const organizationScope = roleScopePolicy?.geographySource === "ORGANIZATION";
  const cascadeState = (): MultiAreaCascadeState => ({
    countryIds: assignCountryIds,
    districtIds: assignDistrictIds,
    cityIds: assignCityIds,
    areaIds: assignedAreas.map(area => area.id),
  });
  const applyCascadeState = (next: MultiAreaCascadeState) => {
    setAssignCountryIds(next.countryIds);
    setAssignDistrictIds(next.districtIds);
    setAssignCityIds(next.cityIds);
    setAssignedAreas(assignedAreaItemsForIds(next.areaIds));
  };
  const requestCascadeRemoval = (level: "country" | "district" | "city" | "area", ids: string[]) => {
    const impact = removalImpact(cascadeState(), level, ids, districtsList, citiesList, areasList);
    if (impact.districtIds.length || impact.cityIds.length || impact.areaIds.length) {
      setGeographyRemovalPending(impact);
      return;
    }
    applyCascadeState(applyCascadeRemoval(cascadeState(), impact));
  };
  const toggleCascadeParent = (level: "country" | "district" | "city", id: string, selected: boolean) => {
    if (!selected) return requestCascadeRemoval(level, [id]);
    const key = level === "country" ? "countryIds" : level === "district" ? "districtIds" : "cityIds";
    applyCascadeState(addCascadeSelections(cascadeState(), key, [id]));
  };

  const getValidManagersForRole = (targetRole: Role, allUsers: User[]): User[] => {
    return allUsers.filter((u) => {
      // Basic: cannot be the same user
      if (selectedUser && u.id === selectedUser.id) return false;

      // Must be active
      if (u.active === false || String(u.active).toLowerCase() === "false") return false;

      // Map roles allowed as managers for the targetRole from central policy engine
      const allowedManagerRoles = getValidManagerRoles(targetRole);

      return allowedManagerRoles.includes(u.role);
    });
  };

  // Master geography lists
  const [countriesList, setCountriesList] = useState<Country[]>([]);
  const [districtsList, setDistrictsList] = useState<District[]>([]);
  const [citiesList, setCitiesList] = useState<City[]>([]);
  const [areasList, setAreasList] = useState<Area[]>([]);
  const [productsList, setProductsList] = useState<Product[]>([]);
  const [promotionGroupsList, setPromotionGroupsList] = useState<ProductPromotionGroup[]>([]);
  const availableCountryOptions = availableCountries(countriesList);
  const availableDistrictOptions = districtsForCountries(districtsList, assignCountryIds);
  const availableCityOptions = citiesForDistricts(citiesList, assignCountryIds, assignDistrictIds);
  const availableAreaOptions = areasForSelectedCities(areasList, assignCountryIds, assignDistrictIds, assignCityIds);
  const derivedFormScope = assignedAreas.length
    ? resolveAssignedRepresentativeScope(assignedAreas.map(item => item.id), districtsList, citiesList, areasList)
    : null;
  const [isProductsLoading, setIsProductsLoading] = useState(true);
  const [isPromotionGroupsLoading, setIsPromotionGroupsLoading] = useState(true);
  const [productsLoadError, setProductsLoadError] = useState<string | null>(null);

  React.useEffect(() => {
    const unsubCountries = onSnapshot(collection(db, "countries"), (snap) => {
      const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Country));
      setCountriesList(docs);
    }, (err) => {
      console.error(err);
      setCountriesList([]);
    });

    const unsubDistricts = onSnapshot(collection(db, "districts"), (snap) => {
      const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as District));
      setDistrictsList(docs);
    }, (err) => {
      console.error(err);
      setDistrictsList([]);
    });

    const unsubCities = onSnapshot(collection(db, "cities"), (snap) => {
      const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as City));
      setCitiesList(docs);
    }, (err) => {
      console.error(err);
      setCitiesList([]);
    });

    const unsubAreas = onSnapshot(collection(db, "areas"), (snap) => {
      const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Area));
      setAreasList(docs);
    }, (err) => {
      console.error(err);
      setAreasList([]);
    });

    let productsLogged = false;
    const unsubProducts = onSnapshot(collection(db, "products"), (snap) => {
      const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product));
      if (!productsLogged) {
        productsLogged = true;
        const names = docs.map(p => (p as any).name || (p as any).productName || "Unnamed Product");
        console.info(`[UserManagement] Loaded ${docs.length} products from Firestore:`, names);
      }
      setProductsList(docs);
      setIsProductsLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, "products");
      setProductsList([]);
      setIsProductsLoading(false);
      setProductsLoadError(err.message || String(err));
    });

    const unsubPromotionGroups = onSnapshot(collection(db, "productPromotionGroups"), (snap) => {
      const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProductPromotionGroup));
      setPromotionGroupsList(docs);
      setIsPromotionGroupsLoading(false);
    }, (err) => {
      console.error("Error loading product promotion groups:", err);
      setPromotionGroupsList([]);
      setIsPromotionGroupsLoading(false);
    });

    return () => {
      unsubCountries();
      unsubDistricts();
      unsubCities();
      unsubAreas();
      unsubProducts();
      unsubPromotionGroups();
    };
  }, []);

  // Legacy summary fields never define authority; canonical area assignments do.
  React.useEffect(() => {
    if (assignmentAdminContract.canonicalGeography) {
      const scope = resolveAssignedRepresentativeScope(assignedAreas.map((area) => area.id), districtsList, citiesList, areasList);
      if (!scope) {
        setCountry("");
        setDistrict("");
        setCity("");
      } else {
        setCountry(scope.countryIds.length === 1 ? scope.countryIds[0] : "");
        setDistrict(scope.districtIds.length === 1 ? scope.districtIds[0] : "");
        setCity(scope.cityIds.length === 1 ? scope.cityIds[0] : "");
      }
    }
  }, [assignmentAdminContract.canonicalGeography, assignedAreas, districtsList, citiesList, areasList]);

  // Credentials form state
  const [credentialUsername, setCredentialUsername] = useState("");
  const [credentialPassword, setCredentialPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Sidebar Visibility checklist state
  const [sidebarItems, setSidebarItems] = useState<string[]>([
    "Dashboard",
    "Physicians",
    "Pharmacies",
    "GPS Verified Customers",
    "Visits",
    "Medical Planner",
    "Physician Visit",
    "My Territory",
    "Team",
    "Organization"
  ]);

  const sidebarOptions = [
    { label: "Dashboard", icon: <LayoutGrid size={15} /> },
    { label: "Physicians", icon: <Layers size={15} /> },
    { label: "Pharmacies", icon: <Layers size={15} /> },
    { label: "GPS Verified Customers", icon: <MapPin size={15} /> },
    { label: "Visits", icon: <Activity size={15} /> },
    { label: "Medical Planner", icon: <Activity size={15} /> },
    { label: "Physician Visit", icon: <Activity size={15} /> },
    { label: "My Territory", icon: <MapPin size={15} /> },
    { label: "Team", icon: <Users size={15} /> },
    { label: "Organization", icon: <Layers size={15} /> }
  ];

  // Localization
  const t = {
    en: {
      title: "User Management",
      subtitle: "Manage users, roles, and territory assignments",
      addUser: "Add User",
      totalUsers: "Total Users",
      assignedTerritories: "Assigned Territories",
      activeReps: "Active Reps",
      allUsersTitle: "All Users",
      searchPlaceholder: "Search by name or email...",
      allRoles: "All Roles",
      colUser: "User",
      colEmail: "Email",
      colRole: "Role",
      colTerritories: "Territories",
      colJoined: "Joined",
      colActions: "Actions",
      save: "Save",
      cancel: "Cancel",
      setUsername: "Username",
      setPassword: "Initial Password",
      generate: "Generate",
      usernameDesc: "Users will use this to log in",
      passwordDesc: "This is the initial signup password. Real logins authenticate directly via Firebase.",
      setCredsTitle: "Set Login Credentials",
      sidebarVisTitle: "Sidebar Visibility",
      sidebarVisSubtitle: "Configure which sidebar items can be seen.",
      selectAll: "Select All",
      deselectAll: "Deselect All",
      reset: "Reset",
      checkInLabel: "Requires Daily Check-In",
      checkInDesc: "When enabled, this user must check in before starting visits",
      scannerLabel: "Order Image Scanner",
      scannerDesc: "Allow this rep to scan order images using AI. Enable only for authorized reps.",
      quickAddLabel: "AI Quick-Add",
      quickAddDesc: "Allow this rep to use AI text input to quickly add order items by typing product names or codes.",
      assignedProductsLabel: "Assigned Products",
      assignedTerritoriesLabel: "Assigned Territories",
      firstName: "First Name",
      lastName: "Last Name",
      managerLabel: "Manager",
      noManager: "No Manager",
      auditCredentialsSet: "Credentials configured for user",
      auditSidebarSet: "Sidebar visibility configured for user",
      auditUserAdded: "Onboarded new user successfully",
      auditUserUpdated: "Updated user details"
    },
    ar: {
      title: "إدارة المستخدمين",
      subtitle: "إدارة المستخدمين والأدوار والمهام الجغرافية",
      addUser: "إضافة مستخدم",
      totalUsers: "إجمالي المستخدمين",
      assignedTerritories: "المناطق الجغرافية المسندة",
      activeReps: "المندوبين النشطين",
      allUsersTitle: "جميع المستخدمين",
      searchPlaceholder: "البحث عن طريق الاسم أو البريد الإلكتروني...",
      allRoles: "جميع الأدوار",
      colUser: "المستخدم",
      colEmail: "البريد الإلكتروني",
      colRole: "الدور الوظيفي",
      colTerritories: "المناطق",
      colJoined: "تاريخ الانضمام",
      colActions: "الإجراءات",
      save: "حفظ",
      cancel: "إلغاء",
      setUsername: "اسم المستخدم",
      setPassword: "كلمة المرور الأولية",
      generate: "توليد تلقائي",
      usernameDesc: "سيستخدم المستخدم هذا الاسم لتسجيل الدخول",
      passwordDesc: "هذه هي كلمة المرور الأولية للتسجيل. تسجيل الدخول الفعلي يتم مباشرة عبر Firebase.",
      setCredsTitle: "تعيين بيانات تسجيل الدخول",
      sidebarVisTitle: "رؤية القائمة الجانبية",
      sidebarVisSubtitle: "تكوين عناصر القائمة الجانبية التي يمكن للمستخدم رؤيتها.",
      selectAll: "تحديد الكل",
      deselectAll: "إلغاء تحديد الكل",
      reset: "إعادة تعيين",
      checkInLabel: "يتطلب تسجيل الحضور اليومي",
      checkInDesc: "عند التمكين، يجب على المستخدم تسجيل الحضور قبل بدء الزيارات",
      scannerLabel: "ماسح صور الطلبات",
      scannerDesc: "السماح للمندوب بمسح صور الطلبات بالذكاء الاصطناعي. متاح للمصرح لهم فقط.",
      quickAddLabel: "الإضافة السريعة بالذكاء الاصطناعي",
      quickAddDesc: "السماح للمندوب بإضافة المنتجات بسرعة للطلب عبر الكتابة النصية.",
      assignedProductsLabel: "المنتجات المسندة",
      assignedTerritoriesLabel: "المناطق المسندة",
      firstName: "الاسم الأول",
      lastName: "الاسم الأخير",
      managerLabel: "المدير المباشر",
      noManager: "بدون مدير",
      auditCredentialsSet: "تم ضبط بيانات الاعتماد للمستخدم",
      auditSidebarSet: "تم ضبط رؤية القائمة الجانبية للمستخدم",
      auditUserAdded: "تم تسجيل مستخدم جديد بنجاح",
      auditUserUpdated: "تم تحديث بيانات المستخدم"
    }
  }[lang];

  // Helper colors for different roles
  const getRoleBadgeStyle = (userRole: string) => {
    switch (userRole) {
      case Role.SUPER_ADMIN:
        return "bg-red-50 text-red-600 border border-red-100 dark:bg-red-950/20 dark:text-red-400 dark:border-red-900/30";
      case Role.ADMIN:
        return "bg-amber-50 text-amber-600 border border-amber-100 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/30";
      case Role.GENERAL_MANAGER:
        return "bg-purple-50 text-purple-600 border border-purple-100 dark:bg-purple-950/20 dark:text-purple-400 dark:border-purple-900/30";
      case Role.SALES_MARKETING_MANAGER:
        return "bg-orange-50 text-orange-600 border border-orange-100 dark:bg-orange-950/20 dark:text-orange-400 dark:border-orange-900/30";
      case Role.MARKETING_MANAGER:
        return "bg-teal-50 text-teal-600 border border-teal-100 dark:bg-teal-950/20 dark:text-teal-400 dark:border-teal-900/30";
      default:
        return "bg-blue-50 text-blue-600 border border-blue-100 dark:bg-blue-950/20 dark:text-blue-400 dark:border-blue-900/30";
    }
  };

  // Derived list of active promotion groups
  const activePromotionGroups = React.useMemo(() => {
    return promotionGroupsList.filter(g => g.isActive !== false);
  }, [promotionGroupsList]);

  // Filter out duplicate pending records and archived identities, showing only canonical active employees
  const activeUsersList = React.useMemo(() => {
    return users.filter(u => isEligibleActiveUser(u) && !isLinkedPendingRecord(u, users));
  }, [users, isEligibleActiveUser]);

  // Filter list
  const filteredUsers = activeUsersList.filter(user => {
    // Hierarchical security scope check
    if (!canViewUser(currentUser, user, activeUsersList)) return false;

    const matchesSearch = 
      user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRole = roleFilter === "All" || user.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  const totalPages = Math.ceil(filteredUsers.length / itemsPerPage);
  const paginatedUsers = filteredUsers.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Calculate stats dynamically
  const totalUsersKPI = activeUsersList.length;
  const assignedTerritoriesKPI = new Set(activeUsersList.flatMap(u => u.territories || [])).size;
  const activeRepsKPI = activeUsersList.filter(u => u.role === Role.SALES_REP && u.active !== false).length;

  // Handle Modals launch
  const openViewTerritories = (user: User) => {
    setSelectedUser(user);
    setActiveModal('view_territories');
  };

  const openCredentialsModal = (user: User) => {
    setSelectedUser(user);
    setCredentialUsername(user.username || user.email.split("@")[0]);
    setCredentialPassword(user.password || "");
    setShowPassword(false);
    setActiveModal('credentials');
  };

  const openSidebarVisibilityModal = (user: User) => {
    setSelectedUser(user);
    setSidebarItems(user.sidebarVisibility || sidebarOptions.map(o => o.label));
    setActiveModal('sidebar');
  };

  const openEditModal = async (user: User) => {
    try {
    const canonicalUserSnap = await getDoc(doc(db, "users", user.id));
    const canonicalUser = canonicalUserSnap.exists()
      ? ({ id: canonicalUserSnap.id, ...canonicalUserSnap.data() } as User)
      : user;
    const masterDataReadiness = getRepresentativeEditMasterDataReadiness({
      role: canonicalUser.role,
      productsLoading: isProductsLoading,
      promotionGroupsLoading: isPromotionGroupsLoading,
      productCount: productsList.length,
      promotionGroupCount: promotionGroupsList.length
    });
    if (!masterDataReadiness.ready) {
      console.warn("[WP710H_EDIT_MASTER_DATA_NOT_READY_JSON]", JSON.stringify({
        userId: canonicalUser.id,
        role: canonicalUser.role,
        productsLoaded: masterDataReadiness.productsLoaded,
        productCount: productsList.length,
        promotionGroupsLoaded: masterDataReadiness.promotionGroupsLoaded,
        promotionGroupCount: promotionGroupsList.length
      }));
      alert(isRtl
        ? "بيانات المنتجات ومجموعات الترويج لا تزال قيد التحميل. يرجى الانتظار ثم المحاولة مرة أخرى."
        : "Product and promotion-group data is still loading. Please wait and try again.");
      return;
    }
    const [productAssignmentSnap, territoryAssignmentSnap] = await Promise.all([
      getDocs(query(collection(db, "userProductAssignments"), where("userId", "==", user.id))),
      getDocs(query(collection(db, "userTerritoryAssignments"), where("userId", "==", user.id)))
    ]);
    const hydrated = hydrateRepresentativeEditState({
      user: canonicalUser,
      productAssignments: productAssignmentSnap.docs.map(item => item.data()),
      territoryAssignments: territoryAssignmentSnap.docs.map(item => item.data()),
      products: productsList,
      promotionGroups: promotionGroupsList,
      canonicalAssignmentsOnly: (() => {
        const contract = resolveRoleAssignmentAdministrationContract(canonicalUser.role);
        return contract.canonicalProducts && !contract.representativePromotionGroups;
      })()
    });

    setSelectedUser(canonicalUser);
    const names = canonicalUser.name.split(" ");
    setFirstName(canonicalUser.firstName || names[0] || "");
    setLastName(canonicalUser.lastName || names.slice(1).join(" ") || "");
    setEmail(canonicalUser.email);
    setRole(canonicalUser.role);
    setManager(canonicalUser.managerId || "");
    setRequiresDailyCheckIn(true);
    setOrderImageScanner(false);
    setAiQuickAdd(false);
    setActiveAccount(canonicalUser.active !== false);
    setSelectedTerritories(canonicalUser.territories || []);
    setSelectedProductIds(hydrated.selectedProductIds);
    setLegacyUnresolvedProducts(hydrated.legacyUnresolvedProducts);
    setPrimaryPromotionGroupId(hydrated.primaryPromotionGroupId);
    setTargetPromotionGroupIds(hydrated.targetPromotionGroupIds);
    setCountry(canonicalUser.country || "");
    setDistrict(canonicalUser.district || "");
    setCity(canonicalUser.city || "");
    setEmploymentStatus(canonicalUser.employmentStatus || (canonicalUser.active !== false ? "Active" : "Inactive"));
    setSecurityScope(canonicalUser.securityScope || "Territory Only");
    setLoginAllowed(canonicalUser.loginAllowed !== false);
    setCredentialUsername(canonicalUser.username || "");
    setCredentialPassword(canonicalUser.password || "");
    
    // Initialize Area assignments
    const initialAreas = hydrated.assignedAreaIds.map((id) => ({
      id,
      name: (() => {
        const area = areasList.find(item => item.id === id);
        return area
          ? `${area.countryName} / ${area.districtName} / ${area.cityName} / ${area.name}`
          : canonicalUser.areaNames?.[canonicalUser.areaIds?.indexOf(id) ?? -1] || id;
      })()
    }));
    setAssignedAreas(initialAreas);
    const cascade = hydrateMultiAreaCascade(hydrated.assignedAreaIds, areasList);
    setAssignCountryIds(cascade.countryIds);
    setAssignDistrictIds(cascade.districtIds);
    setAssignCityIds(cascade.cityIds);

    console.info("[WP710H_EDIT_OPEN_JSON]", JSON.stringify({
      userId: canonicalUser.id,
      role: canonicalUser.role,
      storedPrimaryPromotionGroupId: canonicalUser.primaryPromotionGroupId || null,
      storedTargetPromotionGroupIds: canonicalUser.targetPromotionGroupIds || [],
      storedProductIds: canonicalUser.products || [],
      hydratedPrimaryPromotionGroupId: hydrated.primaryPromotionGroupId,
      hydratedTargetPromotionGroupIds: hydrated.targetPromotionGroupIds,
      hydratedProductIds: hydrated.selectedProductIds,
      assignedAreaIds: hydrated.assignedAreaIds
    }));
    setActiveModal('add_edit');
    } catch (err: any) {
      console.error("[WP710H_EDIT_OPEN_FAILURE_JSON]", JSON.stringify({
        userId: user.id,
        errorCode: err?.code || "EDIT_HYDRATION_FAILED",
        errorMessage: err?.message || String(err)
      }));
      alert((isRtl ? "فشل تحميل بيانات المستخدم للتعديل:\n" : "Failed to load user edit data:\n") + (err?.message || err));
    }
  };

  const openAddUserModal = () => {
    setSelectedUser(null);
    setFirstName("");
    setLastName("");
    setEmail("");
    setRole(Role.SALES_REP);
    setManager("");
    setRequiresDailyCheckIn(true);
    setOrderImageScanner(false);
    setAiQuickAdd(false);
    setActiveAccount(true);
    setSelectedProductIds([]);
    setLegacyUnresolvedProducts([]);
    setPrimaryPromotionGroupId(null);
    setTargetPromotionGroupIds([]);
    setSelectedTerritories([]);
    setCountry("");
    setDistrict("");
    setCity("");
    setEmploymentStatus("Active");
    setSecurityScope("Territory Only");
    setLoginAllowed(true);
    setCredentialUsername("");
    setCredentialPassword("");
    
    // Clear Area assignments
    setAssignedAreas([]);
    setAssignCountryIds([]);
    setAssignDistrictIds([]);
    setAssignCityIds([]);
    setGeographyRemovalPending(null);

    setActiveModal('add_edit');
  };

  const handlePrimaryGroupChange = (groupId: string | null) => {
    // If Representative, do not allow removing/deselecting the Primary Group
    if ((role === Role.MEDICAL_REP || role === Role.SALES_REP) && (!groupId || groupId.trim() === "")) {
      alert(isRtl 
        ? "مجموعة الترويج الرئيسية مطلوبة لممثلي المبيعات والممثلين الطبيين!" 
        : "Primary Promotion Group is mandatory for Medical and Sales Representatives!");
      return;
    }

    // Filter out the selected primary group from additional target groups if it is already there
    if (groupId && targetPromotionGroupIds.includes(groupId)) {
      setTargetPromotionGroupIds(prev => prev.filter(id => id !== groupId));
    }

    if (primaryPromotionGroupId && primaryPromotionGroupId !== groupId) {
      const remainingGroupIds = [
        ...(groupId ? [groupId] : []),
        ...targetPromotionGroupIds
      ];
      const impact = calculateGroupRemovalImpact({
        removedGroupId: primaryPromotionGroupId,
        remainingGroupIds,
        selectedProductIds,
        products: productsList
      });

      if (impact.affectedProductIds.length > 0) {
        const groupName = promotionGroupsList.find(g => g.id === primaryPromotionGroupId)?.name || "Unknown Group";
        setGroupRemovalPending({
          groupId: primaryPromotionGroupId,
          groupName,
          isPrimary: true,
          newPrimaryGroupId: groupId,
          affectedProducts: impact.affectedProductIds,
          unaffectedProductIds: impact.unaffectedProductIds
        });
        return;
      }
    }
    setPrimaryPromotionGroupId(groupId);
  };

  const handleTargetGroupToggle = (groupId: string) => {
    // Primary group cannot be added to target groups
    if (groupId === primaryPromotionGroupId) {
      alert(isRtl 
        ? "لا يمكن إضافة مجموعة الترويج الرئيسية إلى المجموعات المستهدفة!" 
        : "Primary Promotion Group cannot appear in Target Groups!");
      return;
    }

    const isCurrentlySelected = targetPromotionGroupIds.includes(groupId);
    if (isCurrentlySelected) {
      const remainingGroupIds = [
        ...(primaryPromotionGroupId ? [primaryPromotionGroupId] : []),
        ...targetPromotionGroupIds.filter(id => id !== groupId)
      ];
      const impact = calculateGroupRemovalImpact({
        removedGroupId: groupId,
        remainingGroupIds,
        selectedProductIds,
        products: productsList
      });

      if (impact.affectedProductIds.length > 0) {
        const groupName = promotionGroupsList.find(g => g.id === groupId)?.name || "Unknown Group";
        setGroupRemovalPending({
          groupId,
          groupName,
          isPrimary: false,
          affectedProducts: impact.affectedProductIds,
          unaffectedProductIds: impact.unaffectedProductIds
        });
      } else {
        setTargetPromotionGroupIds(prev => prev.filter(id => id !== groupId));
      }
    } else {
      setTargetPromotionGroupIds(prev => {
        if (prev.includes(groupId)) return prev;
        return [...prev, groupId];
      });
    }
  };

  const handleConfirmGroupRemoval = () => {
    if (!groupRemovalPending) return;
    const { isPrimary, groupId, newPrimaryGroupId, unaffectedProductIds } = groupRemovalPending;
    setSelectedProductIds(unaffectedProductIds);
    if (isPrimary) {
      setPrimaryPromotionGroupId(newPrimaryGroupId ?? null);
    } else {
      setTargetPromotionGroupIds(prev => prev.filter(id => id !== groupId));
    }
    setGroupRemovalPending(null);
  };

  const handleCancelGroupRemoval = () => {
    setGroupRemovalPending(null);
  };

  const handleDeleteClick = (user: User) => {
    setSelectedUser(user);
    setActiveModal('delete');
  };

  // Save Credentials logic
  const handleSaveCredentials = async () => {
    if (!selectedUser) return;
    try {
      const updatedUser: User = {
        ...selectedUser,
        username: credentialUsername,
        password: "********" // Do not store plain text password in Firestore
      };
      const decorated = decorateRecord(updatedUser, currentUser.id, "update");
      await setDoc(doc(db, "users", updatedUser.id), decorated);
      
      handleLogAudit("Credentials", "Users", `${t.auditCredentialsSet}: ${selectedUser.name} (${credentialUsername})`);
      setActiveModal(null);
      alert(isRtl ? "تم تعيين بيانات الاعتماد بنجاح!" : "Credentials saved successfully!");
    } catch (err) {
      console.error("Error saving credentials:", err);
      alert(isRtl ? "فشل حفظ بيانات الاعتماد" : "Failed to save credentials");
    }
  };

  // Save Sidebar Visibility logic
  const handleSaveSidebar = async () => {
    if (!selectedUser) return;
    try {
      const updatedUser: User = {
        ...selectedUser,
        sidebarVisibility: sidebarItems
      };
      const decorated = decorateRecord(updatedUser, currentUser.id, "update");
      await setDoc(doc(db, "users", updatedUser.id), decorated);
      
      handleLogAudit("Sidebar", "Users", `${t.auditSidebarSet}: ${selectedUser.name}`);
      setActiveModal(null);
      alert(isRtl ? "تم حفظ صلاحيات القائمة بنجاح!" : "Sidebar visibility saved successfully!");
    } catch (err) {
      console.error("Error saving sidebar visibility:", err);
      alert(isRtl ? "فشل حفظ صلاحيات القائمة" : "Failed to save sidebar visibility");
    }
  };

  // Generate password helper
  const handleGeneratePassword = () => {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
    let generated = "";
    for (let i = 0; i < 10; i++) {
      generated += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setCredentialPassword(generated);
  };

  // Helper to save activation profile with exhaustive diagnostics on failure
  const saveActivationProfileWithDiagnostics = async (
    operation: "Create" | "Update" | "Delete" | "Deactivate",
    activationProfileDocumentId: string,
    data: any,
    isMerge = false
  ) => {
    const docPath = `userActivationProfiles/${activationProfileDocumentId}`;
    const sanitizedPayload = sanitizeUserSavePayload(activationProfileDocumentId, data.role || "", data);
    console.info(`[Activation Profile Write Log] Initiating ${operation} on ${docPath}`, {
      operation,
      collectionPath: docPath,
      authUid: currentUser?.id,
      currentUserRole: currentUser?.role,
      payload: sanitizedPayload
    });

    try {
      const docRef = doc(db, "userActivationProfiles", activationProfileDocumentId);
      if (isMerge) {
        await setDoc(docRef, sanitizedPayload, { merge: true });
      } else {
        await setDoc(docRef, sanitizedPayload);
      }
      console.info(`[Activation Profile Write Log] Success for ${operation} on ${docPath}`);
    } catch (err: any) {
      console.error("[Activation Profile Write Failed] Detailed Diagnostics:", {
        operation,
        collectionPath: docPath,
        authUid: currentUser?.id,
        currentUserRole: currentUser?.role,
        errorCode: err.code || "unknown_code",
        errorMessage: err.message || String(err)
      });
      throw err;
    }
  };

  // Onboard / Edit submit
  const handleSaveUserForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !email.trim()) {
      alert(isRtl ? "يرجى تعبئة الحقول المطلوبة!" : "Please fill out required fields!");
      return;
    }

    const syncAssignments = async (uId: string, uRole: string, areaIds: string[], productIds: string[]) => {
      const actorUid = auth.currentUser?.uid;
      if (!actorUid) throw new Error("A Firebase Auth UID is required for assignment synchronization.");
      const syncStartedMs = Date.now();
      const syncRunId = "sync_" + Date.now();
      const startedAt = new Date().toISOString();
      const canonicalAreaIds = Array.from(new Set(areaIds.filter(Boolean)));
      const canonicalProductIds = Array.from(new Set(productIds.filter(Boolean)));
      let checkpoint = "START";
      let firestoreOperation = "initialize";
      let failurePhase = "initialization";
      let failureOperation = "prepare";
      let failureDocumentPath = `users/${uId}`;
      let completedTerritoryCount = 0;
      let completedProductCount = 0;

      console.info("[WP710E_SYNC_START_JSON]", JSON.stringify({
        userId: uId,
        userDocumentId: uId,
        activationProfileId: uId,
        canonicalAreaIds,
        canonicalProductIds,
        primaryPromotionGroupId: primaryPromotionGroupId || null,
        targetPromotionGroupIds: Array.from(new Set(targetPromotionGroupIds.filter(Boolean))),
        timestamp: startedAt
      }));

      console.info("[WP710D_SYNC_INPUT_JSON]", JSON.stringify({
        targetUserId: uId,
        userDocumentId: uId,
        activationProfileDocumentId: uId,
        canonicalAreaIds,
        canonicalProductIds,
        primaryPromotionGroupId: primaryPromotionGroupId || null,
        targetPromotionGroupIds: Array.from(new Set(targetPromotionGroupIds.filter(Boolean)))
      }));

      if (selectedUser) {
        console.info("[WP710H_EDIT_SYNC_INPUT_JSON]", JSON.stringify({
          userId: uId,
          canonicalAreaIds,
          canonicalProductIds,
          primaryPromotionGroupId: primaryPromotionGroupId || null,
          targetPromotionGroupIds: Array.from(new Set(targetPromotionGroupIds.filter(Boolean)))
        }));
      }

      const updateSyncState = async (
        status: "PENDING" | "IN_PROGRESS" | "COMPLETE" | "FAILED",
        completedOps: number,
        errCode?: string,
        errMsg?: string
      ) => {
        const syncFields = {
          assignmentSyncStatus: status,
          assignmentSyncRunId: syncRunId,
          assignmentSyncStartedAt: startedAt,
          assignmentSyncCompletedAt: (status === "COMPLETE" || status === "FAILED") ? new Date().toISOString() : null,
          assignmentSyncErrorCode: errCode || null,
          assignmentSyncErrorMessage: errMsg || null,
          assignmentSyncExpectedOperations: 2,
          assignmentSyncCompletedOperations: completedOps
        };

        // The canonical users/{uid} state is authoritative and must succeed.
        const userRef = doc(db, "users", uId);
        const uSnap = await getDoc(userRef);
        if (!uSnap.exists()) {
          throw Object.assign(new Error(`Canonical user document users/${uId} does not exist.`), {
            code: "assignment-sync/canonical-user-missing"
          });
        }
        // Keep canonical user/profile status in one transition. A legacy email-key
        // profile is intentionally neither updated nor used as runtime state.
        const stateBatch = writeBatch(db);
        stateBatch.update(userRef, syncFields);
        const actRef = doc(db, "userActivationProfiles", uId);
        const actSnap = await getDoc(actRef);
        if (actSnap.exists()) stateBatch.update(actRef, syncFields);
        await stateBatch.commit();
      };

      // 1. Inputs validation
      const validation = validateSyncInputs({
        representativeUid: uId,
        selectedProductIds: canonicalProductIds,
        products: productsList,
        primaryPromotionGroupId: primaryPromotionGroupId,
        targetPromotionGroupIds: targetPromotionGroupIds,
        requirePromotionGroupSelection: assignmentAdminContract.representativePromotionGroups,
        promotionGroups: promotionGroupsList,
      });

      if (!validation.ok) {
        const errorMsg = validation.errors.join("\n");
        console.error("Validation failed during assignments synchronization:", errorMsg);
        await updateSyncState("FAILED", 0, "VALIDATION_FAILED", errorMsg);
        throw new Error(isRtl
          ? `فشل التحقق من المنتجات:\n${errorMsg}`
          : `Products validation failed:\n${errorMsg}`);
      }

      // Transition to IN_PROGRESS
      checkpoint = "WRITE_PENDING_STATUS";
      firestoreOperation = "update_sync_status_in_progress";
      console.info("[WP710E_STATUS_PENDING_WRITE_JSON]", JSON.stringify({
        userId: uId,
        status: "IN_PROGRESS",
        timestamp: new Date().toISOString()
      }));
      await updateSyncState("IN_PROGRESS", 0);
      console.info("[WP710E_STATUS_PENDING_COMPLETE_JSON]", JSON.stringify({
        userId: uId,
        status: "IN_PROGRESS",
        timestamp: new Date().toISOString()
      }));

      try {
        // --- CHUNK 1: Territory Assignments ---
        // Scoped Territory Assignment Query
        checkpoint = "READ_EXISTING";
        firestoreOperation = "read_user_territory_assignments";
        const existingAssignmentsReadStartedMs = Date.now();
        console.info("[WP710E_READ_EXISTING_ASSIGNMENTS_START_JSON]", JSON.stringify({
          userId: uId,
          timestamp: new Date().toISOString()
        }));
        const taQuery = query(
          collection(db, "userTerritoryAssignments"),
          where("userId", "==", uId)
        );
        const taSnap = await getDocs(taQuery);
        const existingTAs = taSnap.docs;

        const taBatchOps: Array<{ ref: any; data: any; type: "set" | "delete" }> = [];

        // Old Territory assignments to Deactivate
        for (const docObj of existingTAs) {
          const data = docObj.data();
          if (!canonicalAreaIds.includes(data.territoryId)) {
            taBatchOps.push({
              ref: doc(db, "userTerritoryAssignments", docObj.id),
              data: { ...data, status: "Inactive", active: false },
              type: "set"
            });
          }
        }

        // Active Territory assignments to Create / Update
        for (const areaId of canonicalAreaIds) {
          const matchedArea = areasList.find(a => a.id === areaId);
          const canonicalPath = canonicalPathForArea(areaId, districtsList, citiesList, areasList);
          if (!matchedArea || !canonicalPath) {
            throw Object.assign(new Error(`Area ${areaId} does not have one valid canonical Country / District / City / Area path.`), {
              code: "assignment-sync/invalid-geography-path"
            });
          }
          const taId = `TA_${uId}_${areaId}`;
          const taRecord = {
            assignmentId: taId,
            userId: uId,
            userRole: uRole,
            countryId: canonicalPath.countryId,
            districtId: canonicalPath.districtId,
            cityId: canonicalPath.cityId,
            territoryId: areaId,
            territoryName: `${matchedArea.countryName} / ${matchedArea.districtName} / ${matchedArea.cityName} / ${matchedArea.name}`,
            assignmentType: uRole.toLowerCase().includes("manager") ? "manager" : uRole.toLowerCase().includes("sales") ? "sales" : "medical",
            effectiveFrom: new Date().toISOString().split("T")[0],
            effectiveTo: "9999-12-31",
            status: "Active",
            active: true,
            assignedBy: actorUid,
            assignedAt: new Date().toISOString()
          };
          taBatchOps.push({
            ref: doc(db, "userTerritoryAssignments", taId),
            data: taRecord,
            type: "set"
          });
        }

        // --- CHUNK 2: Product Assignments ---
        // Scoped Product Assignment Query
        const paQuery = query(
          collection(db, "userProductAssignments"),
          where("userId", "==", uId)
        );
        firestoreOperation = "read_user_product_assignments";
        const paSnap = await getDocs(paQuery);
        const existingAssignments: any[] = paSnap.docs.map(d => ({ ...d.data(), id: d.id }));

        console.info("[WP710E_READ_EXISTING_ASSIGNMENTS_COMPLETE_JSON]", JSON.stringify({
          territoryCount: existingTAs.length,
          productCount: existingAssignments.length,
          territoryDocumentIds: existingTAs.map(item => item.id),
          productDocumentIds: paSnap.docs.map(item => item.id),
          elapsedMs: Date.now() - existingAssignmentsReadStartedMs
        }));

        const assignmentType = uRole.toLowerCase().includes("sales") ? "sales" : uRole.toLowerCase().includes("medical") ? "medical" : "both";
        checkpoint = "DIFF";
        firestoreOperation = "calculate_assignment_diff";
        console.info("[WP710E_DIFF_START_JSON]", JSON.stringify({
          userId: uId,
          timestamp: new Date().toISOString()
        }));
        const diff = calculateSyncDiff({
          representativeUid: uId,
          selectedProductIds: canonicalProductIds,
          products: productsList,
          existingAssignments,
          actorUid,
          assignmentType
        });

        console.info("Synchronization Diff calculated (Strategy B):", {
          toCreate: diff.toCreate.map(p => p.id),
          toRetain: diff.toRetain.map(a => a.productId),
          toReactivate: diff.toReactivate.map(a => a.productId),
          toUpdate: diff.toUpdate.map(x => x.updated.productId),
          toDeactivate: diff.toDeactivate.map(a => a.productId),
          legacyUnchanged: diff.legacyUnchanged.map(a => a.productId)
        });

        const paBatchOps: Array<{ ref: any; data: any; type: "set" | "delete" }> = [];

        // Create
        for (const product of diff.toCreate) {
          const paRecord = buildCanonicalProductAssignment({
            userId: uId,
            product,
            actorUid,
            assignmentType
          });
          paBatchOps.push({
            ref: doc(db, "userProductAssignments", paRecord.assignmentId),
            data: paRecord,
            type: "set"
          });
        }

        // Reactivate
        for (const assignment of diff.toReactivate) {
          paBatchOps.push({
            ref: doc(db, "userProductAssignments", assignment.assignmentId),
            data: assignment,
            type: "set"
          });
        }

        // Update
        for (const item of diff.toUpdate) {
          paBatchOps.push({
            ref: doc(db, "userProductAssignments", item.updated.assignmentId),
            data: item.updated,
            type: "set"
          });
        }

        // Deactivate
        for (const assignment of diff.toDeactivate) {
          const deactivatedPayload = {
            ...withoutFirestoreDocumentId(assignment),
            active: false,
            status: "Inactive" as const,
            deactivatedAt: new Date().toISOString(),
            deactivatedBy: actorUid,
            deactivationReason: "REMOVED_FROM_USER_ASSIGNMENT"
          };
          paBatchOps.push({
            ref: doc(db, "userProductAssignments", assignment.assignmentId),
            data: deactivatedPayload,
            type: "set"
          });
        }

        const totalWriteCount = taBatchOps.length + paBatchOps.length;
        if (totalWriteCount > 450) {
          throw Object.assign(new Error(`Atomic assignment synchronization requires ${totalWriteCount} writes; maximum supported is 450.`), {
            code: "assignment-sync/write-plan-too-large"
          });
        }

        console.info("[WP710D_SYNC_WRITE_PLAN_JSON]", JSON.stringify({
          territoryCreates: canonicalAreaIds.filter(areaId => !existingTAs.some(d => d.id === `TA_${uId}_${areaId}`)).length,
          territoryUpdates: canonicalAreaIds.filter(areaId => existingTAs.some(d => d.id === `TA_${uId}_${areaId}`)).length,
          territoryDeletes: existingTAs.filter(d => !canonicalAreaIds.includes(d.data().territoryId)).length,
          productCreates: diff.toCreate.length,
          productUpdates: diff.toReactivate.length + diff.toUpdate.length,
          productDeletes: diff.toDeactivate.length,
          deterministicDocumentIds: [
            ...taBatchOps.map(op => op.ref.id),
            ...paBatchOps.map(op => op.ref.id)
          ]
        }));

        const deterministicDocumentIds = [
          ...taBatchOps.map(op => op.ref.id),
          ...paBatchOps.map(op => op.ref.id)
        ];
        console.info("[WP710E_DIFF_COMPLETE_JSON]", JSON.stringify({
          territoryCreates: canonicalAreaIds.filter(areaId => !existingTAs.some(d => d.id === `TA_${uId}_${areaId}`)).length,
          territoryUpdates: canonicalAreaIds.filter(areaId => existingTAs.some(d => d.id === `TA_${uId}_${areaId}`)).length,
          territoryDeletes: existingTAs.filter(d => !canonicalAreaIds.includes(d.data().territoryId)).length,
          productCreates: diff.toCreate.length,
          productUpdates: diff.toReactivate.length + diff.toUpdate.length,
          productDeletes: diff.toDeactivate.length,
          deterministicDocumentIds
        }));

        // Territory and product replacements commit atomically. Stale records are only
        // deactivated if every replacement write is accepted by Firestore.
        failurePhase = "assignment_commit";
        failureOperation = "atomic_set";
        failureDocumentPath = paBatchOps[0]?.ref.path || taBatchOps[0]?.ref.path || `users/${uId}`;
        checkpoint = "BUILD_BATCH";
        firestoreOperation = "create_assignment_batch";
        console.info("[WP710E_BATCH_CREATE_JSON]", JSON.stringify({ batchInitialized: false }));
        const assignmentBatch = writeBatch(db);
        checkpoint = "WRITE_TERRITORIES";
        taBatchOps.forEach(op => {
          firestoreOperation = `${op.type}:${op.ref.path}`;
          console.info("[WP710E_TERRITORY_WRITE_START_JSON]", JSON.stringify({
            documentId: op.ref.id,
            operation: op.type,
            path: op.ref.path
          }));
          assignmentBatch.set(op.ref, removeUndefinedRecursively(op.data));
          console.info("[WP710E_TERRITORY_WRITE_COMPLETE_JSON]", JSON.stringify({
            documentId: op.ref.id,
            operation: op.type,
            path: op.ref.path
          }));
        });
        checkpoint = "WRITE_PRODUCTS";
        paBatchOps.forEach(op => {
          firestoreOperation = `${op.type}:${op.ref.path}`;
          console.info("[WP710E_PRODUCT_WRITE_START_JSON]", JSON.stringify({
            documentId: op.ref.id,
            productId: op.data?.productId || null,
            operation: op.type,
            path: op.ref.path
          }));
          assignmentBatch.set(op.ref, removeUndefinedRecursively(op.data));
          console.info("[WP710E_PRODUCT_WRITE_COMPLETE_JSON]", JSON.stringify({
            documentId: op.ref.id,
            productId: op.data?.productId || null,
            operation: op.type,
            path: op.ref.path
          }));
        });
        checkpoint = "COMMIT";
        firestoreOperation = "commit_assignment_batch";
        const batchCommitStartedMs = Date.now();
        console.info("[WP710E_BATCH_COMMIT_START_JSON]", JSON.stringify({
          writeCount: totalWriteCount,
          timestamp: new Date().toISOString()
        }));
        await assignmentBatch.commit();
        console.info("[WP710E_BATCH_COMMIT_SUCCESS_JSON]", JSON.stringify({
          elapsedMs: Date.now() - batchCommitStartedMs,
          writeCount: totalWriteCount
        }));
        completedTerritoryCount = canonicalAreaIds.length;
        completedProductCount = canonicalProductIds.length;

        checkpoint = "WRITE_ASSIGNMENT_STATUS";
        firestoreOperation = "update_sync_status_in_progress_complete_ops";
        console.info("[WP710E_STATUS_PENDING_WRITE_JSON]", JSON.stringify({
          userId: uId,
          status: "IN_PROGRESS",
          completedOperations: 2,
          timestamp: new Date().toISOString()
        }));
        await updateSyncState("IN_PROGRESS", 2);
        console.info("[WP710E_STATUS_PENDING_COMPLETE_JSON]", JSON.stringify({
          userId: uId,
          status: "IN_PROGRESS",
          completedOperations: 2,
          timestamp: new Date().toISOString()
        }));

        // Complete Synchronization
        failurePhase = "synchronization_status";
        failureOperation = "update_complete";
        failureDocumentPath = `users/${uId}`;
        checkpoint = "WRITE_COMPLETE_STATUS";
        firestoreOperation = "update_sync_status_complete";
        console.info("[WP710E_COMPLETE_STATUS_START_JSON]", JSON.stringify({
          userId: uId,
          status: "COMPLETE",
          timestamp: new Date().toISOString()
        }));
        await updateSyncState("COMPLETE", 2);
        console.info("[WP710E_COMPLETE_STATUS_SUCCESS_JSON]", JSON.stringify({
          userId: uId,
          status: "COMPLETE",
          timestamp: new Date().toISOString()
        }));

      } catch (err: any) {
        console.error("Failed to sync territory/product assignments collections:", err);
        console.error("[WP710D_SYNC_FAILURE_JSON]", JSON.stringify({
          targetUserId: uId,
          phase: failurePhase,
          operation: failureOperation,
          documentPath: failureDocumentPath,
          firebaseErrorCode: err.code || "unknown_error",
          firebaseErrorMessage: err.message || String(err),
          completedTerritoryCount,
          completedProductCount
        }));
        console.error("[WP710E_RUNTIME_EXCEPTION_JSON]", JSON.stringify({
          firebaseCode: err?.code || null,
          firebaseMessage: err?.message || String(err),
          exceptionName: err?.name || "Error",
          exceptionMessage: err?.message || String(err),
          stack: err?.stack || null,
          lastCompletedCheckpoint: checkpoint,
          firestoreOperation,
          userId: uId,
          timestamp: new Date().toISOString()
        }));
        try {
          await updateSyncState("FAILED", 0, err.code || "unknown_error", err.message || String(err));
        } catch (statusErr) {
          console.error("[WP710D_SYNC_STATUS_FAILURE] Failed to persist FAILED state without replacing the original error:", statusErr);
        }
        throw err;
      }

      checkpoint = "RETURN_SUCCESS";
      firestoreOperation = "return_success";
      console.info("[WP710E_RETURN_SUCCESS_JSON]", JSON.stringify({
        status: "COMPLETE",
        elapsedMs: Date.now() - syncStartedMs
      }));
    };

    const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
    const targetRole = role;
    const assignedScope = assignmentAdminContract.canonicalGeography
      ? resolveAssignedRepresentativeScope(assignedAreas.map((area) => area.id), districtsList, citiesList, areasList)
      : null;
    if (assignmentAdminContract.canonicalGeography && !assignedScope) {
      alert(isRtl ? "يجب إسناد مسار جغرافي معتمد وكامل واحد على الأقل." : "At least one complete canonical geography path is required.");
      return;
    }
    if (!assignmentAdminContract.canonicalGeography && !inheritedScope && !organizationScope && !country.trim()) { alert(isRtl ? "يجب اختيار دولة/سوق صالح." : "A canonical country/market is required."); return; }
    if (assignmentAdminContract.productScopeRequired && selectedProductIds.length === 0) {
      alert(isRtl ? "يجب إسناد منتج معتمد واحد على الأقل." : "At least one active canonical Product assignment is required.");
      return;
    }
    const primaryGroupValidation = validateRepresentativePrimaryGroup(role, primaryPromotionGroupId);
    if (selectedUser) {
      console.info("[WP710H_EDIT_SAVE_VALIDATION_JSON]", JSON.stringify({
        userId: selectedUser.id,
        role,
        primaryPromotionGroupId,
        targetPromotionGroupIds: Array.from(new Set(targetPromotionGroupIds.filter(Boolean))),
        selectedProductIds: Array.from(new Set(selectedProductIds.filter(Boolean))),
        assignedAreaIds: Array.from(new Set(assignedAreas.map(area => area.id).filter(Boolean))),
        isRepresentative: primaryGroupValidation.isRepresentative,
        validationResult: primaryGroupValidation.validationResult
      }));
    }
    if (selectedUser && primaryGroupValidation.validationResult !== "PASS") {
      console.error("[WP710H_EDIT_SAVE_FAILURE_JSON]", JSON.stringify({
        userId: selectedUser?.id || null,
        errorCode: primaryGroupValidation.validationResult,
        errorMessage: "Primary Promotion Group is mandatory for Medical and Sales Representatives."
      }));
      alert(isRtl
        ? "مجموعة الترويج الرئيسية مطلوبة لممثلي المبيعات والممثلين الطبيين!"
        : "Primary Promotion Group is mandatory for Medical and Sales Representatives!");
      return;
    }

    // 1. Actor authority check
    if (selectedUser) {
      if (!canEditRole(currentUser.role, targetRole)) {
        alert(isRtl 
          ? `ليس لديك صلاحية لتعديل دور من نوع: ${targetRole}` 
          : `You do not have the administrative authority to assign or edit the role: ${targetRole}`);
        return;
      }
    } else {
      if (!canCreateRole(currentUser.role, targetRole)) {
        alert(isRtl 
          ? `ليس لديك صلاحية لإنشاء مستخدم بدور من نوع: ${targetRole}` 
          : `You do not have the administrative authority to create a user with the role: ${targetRole}`);
        return;
      }
    }

    // 2. Duplicate email check (for Create mode or when email is edited)
    const normalizedNewEmail = email.trim().toLowerCase();
    const isNewUser = !selectedUser;
    const isEmailChanged = selectedUser && selectedUser.email.trim().toLowerCase() !== normalizedNewEmail;
    if (isNewUser || isEmailChanged) {
      const emailConflict = users.some(u => u.email.trim().toLowerCase() === normalizedNewEmail);
      if (emailConflict) {
        alert(isRtl ? "البريد الإلكتروني هذا مستخدم بالفعل!" : "This email address is already registered in the system!");
        return;
      }
      
      // Also check userActivationProfiles
      try {
        const emailKey = normalizedNewEmail.replace(/@/g, "-").replace(/\./g, "-");
        const activationRef = doc(db, "userActivationProfiles", emailKey);
        const activationSnap = await getDoc(activationRef);
        if (activationSnap.exists() && !activationSnap.data().isDeleted) {
          alert(isRtl 
            ? "البريد الإلكتروني هذا مسجل بالفعل في تفعيل معلق!" 
            : "This email address is already registered in a pending activation profile!");
          return;
        }
      } catch (err) {
        console.warn("[User Validation] Failed to verify activation profiles for duplication, continuing:", err);
      }
    }

    // Prepare temporary user representation for policy check
    const tempUser: Partial<User> = {
      id: selectedUser ? selectedUser.id : "temp-id",
      email: normalizedNewEmail,
      role: targetRole,
      managerId: manager || undefined,
      areaIds: assignedAreas.map(a => a.id),
      areaNames: assignedAreas.map(a => a.name),
      territories: assignedAreas.map(a => a.name),
      products: selectedProductIds,
      primaryPromotionGroupId: primaryPromotionGroupId || undefined,
      targetPromotionGroupIds: targetPromotionGroupIds.length > 0 ? targetPromotionGroupIds : undefined,
      active: activeAccount,
      employmentStatus: activeAccount ? "Active" : employmentStatus,
      loginAllowed: activeAccount ? true : loginAllowed,
      isDeleted: false
    };

    // 3. Manager Validation Check
    const mgrValidation = validateManager(tempUser, users);
    if (!mgrValidation.isValid) {
      alert(isRtl 
        ? `خطأ في تعيين المدير: ${mgrValidation.reason}` 
        : `Manager Validation Error: ${mgrValidation.reason}`);
      return;
    }

    // 4. Assignments & Readiness Check
    const readinessReport = getReadiness(tempUser, users);
    if (readinessReport.status === "Incomplete") {
      alert(isRtl
        ? `الحساب غير جاهز للعمل: ${readinessReport.reasons.join(", ")}`
        : `Operational Readiness Incomplete: ${readinessReport.reasons.join(", ")}`);
      return;
    }

    try {
      const isSeniorRole = ![
        Role.MEDICAL_REP, 
        Role.SALES_REP, 
        Role.MEDICAL_SUPERVISOR, 
        Role.SALES_SUPERVISOR, 
        Role.AREA_SALES_MANAGER, 
        Role.REGIONAL_MANAGER
      ].includes(role);

      if (selectedUser) {
        const activationRef = doc(db, "userActivationProfiles", selectedUser.id);
        const activationSnap = await getDoc(activationRef);
        const existingUsed = activationSnap.exists() ? (activationSnap.data()?.used ?? false) : false;

        // Edit mode
        if (selectedUser.id === currentUser.id && role !== selectedUser.role) {
          alert(isRtl ? "غير مسموح لك بتعديل دورك التشغيلي بنفسك!" : "You are not allowed to modify your own operational role!");
          return;
        }

        const foundManager = users.find(u => u.id === manager);
        const resolvedManagerId = foundManager ? foundManager.id : "";

        const updatedUser: User = {
          ...selectedUser,
          name: fullName,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim().toLowerCase(),
          role: role,
          managerEmail: foundManager?.email || "",
          managerId: resolvedManagerId,
          areaIds: assignedAreas.map(a => a.id),
          areaNames: assignedAreas.map(a => a.name),
          assignedCountries: assignedScope?.countryIds || selectedUser.assignedCountries || [],
          territories: assignedAreas.map(a => a.name),
          territory: assignedAreas.length === 1 ? assignedAreas[0].name : (isSeniorRole ? "No Geographic Restriction" : "Multiple Areas"),
          products: selectedProductIds,
          primaryPromotionGroupId: assignmentAdminContract.representativePromotionGroups ? primaryPromotionGroupId || undefined : undefined,
          targetPromotionGroupIds: assignmentAdminContract.representativePromotionGroups && targetPromotionGroupIds.length > 0 ? targetPromotionGroupIds : undefined,
          active: activeAccount,
          sidebarVisibility: sidebarItems,
          username: credentialUsername,
          password: "********", // Do not store plain text password in Firestore
          country: country,
          district: district || (isSeniorRole ? "National Scope" : ""),
          city: city || (isSeniorRole ? "National Scope" : ""),
          region: district || (isSeniorRole ? "National Scope" : ""),
          employmentStatus: activeAccount ? "Active" : employmentStatus,
          status: activeAccount ? "Active" : (employmentStatus || "Inactive"),
          loginAllowed: activeAccount ? true : loginAllowed,
          isDeleted: false,
          securityScope: securityScope,
          assignmentSyncStatus: "PENDING"
        };
        const decorated = decorateRecord(updatedUser, currentUser.id, "update");
        const sanitizedUserPayload = sanitizeAndAuditPayload("users", updatedUser.id, decorated);
        
        // Diagnostics Log immediately before write
        console.info("[Users Write Log] Initiating write on users/" + updatedUser.id, {
          authUid: auth.currentUser?.uid,
          authEmail: auth.currentUser?.email,
          currentUserId: currentUser?.id,
          currentUserEmail: currentUser?.email,
          currentUserRole: currentUser?.role,
          currentUserActive: currentUser?.active,
          currentUserEmploymentStatus: currentUser?.employmentStatus,
          targetUserPath: "users/" + updatedUser.id,
          targetUserRole: updatedUser.role,
          fullSanitizedPayload: JSON.parse(JSON.stringify(sanitizedUserPayload))
        });

        try {
          await setDoc(doc(db, "users", updatedUser.id), sanitizedUserPayload);
        } catch (err: any) {
          console.error("=== STEP 1 USERS WRITE FAILED ===", {
            path: "users/" + updatedUser.id,
            payload: JSON.parse(JSON.stringify(sanitizedUserPayload)),
            authUid: auth.currentUser?.uid,
            authEmail: auth.currentUser?.email,
            currentUserRole: currentUser?.role,
            errorCode: err.code || "unknown_code",
            errorMessage: err.message || String(err),
            fullErrorObject: err
          });
          throw err;
        }
        
        // Save Activation Profile
        const activationData = {
          operationalUserId: updatedUser.id,
          linkedToUid: updatedUser.id,
          email: email.trim().toLowerCase(),
          name: fullName,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          role: role,
          active: activeAccount,
          status: activeAccount ? "Active" : (employmentStatus || "Inactive"),
          employmentStatus: activeAccount ? "Active" : employmentStatus,
          loginAllowed: activeAccount ? true : loginAllowed,
          isDeleted: false,
          managerEmail: foundManager?.email || "",
          managerId: resolvedManagerId,
          areaIds: assignedAreas.map(a => a.id),
          areaNames: assignedAreas.map(a => a.name),
          assignedCountries: assignedScope?.countryIds || selectedUser.assignedCountries || [],
          products: selectedProductIds || [],
          primaryPromotionGroupId: assignmentAdminContract.representativePromotionGroups ? primaryPromotionGroupId || undefined : undefined,
          targetPromotionGroupIds: assignmentAdminContract.representativePromotionGroups && targetPromotionGroupIds.length > 0 ? targetPromotionGroupIds : undefined,
          securityScope: securityScope || "personal",
          sidebarVisibility: sidebarItems || [],
          country: country,
          district: district || (isSeniorRole ? "National Scope" : ""),
          city: city || (isSeniorRole ? "National Scope" : ""),
          region: district || (isSeniorRole ? "National Scope" : ""),
          territory: assignedAreas.length === 1 ? assignedAreas[0].name : (isSeniorRole ? "No Geographic Restriction" : "Multiple Areas"),
          territories: assignedAreas.map(a => a.name),
          used: existingUsed,
          createdForActivation: true,
          updatedAt: new Date().toISOString(),
          assignmentSyncStatus: "PENDING"
        };
        await saveActivationProfileWithDiagnostics("Update", updatedUser.id, activationData);
        if (assignmentAdminContract.canonicalGeography || assignmentAdminContract.canonicalProducts) {
          await syncAssignments(updatedUser.id, role, assignedAreas.map(a => a.id), selectedProductIds || []);
        }

        console.info("[WP710H_EDIT_SAVE_SUCCESS_JSON]", JSON.stringify({
          userId: updatedUser.id,
          primaryPromotionGroupId: primaryPromotionGroupId || null,
          productIds: Array.from(new Set(selectedProductIds.filter(Boolean))),
          areaIds: Array.from(new Set(assignedAreas.map(area => area.id).filter(Boolean)))
        }));
        
        handleLogAudit("Update", "Users", `${t.auditUserUpdated}: ${fullName}`);
      } else {
        // Create mode
        if (!credentialPassword) {
          throw Object.assign(new Error("An explicit initial credential is required for account provisioning."), {
            code: "user-creation/initial-credential-required",
          });
        }
        console.info("[Users Write Log] Initiating user creation", {
          authUid: auth.currentUser?.uid,
          authEmail: auth.currentUser?.email,
          currentUserId: currentUser?.id,
          currentUserEmail: currentUser?.email,
          targetUserRole: role,
          activationPath: "userActivationProfiles/" + getEmailKey(email)
        });

        console.info("[Users Write Log] Attempting to create Auth account via Admin API...");
        const authRes = await createAuthUserViaAdminApi({
          email: email.trim().toLowerCase(),
          name: fullName,
          password: credentialPassword,
          disabled: !activeAccount,
          role,
        });
        if (!authRes.success || !authRes.authUid) {
          throw Object.assign(new Error("Firebase Authentication account creation did not return a UID."), {
            code: "user-creation/auth-uid-missing",
            stage: "CREATE_AUTH_ACCOUNT"
          });
        }
        const resolvedAuthUid = authRes.authUid;
        console.info("[Users Write Log] Successfully resolved Auth UID:", resolvedAuthUid);

        const foundManager = users.find(u => u.id === manager);
        const resolvedManagerId = foundManager ? foundManager.id : "";

        const pendingResult = await createPendingUserWithActivationProfile({
          authUid: resolvedAuthUid,
          email: email.trim().toLowerCase(),
          name: fullName,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          role: role,
          active: activeAccount,
          status: activeAccount ? "Active" : (employmentStatus || "Inactive"),
          employmentStatus: activeAccount ? "Active" : employmentStatus,
          loginAllowed: activeAccount ? true : loginAllowed,
          managerEmail: foundManager?.email || "",
          managerId: resolvedManagerId,
          areaIds: assignedAreas.map(a => a.id),
          areaNames: assignedAreas.map(a => a.name),
          assignedCountries: assignedScope?.countryIds || [],
          assignedProductIds: selectedProductIds || [],
          primaryPromotionGroupId: assignmentAdminContract.representativePromotionGroups ? primaryPromotionGroupId || undefined : undefined,
          targetPromotionGroupIds: assignmentAdminContract.representativePromotionGroups && targetPromotionGroupIds.length > 0 ? targetPromotionGroupIds : undefined,
          securityScope: securityScope || "Territory Only",
          sidebarVisibility: sidebarItems || [],
          country: country,
          district: district || (isSeniorRole ? "National Scope" : ""),
          city: city || (isSeniorRole ? "National Scope" : ""),
          region: district || (isSeniorRole ? "National Scope" : ""),
          territory: assignedAreas.length === 1 ? assignedAreas[0].name : (isSeniorRole ? "No Geographic Restriction" : "Multiple Areas"),
          territories: assignedAreas.map(a => a.name),
          username: credentialUsername || email.trim().toLowerCase().split("@")[0]
        }, `${t.auditUserAdded}: ${fullName}`);

        if (assignmentAdminContract.canonicalGeography || assignmentAdminContract.canonicalProducts) {
          await syncAssignments(pendingResult.userId, role, assignedAreas.map(a => a.id), selectedProductIds || []);
        }
      }

      setActiveModal(null);
    } catch (err: any) {
      if (selectedUser) {
        console.error("[WP710H_EDIT_SAVE_FAILURE_JSON]", JSON.stringify({
          userId: selectedUser.id,
          errorCode: err?.code || "unknown_error",
          errorMessage: err?.message || String(err)
        }));
      }
      console.error("Error saving user:", err);
      alert((isRtl ? "فشل حفظ المستخدم:\n" : "Failed to save user:\n") + (err.message || err));
    }
  };

  const handleConfirmDelete = async () => {
    if (!selectedUser) return;
    try {
      const docRef = doc(db, "users", selectedUser.id);
      await updateDoc(docRef, {
        active: false,
        loginAllowed: false,
        isOperational: false,
        identityStatus: "ARCHIVED_USER",
        status: "Archived",
        employmentStatus: "Archived",
        isDeleted: true,
        updatedAt: new Date().toISOString().replace("T", " ").substring(0, 19) + " UTC",
        updatedBy: currentUser.id
      });
      await saveActivationProfileWithDiagnostics("Delete", selectedUser.id, { isDeleted: true }, true);
      handleLogAudit("Delete", "Users", `Deactivated and archived user: ${selectedUser.name}`);
      setActiveModal(null);
      alert(isRtl ? "تم إيقاف وأرشفة الحساب بنجاح!" : "Account deactivated and archived successfully!");
    } catch (err: any) {
      console.error("Error archiving user:", err);
      alert(isRtl ? "فشل أرشفة الحساب" : "Failed to archive user account");
    }
  };

  return (
    <div className="space-y-6" id="user-management-system" dir={isRtl ? "rtl" : "ltr"}>
      
      {/* Title Bar Area matching Screen Shots */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4" id="um-main-header">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center text-blue-600 dark:text-blue-400">
            <Shield size={22} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
              {t.title}
            </h1>
            <p className="text-xs text-slate-400 dark:text-slate-500 font-medium">
              {t.subtitle}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={runPermissionsDiagnostics}
            disabled={isRunningDiagnostics}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg shadow-sm hover:shadow-md transition-all cursor-pointer flex items-center gap-1.5 shrink-0 disabled:opacity-50"
            id="btn-run-diagnostics"
          >
            <Activity size={15} className={isRunningDiagnostics ? "animate-pulse" : ""} />
            <span>{isRunningDiagnostics ? (isRtl ? "جاري الفحص..." : "Running...") : (isRtl ? "تشغيل الفحص" : "Run Diagnostics")}</span>
          </button>
          <button
            onClick={() => {
              import("xlsx").then((XLSX) => {
                import("../lib/schemaEngine").then(({ mapRecordForExport, TemplateSchemas }) => {
                  const headers = TemplateSchemas.users.filter(f => f.exportable).map(f => f.label);
                  const data = [headers];
                  
                  activeUsersList.forEach(u => {
                    const exportedObj = mapRecordForExport(u, "users");
                    const row = headers.map(header => exportedObj[header] || "");
                    data.push(row);
                  });
                  
                  const worksheet = XLSX.utils.aoa_to_sheet(data);
                  const workbook = XLSX.utils.book_new();
                  XLSX.utils.book_append_sheet(workbook, worksheet, "Users");
                  
                  XLSX.writeFile(workbook, `users_export_${new Date().toISOString().split("T")[0]}.xlsx`);
                });
              });
            }}
            className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold rounded-lg shadow-sm hover:shadow-md transition-all cursor-pointer flex items-center gap-1.5 shrink-0"
            id="btn-export-users"
          >
            <Download size={15} />
            <span>{isRtl ? "تصدير Excel" : "Export Excel"}</span>
          </button>
          <button
            onClick={openAddUserModal}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm hover:shadow-md transition-all cursor-pointer flex items-center gap-1.5 shrink-0"
            id="btn-add-user"
          >
            <UserPlus size={15} />
            <span>{t.addUser}</span>
          </button>
        </div>
      </div>

      {/* KPI Stats widgets designed beautifully exactly like Screenshots */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4" id="um-kpi-cards">
        
        {/* Total Users KPI Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-xl shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
            <Users size={22} />
          </div>
          <div>
            <div className="text-xxs font-semibold uppercase tracking-wider text-slate-400">{t.totalUsers}</div>
            <div className="text-2xl font-extrabold text-slate-800 dark:text-white mt-0.5">{totalUsersKPI}</div>
          </div>
        </div>

        {/* Assigned Territories KPI Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-xl shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <MapPin size={22} />
          </div>
          <div>
            <div className="text-xxs font-semibold uppercase tracking-wider text-slate-400">{t.assignedTerritories}</div>
            <div className="text-2xl font-extrabold text-slate-800 dark:text-white mt-0.5">{assignedTerritoriesKPI}</div>
          </div>
        </div>

        {/* Active Reps KPI Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-xl shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
            <Activity size={22} />
          </div>
          <div>
            <div className="text-xxs font-semibold uppercase tracking-wider text-slate-400">{t.activeReps}</div>
            <div className="text-2xl font-extrabold text-slate-800 dark:text-white mt-0.5">{activeRepsKPI}</div>
          </div>
        </div>

      </div>

      {/* Diagnostic Console Panel */}
      {diagnosticResults && (
        <div className="bg-slate-900 border border-slate-800 text-slate-100 p-6 rounded-xl shadow-lg font-mono text-xs space-y-4" id="diagnostic-results-panel">
          <div className="flex justify-between items-center border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2 text-amber-400">
              <Shield size={16} />
              <span className="font-bold uppercase tracking-wider">{isRtl ? "شاشة فحص صلاحيات الوصول والأمان" : "Authorization & Permissions Diagnostic Console"}</span>
            </div>
            <button 
              onClick={() => setDiagnosticResults(null)}
              className="text-slate-400 hover:text-white cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-950 p-4 rounded-lg border border-slate-850">
            <div>
              <div className="text-slate-500 uppercase text-[10px] font-semibold tracking-wider">{isRtl ? "بيانات المصادقة" : "Auth Session Properties"}</div>
              <div className="mt-2 space-y-1">
                <div><span className="text-blue-400">Firebase Auth UID:</span> {auth.currentUser?.uid || "N/A"}</div>
                <div><span className="text-blue-400">Firebase Auth Email:</span> {auth.currentUser?.email || "N/A"}</div>
                <div><span className="text-blue-400">Auth Provider:</span> {auth.currentUser?.providerData?.[0]?.providerId || "N/A"}</div>
                <div><span className="text-blue-400">request.auth exists?:</span> {auth.currentUser ? "true" : "false"}</div>
              </div>
            </div>
            <div>
              <div className="text-slate-500 uppercase text-[10px] font-semibold tracking-wider">{isRtl ? "ملف المستخدم الحالي" : "Current User Profile (Client Context)"}</div>
              <div className="mt-2 space-y-1">
                <div><span className="text-blue-400">Profile Doc ID:</span> {currentUser?.id || "N/A"}</div>
                <div><span className="text-blue-400">Profile Role:</span> {currentUser?.role || "N/A"}</div>
                <div><span className="text-blue-400">Profile Active:</span> {currentUser?.active !== undefined ? String(currentUser.active) : "N/A"}</div>
                <div><span className="text-blue-400">Employment Status:</span> {currentUser?.employmentStatus || "N/A"}</div>
                <div><span className="text-blue-400">Security Scope:</span> {currentUser?.securityScope || "N/A"}</div>
                <div><span className="text-blue-400">Manager Email:</span> {currentUser?.managerEmail || "N/A"}</div>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-slate-500 uppercase text-[10px] font-semibold tracking-wider">{isRtl ? "نتائج عمليات الكتابة المتتالية" : "Sequential Write Test Sequence"}</div>
            <div className="space-y-2.5 mt-2">
              {diagnosticResults.map((res) => (
                <div key={res.step} className={`p-3.5 rounded-lg border ${res.result === "SUCCESS" ? "bg-emerald-950/20 border-emerald-900/40 text-emerald-400" : "bg-rose-950/20 border-rose-900/40 text-rose-400"}`}>
                  <div className="flex justify-between items-center font-bold">
                    <span>{res.step}. [{res.collection}] WRITE: {res.path}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${res.result === "SUCCESS" ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"}`}>{res.result}</span>
                  </div>
                  <div className="text-[11px] text-slate-300 mt-1.5 space-y-1">
                    <div><span className="opacity-60">Payload:</span> {JSON.stringify(res.payload)}</div>
                    {res.result === "FAILED" && (
                      <div className="mt-1 font-semibold text-rose-300">
                        <div>Error Code: {res.errorCode}</div>
                        <div>Error Message: {res.errorMessage}</div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Database Identity & Cleanup Panel (Enterprise Section 1 Correction Panel) */}
      <div className="bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 p-5 rounded-xl shadow-xs space-y-5 mb-4" id="identity-cleanup-panel">
        {/* Section A: Active Identity Conflicts */}
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 flex items-center justify-center shrink-0">
                <Users size={20} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                  {isRtl ? "مركز محاذاة وتطهير الهويات المكررة" : "Database Identity Alignment & Cleanup Center"}
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 font-medium">
                  {isRtl 
                    ? `تم اكتشاف ${duplicateReport.length} من الهويات المكررة النشطة.` 
                    : `${duplicateReport.length} active identity conflicts detected.`}
                </p>
              </div>
            </div>
            {duplicateReport.length > 0 && (
              <button
                onClick={handlePurgeDuplicates}
                disabled={isCleaningUp}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400 text-white text-xs font-bold rounded-lg shadow-sm hover:shadow-md transition-all cursor-pointer flex items-center gap-1.5 self-end sm:self-center shrink-0"
                id="btn-purge-duplicates"
              >
                <Activity size={14} className={isCleaningUp ? "animate-spin" : ""} />
                <span>{isCleaningUp ? (isRtl ? "جاري التطهير..." : "Purging...") : (isRtl ? "دمج وتطهير السجلات" : "Consolidate & Purge")}</span>
              </button>
            )}
          </div>

          {duplicateReport.length > 0 ? (
            <div className="bg-white dark:bg-slate-950 border border-amber-150 dark:border-amber-900/10 rounded-lg overflow-hidden max-h-40 overflow-y-auto scrollbar-thin">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-400 uppercase tracking-wider text-[9px] font-bold">
                  <tr>
                    <th className="px-4 py-2">{isRtl ? "البريد الإلكتروني" : "Email Address"}</th>
                    <th className="px-4 py-2">{isRtl ? "معرف السجل المعلق" : "Pending Document ID"}</th>
                    <th className="px-4 py-2">{isRtl ? "معرف السجل التشغيلي" : "Operational Document ID"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-600 dark:text-slate-300 font-mono">
                  {duplicateReport.map((pair, index) => (
                    <tr key={index} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/20">
                      <td className="px-4 py-2 font-semibold text-slate-800 dark:text-white font-sans">{pair.email}</td>
                      <td className="px-4 py-2 text-red-500">{pair.pendingUser.id} <span className="text-[9px] bg-red-50 text-red-600 dark:bg-red-950/20 dark:text-red-400 px-1 py-0.2 rounded ml-1 font-sans font-bold">{isRtl ? "سيتلف" : "Purge Target"}</span></td>
                      <td className="px-4 py-2 text-emerald-500">{pair.operationalUser.id} <span className="text-[9px] bg-emerald-50 text-emerald-600 dark:bg-emerald-950/20 dark:text-emerald-400 px-1 py-0.2 rounded ml-1 font-sans font-bold">{isRtl ? "سيحفظ" : "Operational"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="bg-emerald-50/50 dark:bg-emerald-950/10 border border-emerald-200/50 dark:border-emerald-900/20 rounded-lg p-3 text-xs text-emerald-700 dark:text-emerald-400 font-medium flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
              <span>{isRtl ? "0 تعارضات هويات نشطة. جميع الهويات التشغيلية معتمدة وفريدة." : "0 active identity conflicts. All operational identities are unique and certified."}</span>
            </div>
          )}
        </div>

        {/* Section B: Archived Identity History */}
        {archivedHistoricalPairs.length > 0 && (
          <div className="pt-3 border-t border-slate-200/80 dark:border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300">
                {isRtl ? "سجل الهويات المؤرشفة (سجل تدقيق للقراءة فقط)" : "Archived Identity History (Read-Only Audit Trail)"}
              </h4>
              <span className="text-[10px] font-semibold text-slate-400 bg-slate-200/60 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                {archivedHistoricalPairs.length} {isRtl ? "سجلات أرشفة تاريخية" : "Historical Records"}
              </span>
            </div>

            <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden max-h-48 overflow-y-auto scrollbar-thin">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-slate-100/70 dark:bg-slate-900/80 text-slate-500 dark:text-slate-400 uppercase tracking-wider text-[9px] font-bold">
                  <tr>
                    <th className="px-3 py-2">{isRtl ? "البريد الإلكتروني" : "Email Address"}</th>
                    <th className="px-3 py-2">{isRtl ? "معرف المستند المؤرشف" : "Archived Document ID"}</th>
                    <th className="px-3 py-2">{isRtl ? "معرف Canonical UID" : "Canonical UID"}</th>
                    <th className="px-3 py-2">{isRtl ? "تاريخ الأرشفة" : "Archived Date"}</th>
                    <th className="px-3 py-2">{isRtl ? "سبب الأرشفة" : "Archive Reason"}</th>
                    <th className="px-3 py-2">{isRtl ? "الحالة" : "Status"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-600 dark:text-slate-300 font-mono text-[10px]">
                  {archivedHistoricalPairs.map((record, index) => (
                    <tr key={index} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/20">
                      <td className="px-3 py-1.5 font-semibold text-slate-800 dark:text-slate-200 font-sans">{record.email}</td>
                      <td className="px-3 py-1.5 text-slate-500">{record.archivedDocumentId}</td>
                      <td className="px-3 py-1.5 text-emerald-600 dark:text-emerald-400 font-semibold">{record.canonicalUid || "N/A"}</td>
                      <td className="px-3 py-1.5 text-slate-400 font-sans">{record.archivedAt ? record.archivedAt.substring(0, 10) : "N/A"}</td>
                      <td className="px-3 py-1.5 text-slate-500 font-sans">{record.archiveReason}</td>
                      <td className="px-3 py-1.5">
                        <span className="text-[9px] bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 px-1.5 py-0.5 rounded font-sans font-semibold">
                          {isRtl ? "مؤرشف تاريخي" : "Archived Duplicate"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Main card with the User List table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-850 rounded-xl overflow-hidden shadow-xs" id="um-all-users-card">
        
        {/* Table Title and Filters */}
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 space-y-4">
          <div className="flex items-center gap-2">
            <Users className="text-slate-400" size={18} />
            <h2 className="text-sm font-bold text-slate-800 dark:text-white">
              {t.allUsersTitle} ({filteredUsers.length})
            </h2>
          </div>

          <div className="flex flex-col sm:flex-row gap-2" id="um-filters">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 text-slate-400" size={15} />
              <input
                type="text"
                placeholder={t.searchPlaceholder}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className={`w-full py-2 bg-slate-50 hover:bg-slate-100 focus:bg-white dark:bg-slate-800/50 dark:hover:bg-slate-800 dark:focus:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-xs outline-hidden focus:ring-1 focus:ring-blue-500 transition-all ${isRtl ? "pr-3 pl-10 text-right" : "pl-10 pr-3"}`}
                id="input-table-search"
              />
            </div>

            {/* Role filter dropdown matching screenshot */}
            <div className="w-full sm:w-48">
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-lg text-xs text-slate-700 dark:text-slate-200 cursor-pointer focus:ring-1 focus:ring-blue-500 outline-none"
                id="select-role-filter"
              >
                <option value="All">{t.allRoles}</option>
                {CANONICAL_USER_ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Directory Table matching Screenshot 2 perfectly - Desktop View */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-left border-collapse" id="um-table">
            <thead>
              <tr className="bg-slate-50/50 dark:bg-slate-850/30 border-b border-slate-100 dark:border-slate-800 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                <th className="px-5 py-3">{t.colUser}</th>
                <th className="px-5 py-3">{isRtl ? "تسجيل الدخول والمدير" : "Access & Supervisor"}</th>
                <th className="px-5 py-3">{t.colRole}</th>
                <th className="px-5 py-3">{isRtl ? "النطاق والجغرافيا" : "Scope & Geography"}</th>
                <th className="px-5 py-3">{isRtl ? "حالة العمل" : "Employment Status"}</th>
                <th className="px-5 py-3 text-right pr-8">{t.colActions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs text-slate-700 dark:text-slate-300" id="um-table-body">
              {paginatedUsers.length > 0 ? (
                paginatedUsers.map((user) => {
                  const initials = user.name.split(" ").map(w => w[0]).join("").substring(0, 2).toUpperCase();
                  const showTerritories = user.territories && user.territories.length > 0;
                  
                  // Calculate Operational Readiness Status
                  const getOperationalStatusBadge = (u: any) => {
                    if (u.active === false || u.employmentStatus === "Inactive") {
                      return {
                        label: isRtl ? "غير نشط" : "Inactive",
                        style: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700",
                        dot: "bg-slate-400"
                      };
                    }

                    // For representatives, evaluate completeness dynamically
                    if (u.role === Role.MEDICAL_REP || u.role === Role.SALES_REP) {
                      const badge = getUserOperationalBadge(u, users, {
                        territoryAssignments: userTerritoryAssignments,
                        productAssignments: userProductAssignments,
                        territoryAssignmentsHydrated,
                        productAssignmentsHydrated,
                      });
                      if (badge.state === "ASSIGNMENTS_LOADING") {
                        return {
                          label: isRtl ? "جارٍ تحميل التعيينات التشغيلية" : "Loading Operational Assignments",
                          style: "bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900/30",
                          dot: "bg-blue-400"
                        };
                      }
                      if (badge.state === "AWAITING_GEOGRAPHY") {
                          return {
                            label: isRtl ? "بانتظار تعيين المنطقة" : "Awaiting Geography Assignment",
                            style: "bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-900/30",
                            dot: "bg-amber-400"
                          };
                      }
                      if (badge.state === "AWAITING_OPERATIONAL") {
                        return {
                          label: isRtl ? "بانتظار التعيين التشغيلي" : "Awaiting Operational Assignment",
                          style: "bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-900/30",
                          dot: "bg-amber-500"
                        };
                      }
                    }
                    
                    return {
                      label: isRtl ? "جاهز للعمل" : "Operational",
                      style: "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/30",
                      dot: "bg-emerald-500"
                    };
                  };
                  
                  const statusBadge = getOperationalStatusBadge(user);
                  
                  return (
                    <tr 
                      key={user.id} 
                      className="hover:bg-slate-50/40 dark:hover:bg-slate-850/20 transition-colors"
                    >
                      {/* Name & Initial Avatar */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full ${user.active !== false ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'} flex items-center justify-center font-bold text-xxs tracking-tight select-none`}>
                            {initials}
                          </div>
                          <div className="flex flex-col">
                            <span className="font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                              {user.name}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Access & Supervisor */}
                      <td className="px-5 py-3.5 space-y-1">
                        <div className="font-medium text-slate-600 dark:text-slate-300">{user.email}</div>
                        <div className="flex flex-wrap items-center gap-2 text-[10px]">
                          {user.username && (
                            <span className="bg-slate-100 dark:bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded font-mono">
                              👤 {user.username}
                            </span>
                          )}
                          {(user.managerId || (user.managerEmail && user.managerEmail !== "No Manager")) && (
                            <span className="bg-slate-100 dark:bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded">
                              💼 Mgr: {user.managerId
                                ? resolveUserIdentity(user.managerId, users, user.managerEmail || (isRtl ? "مدير غير معروف" : "Unknown manager"))
                                : user.managerEmail}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Role Badge formatted precisely */}
                      <td className="px-5 py-3.5">
                        <span className={`inline-block px-2 py-0.5 text-[11px] font-semibold rounded-full ${getRoleBadgeStyle(user.role)}`}>
                          {user.role}
                        </span>
                      </td>

                      {/* Scope & Geography */}
                      <td className="px-5 py-3.5 space-y-1.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="bg-indigo-50 text-indigo-600 dark:bg-indigo-950/20 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/30 px-1.5 py-0.5 rounded text-[10px] font-bold">
                            👁️ {user.securityScope || "Territory Only"}
                          </span>
                          {(user.country || user.region || user.city) && (
                            <span className="text-slate-400 text-[10px] font-semibold">
                              📍 {[user.country, user.region || user.district, user.city].filter(Boolean).join(" > ") || "—"}
                            </span>
                          )}
                        </div>
                        {showTerritories && (
                          <div className="flex items-center gap-1 flex-wrap max-w-xs">
                            <span className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-1.5 py-0.5 rounded text-[9px] font-medium max-w-[120px] truncate">
                              {user.territories?.[0]}
                            </span>
                            {user.territories && user.territories.length > 1 && (
                              <span className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-1.5 py-0.5 rounded text-[9px] font-medium max-w-[120px] truncate">
                                {user.territories?.[1]}
                              </span>
                            )}
                            {user.territories && user.territories.length > 2 && (
                              <span className="bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 px-1 py-0.5 rounded text-[9px] font-bold">
                                +{user.territories.length - 2}
                              </span>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Employment Status */}
                      <td className="px-5 py-3.5 space-y-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-[10px] font-semibold rounded-full ${statusBadge.style}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${statusBadge.dot}`} />
                            {statusBadge.label}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 font-medium">Joined {user.joinedDate || "2/21/2026"}</div>
                      </td>

                      {/* Actions Icons with Eye and Key matching Screenshot 2 */}
                      <td className="px-5 py-3.5 text-right pr-8">
                        <div className="flex items-center justify-end gap-1" dir="ltr">
                          
                          {/* View Territories (Eye) */}
                          <button
                            onClick={() => openViewTerritories(user)}
                            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors cursor-pointer"
                            title="View Territories"
                            id={`btn-view-territories-${user.id}`}
                          >
                            <Eye size={14} />
                          </button>

                          {/* Edit (Pencil) */}
                          <button
                            onClick={() => openEditModal(user)}
                            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors cursor-pointer"
                            title="Edit User"
                            id={`btn-edit-user-${user.id}`}
                          >
                            <Edit2 size={14} />
                          </button>

                          {/* Sidebar Visibility (Grid) */}
                          <button
                            onClick={() => openSidebarVisibilityModal(user)}
                            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors cursor-pointer"
                            title="Sidebar Visibility"
                            id={`btn-sidebar-visibility-${user.id}`}
                          >
                            <LayoutGrid size={14} />
                          </button>

                          {/* Credentials (Key) */}
                          <button
                            onClick={() => openCredentialsModal(user)}
                            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors cursor-pointer"
                            title="Credentials"
                            id={`btn-credentials-${user.id}`}
                          >
                            <Key size={14} />
                          </button>

                          {/* Delete Account */}
                          <button
                            onClick={() => handleDeleteClick(user)}
                            className="p-1.5 text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 rounded transition-colors cursor-pointer"
                            title="Delete Account"
                            disabled={user.id === currentUser.id}
                            id={`btn-delete-${user.id}`}
                          >
                            <Trash2 size={14} />
                          </button>

                        </div>
                      </td>

                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-slate-400 font-mono text-xs">
                    No directory users found matching the filter flags.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Directory Mobile-Friendly Cards - block on small screens, hidden on desktop. Prevent horizontal scroll */}
        <div className="block sm:hidden divide-y divide-slate-100 dark:divide-slate-800/60" id="um-mobile-list">
          {paginatedUsers.length > 0 ? (
            paginatedUsers.map((user) => {
              const initials = user.name.split(" ").map(w => w[0]).join("").substring(0, 2).toUpperCase();
              const showTerritories = user.territories && user.territories.length > 0;
              
              // Apply safe mobile text truncation & abbreviations so nothing spills or overflows the container
              const displayEmail = user.email.length > 25 
                ? `${user.email.substring(0, 22)}...` 
                : user.email;

              const displayName = user.name.length > 22
                ? `${user.name.substring(0, 19)}...`
                : user.name;

              return (
                <div key={user.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`w-8 h-8 rounded-full ${user.active !== false ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'} flex items-center justify-center font-bold text-xxs tracking-tight select-none shrink-0`}>
                        {initials}
                      </div>
                      <div className="min-w-0 flex flex-col items-start gap-0.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-semibold text-slate-800 dark:text-white block text-xs truncate" title={user.name}>
                            {displayName}
                          </span>
                          {user.active === false && (
                            <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 shrink-0">
                              {isRtl ? "غير نشط" : "Inactive"}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 block truncate" title={user.email}>
                          {displayEmail}
                        </span>
                      </div>
                    </div>
                    
                    <span className={`inline-block px-1.5 py-0.5 text-[9px] font-semibold rounded-full shrink-0 ${getRoleBadgeStyle(user.role)}`}>
                      {user.role}
                    </span>
                  </div>

                  {/* Territory information & Joined date for mobile view */}
                  <div className="flex justify-between items-center text-[10px] text-slate-500 dark:text-slate-400">
                    <div className="flex items-center gap-1 min-w-0">
                      <MapPin size={10} className="text-slate-400 shrink-0" />
                      {showTerritories ? (
                        <span className="truncate font-medium text-[10px]">
                          {user.territories?.[0]} {user.territories && user.territories.length > 1 ? `(+${user.territories.length - 1})` : ''}
                        </span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </div>
                    <span className="text-[9px] font-mono text-slate-400 shrink-0">
                      {user.joinedDate || "2/21/2026"}
                    </span>
                  </div>

                  {/* Actions Bar optimized for tap targets */}
                  <div className="flex items-center justify-end gap-1 pt-2 border-t border-slate-50 dark:border-slate-800/40" dir="ltr">
                    
                    {/* View (Eye) */}
                    <button
                      onClick={() => openViewTerritories(user)}
                      className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors cursor-pointer"
                      title="View Territories"
                      id={`btn-mobile-view-${user.id}`}
                    >
                      <Eye size={14} />
                    </button>

                    {/* Edit */}
                    <button
                      onClick={() => openEditModal(user)}
                      className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors cursor-pointer"
                      title="Edit User"
                      id={`btn-mobile-edit-${user.id}`}
                    >
                      <Edit2 size={14} />
                    </button>

                    {/* Sidebar Visibility */}
                    <button
                      onClick={() => openSidebarVisibilityModal(user)}
                      className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors cursor-pointer"
                      title="Sidebar Visibility"
                      id={`btn-mobile-sidebar-${user.id}`}
                    >
                      <LayoutGrid size={14} />
                    </button>

                    {/* Credentials */}
                    <button
                      onClick={() => openCredentialsModal(user)}
                      className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors cursor-pointer"
                      title="Credentials"
                      id={`btn-mobile-creds-${user.id}`}
                    >
                      <Key size={14} />
                    </button>

                    {/* Delete Account */}
                    <button
                      onClick={() => handleDeleteClick(user)}
                      className="p-2 text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 rounded transition-colors cursor-pointer"
                      title="Delete Account"
                      disabled={user.id === currentUser.id}
                      id={`btn-mobile-delete-${user.id}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="p-8 text-center text-slate-400 font-mono text-xs">
              No directory users found matching the filter flags.
            </div>
          )}
        </div>

        {/* Pagination Controls Footer - Helps with fast loading */}
        {totalPages > 1 && (
          <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-4 flex-col sm:flex-row bg-slate-50/50 dark:bg-slate-900" id="um-pagination">
            <span className="text-[10px] font-semibold text-slate-400">
              {isRtl 
                ? `عرض ${(currentPage - 1) * itemsPerPage + 1}-${Math.min(currentPage * itemsPerPage, filteredUsers.length)} من أصل ${filteredUsers.length} مستخدمين`
                : `Showing ${(currentPage - 1) * itemsPerPage + 1}-${Math.min(currentPage * itemsPerPage, filteredUsers.length)} of ${filteredUsers.length} users`
              }
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className="px-2.5 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xxs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors cursor-pointer"
              >
                {isRtl ? "السابق" : "Prev"}
              </button>
              
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  onClick={() => setCurrentPage(p)}
                  className={`w-7 h-7 flex items-center justify-center rounded-lg text-xxs font-bold transition-colors cursor-pointer ${
                    currentPage === p
                      ? "bg-blue-600 text-white"
                      : "border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  }`}
                >
                  {p}
                </button>
              ))}

              <button
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="px-2.5 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xxs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors cursor-pointer"
              >
                {isRtl ? "التالي" : "Next"}
              </button>
            </div>
          </div>
        )}

      </div>

      {/* 1. View Assigned Territories Modal (Screenshot 1) */}
      {activeModal === 'view_territories' && selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in" id="modal-view-territories">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
            
            {/* Header */}
            <div className="p-5 border-b border-slate-150 dark:border-slate-800 flex justify-between items-start">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-sm tracking-tight select-none shrink-0">
                  {selectedUser.name.split(" ").map(w => w[0]).join("").substring(0, 2).toUpperCase()}
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">{selectedUser.name}</h3>
                  <p className="text-xxs text-slate-400 font-medium">{selectedUser.email}</p>
                </div>
              </div>
              <button 
                onClick={() => setActiveModal(null)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Subheader Badges */}
            <div className="px-5 py-3.5 bg-slate-50/50 dark:bg-slate-850/50 border-b border-slate-150 dark:border-slate-800 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1 bg-red-50 text-red-600 border border-red-100 dark:bg-red-950/20 dark:text-red-400 dark:border-red-900/30 text-[10px] font-bold py-0.5 px-2.5 rounded-full">
                <Shield size={10} />
                {selectedUser.role}
              </span>
              <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 text-[10px] font-bold py-0.5 px-2.5 rounded-full">
                <MapPin size={10} />
                {selectedUser.territories?.[0] || selectedUser.territory || "National Scope"}
              </span>
            </div>

            {/* List of Grey Pills with Map Pins exactly like Screenshot 1 */}
            <div className="p-5 max-h-[380px] overflow-y-auto space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {(selectedUser.territories && selectedUser.territories.length > 0) ? (
                  selectedUser.territories.map((tName, i) => (
                    <div 
                      key={i}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[11px] font-medium border border-slate-200/50 dark:border-slate-700/50"
                    >
                      <MapPin size={10} className="text-slate-400 shrink-0" />
                      <span>{tName}</span>
                    </div>
                  ))
                ) : (
                  <div className="text-slate-400 text-center w-full py-4 text-xs font-mono">
                    No assigned territories found for this user.
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* 2. Set Login Credentials Modal (Screenshot 3) */}
      {activeModal === 'credentials' && selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in" id="modal-credentials">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden p-6 space-y-4">
            
            {/* Title Block with key icon */}
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-slate-800 dark:text-white flex items-center gap-1.5">
                <Key className="text-blue-500" size={16} />
                {t.setCredsTitle}
              </h3>
              <button 
                onClick={() => setActiveModal(null)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* User Details highlight block */}
            <div className="p-3 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-100 dark:border-slate-800/80 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-xxs tracking-tight select-none shrink-0">
                {selectedUser.name.split(" ").map(w => w[0]).join("").substring(0, 2).toUpperCase()}
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-800 dark:text-white">{selectedUser.name}</h4>
                <p className="text-[10px] text-slate-400 font-medium">{selectedUser.email}</p>
              </div>
            </div>

            {/* Fields form */}
            <div className="space-y-3.5">
              
              {/* Username Input */}
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">{t.setUsername}</label>
                <input
                  type="text"
                  placeholder="Enter username (min 3 characters)"
                  value={credentialUsername}
                  onChange={(e) => setCredentialUsername(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-transparent text-xs text-slate-800 dark:text-white outline-hidden focus:ring-1 focus:ring-blue-500"
                />
                <span className="text-[10px] text-slate-400 block mt-0.5">{t.usernameDesc}</span>
              </div>

              {/* Password Input with Generate */}
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">{t.setPassword}</label>
                  <button
                    onClick={handleGeneratePassword}
                    className="text-[10px] font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw size={10} />
                    <span>{t.generate}</span>
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter password (min 6 characters)"
                    value={credentialPassword}
                    onChange={(e) => setCredentialPassword(e.target.value)}
                    className="w-full pl-3 pr-10 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-transparent text-xs text-slate-800 dark:text-white outline-hidden focus:ring-1 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <span className="text-[10px] text-slate-400 block mt-0.5">{t.passwordDesc}</span>
              </div>

            </div>

            {/* Buttons matching screen shots */}
            <div className="pt-2 flex justify-end gap-2">
              <button
                onClick={() => setActiveModal(null)}
                className="px-4 py-1.5 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-850 text-slate-500 dark:text-slate-300 text-xs font-bold rounded-lg cursor-pointer"
              >
                {t.cancel}
              </button>
              <button
                onClick={handleSaveCredentials}
                className="px-5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors cursor-pointer"
              >
                {t.save}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* 3. Sidebar Visibility Modal (Screenshot 4) */}
      {activeModal === 'sidebar' && selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in" id="modal-sidebar">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden p-6 space-y-4">
            
            {/* Title block */}
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-sm font-bold text-slate-800 dark:text-white">{t.sidebarVisTitle}</h3>
                <p className="text-[10px] text-slate-400 font-medium mt-0.5">
                  {t.sidebarVisSubtitle.replace("[User Name]", selectedUser.name)}
                </p>
              </div>
              <button 
                onClick={() => setActiveModal(null)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Options bar with Select All, Deselect All, Reset */}
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setSidebarItems(sidebarOptions.map(o => o.label))}
                  className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-600 dark:text-slate-300 rounded-md cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700"
                >
                  {t.selectAll}
                </button>
                <button
                  onClick={() => setSidebarItems([])}
                  className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-600 dark:text-slate-300 rounded-md cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700"
                >
                  {t.deselectAll}
                </button>
              </div>

              <button
                onClick={() => {
                  const getRoleDefaultSidebarItems = (role: Role): string[] => {
                    if ([Role.SUPER_ADMIN, Role.ADMIN, Role.GENERAL_MANAGER, Role.COUNTRY_MANAGER].includes(role)) {
                      return ["Dashboard", "Physicians", "Pharmacies", "GPS Verified Customers", "Visits", "Medical Planner", "Physician Visit", "My Territory", "Team", "Organization"];
                    }
                    if (role === Role.MEDICAL_REP) {
                      return ["Dashboard", "Physicians", "GPS Verified Customers", "Visits", "Medical Planner", "Physician Visit", "My Territory", "Team"];
                    }
                    if (role === Role.SALES_REP) {
                      return ["Dashboard", "Pharmacies", "GPS Verified Customers", "Visits", "My Territory", "Team"];
                    }
                    if (role === Role.FINANCE) {
                      return ["Dashboard", "Sales & Orders", "Finance", "Account"];
                    }
                    if (role === Role.ORDER_OPS_OFFICER) {
                      return ["Dashboard", "Sales & Orders", "Order Operations", "Account"];
                    }
                    return ["Dashboard"];
                  };
                  setSidebarItems(getRoleDefaultSidebarItems(selectedUser.role));
                }}
                className="text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 flex items-center gap-1 cursor-pointer bg-blue-50 dark:bg-blue-950/30 px-2 py-1 rounded-md"
              >
                <RefreshCw size={10} />
                <span>{isRtl ? "إعادة تعيين الافتراضيات" : "Reset to Role Defaults"}</span>
              </button>
            </div>

            {/* Scrollable checklists */}
            <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1">
              {sidebarOptions.map((opt) => {
                const isChecked = sidebarItems.includes(opt.label);
                return (
                  <label 
                    key={opt.label}
                    className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-850 cursor-pointer select-none transition-colors border border-transparent hover:border-slate-100 dark:hover:border-slate-800"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="text-slate-400 shrink-0">
                        {opt.icon}
                      </div>
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{opt.label}</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSidebarItems(prev => [...prev, opt.label]);
                        } else {
                          setSidebarItems(prev => prev.filter(i => i !== opt.label));
                        }
                      }}
                      className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                    />
                  </label>
                );
              })}
            </div>

            {/* Buttons matching Screenshot 4 */}
            <div className="pt-2 flex justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={() => setActiveModal(null)}
                className="px-4 py-1.5 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-850 text-slate-500 dark:text-slate-300 text-xs font-bold rounded-lg cursor-pointer"
              >
                {t.cancel}
              </button>
              <button
                onClick={handleSaveSidebar}
                className="px-5 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold rounded-lg shadow-sm transition-colors cursor-pointer"
              >
                {t.save}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* 4. Add User Drawer/Modal Form exactly like Screenshot 5 */}
      {activeModal === 'add_edit' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in" id="modal-add-edit-user">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            
            {/* Header */}
            <div className="p-5 border-b border-slate-150 dark:border-slate-800 flex justify-between items-center">
              <h3 className="text-sm font-bold text-slate-800 dark:text-white">
                {selectedUser ? "Edit User" : "Add User"}
              </h3>
              <button 
                onClick={() => setActiveModal(null)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Scrollable Form body exactly like Screenshot 5 */}
            <form onSubmit={handleSaveUserForm} className="p-6 overflow-y-auto space-y-4 flex-1">
              
              {/* First & Last name row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">{t.firstName}</label>
                  <input
                    type="text"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-transparent text-xs text-slate-800 dark:text-white outline-hidden focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">{t.lastName}</label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-transparent text-xs text-slate-800 dark:text-white outline-hidden focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Email */}
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">{t.colEmail}</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-transparent text-xs text-slate-800 dark:text-white outline-hidden focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Role & Manager dropdowns side-by-side */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">{t.colRole}</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as Role)}
                    disabled={selectedUser?.id === currentUser.id}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-transparent text-xs text-slate-800 dark:text-white outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {!CANONICAL_USER_ROLES.includes(role as any) && (
                      <option value={role}>{role}</option>
                    )}
                    {CANONICAL_USER_ROLES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">{t.managerLabel}</label>
                  <select
                    value={manager}
                    onChange={(e) => setManager(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-transparent text-xs text-slate-800 dark:text-white outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                  >
                    <option value="">{t.noManager}</option>
                    {getValidManagersForRole(role, activeUsersList).map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} — {u.email} ({u.role}) [{u.country || "All Countries"} | Scope: {u.securityScope || u.region || u.territory || "National"}]
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Toggles Group precisely matching Screenshot 5 */}
              <div className="space-y-3.5 pt-2">
                
                {/* Toggle 1: Requires Daily Check-In */}
                <div className="p-3.5 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-4">
                  <div>
                    <h4 className="text-xs font-bold text-slate-800 dark:text-white">{t.checkInLabel}</h4>
                    <p className="text-[10px] text-slate-400 font-medium mt-0.5">{t.checkInDesc}</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={requiresDailyCheckIn}
                      onChange={(e) => setRequiresDailyCheckIn(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-200 dark:bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>

                {/* Toggle 2: Order Image Scanner */}
                <div className="p-3.5 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-4">
                  <div>
                    <h4 className="text-xs font-bold text-slate-800 dark:text-white">{t.scannerLabel}</h4>
                    <p className="text-[10px] text-slate-400 font-medium mt-0.5">{t.scannerDesc}</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={orderImageScanner}
                      onChange={(e) => setOrderImageScanner(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-200 dark:bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>

                {/* Toggle 3: AI Quick-Add */}
                <div className="p-3.5 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-4">
                  <div>
                    <h4 className="text-xs font-bold text-slate-800 dark:text-white">{t.quickAddLabel}</h4>
                    <p className="text-[10px] text-slate-400 font-medium mt-0.5">{t.quickAddDesc}</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={aiQuickAdd}
                      onChange={(e) => setAiQuickAdd(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-200 dark:bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>

                {/* Toggle 4: Active Account */}
                <div className="p-3.5 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-4">
                  <div>
                    <h4 className="text-xs font-bold text-slate-800 dark:text-white">{isRtl ? "حساب نشط" : "Active Account"}</h4>
                    <p className="text-[10px] text-slate-400 font-medium mt-0.5">{isRtl ? "تفعيل أو تعطيل هذا الحساب" : "Enable or disable this user account"}</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={activeAccount}
                      onChange={(e) => {
                        setActiveAccount(e.target.checked);
                        if (e.target.checked) {
                          setEmploymentStatus("Active");
                        } else {
                          setEmploymentStatus("Inactive");
                        }
                      }}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-200 dark:bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-500"></div>
                  </label>
                </div>

              </div>

              {/* Assigned Products Cascading Selector */}
              {inheritedScope && (
                <div className="p-4 bg-indigo-50/60 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-900/40 rounded-2xl space-y-2" data-scope-source="descendants">
                  <div className="text-xs font-bold text-indigo-700 dark:text-indigo-300">{isRtl ? "نطاق المنتجات" : "PRODUCT SCOPE"}</div>
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">{isRtl ? "موروث من المرؤوسين" : "Inherited from Subordinates"}</div>
                  <p className="text-[10px] text-slate-500">{isRtl ? "يتم احتساب المنتجات المعتمدة من المرؤوسين النشطين المسموح بهم وقت التشغيل. لا توجد تعيينات منتجات مباشرة مطلوبة لهذا الدور." : "Canonical Products are resolved at runtime from active permitted descendants. No direct Product assignment is required for this role."}</p>
                </div>
              )}
              {assignmentAdminContract.canonicalProducts && (
              <div className="space-y-3 p-3 bg-slate-50/50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 rounded-2xl">
                <div className="flex justify-between items-baseline">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                    {isRtl ? "مجموعات الترويج والمنتجات المسندة" : "Promotion Groups & Product Assignments"}
                  </label>
                  <span className="text-[10px] font-semibold text-blue-500">
                    {selectedProductIds.length} {isRtl ? "منتجات مسندة" : "Products Selected"}
                  </span>
                </div>

                {assignmentAdminContract.representativePromotionGroups && <>
                {/* Primary Promotion Group */}
                <div className="space-y-1">
                  <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                    {isRtl ? "مجموعة الترويج الرئيسية" : "Primary Promotion Group"}
                  </label>
                  <select
                    value={primaryPromotionGroupId || ""}
                    onChange={(e) => handlePrimaryGroupChange(e.target.value || null)}
                    className="w-full text-xs px-3 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg bg-transparent text-slate-700 dark:text-slate-300 outline-none focus:ring-1 focus:ring-blue-500 bg-white dark:bg-slate-900"
                  >
                    <option value="" className="text-slate-900">{isRtl ? "-- اختر المجموعة الرئيسية --" : "-- Select Primary Group --"}</option>
                    {activePromotionGroups.map((g) => (
                      <option key={g.id} value={g.id} className="text-slate-900">
                        {g.name} {g.code ? `(${g.code})` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Target Promotion Groups Checklist */}
                <div className="space-y-1">
                  <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                    {isRtl ? "مجموعات الترويج المستهدفة الإضافية" : "Additional Target Promotion Groups"}
                  </label>
                  <div className="max-h-[100px] overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 space-y-1.5 bg-slate-50/20 dark:bg-slate-850/10">
                    {activePromotionGroups.length === 0 ? (
                      <div className="text-[11px] text-slate-500 italic">
                        {isRtl ? "لا توجد مجموعات ترويج متاحة" : "No promotion groups available"}
                      </div>
                    ) : (
                      activePromotionGroups.map((g) => {
                        const isPrimary = g.id === primaryPromotionGroupId;
                        const isChecked = targetPromotionGroupIds.includes(g.id);
                        return (
                          <label
                            key={g.id}
                            className={`flex items-center gap-2 text-xs select-none ${isPrimary ? "opacity-50 cursor-not-allowed text-slate-400" : "cursor-pointer text-slate-700 dark:text-slate-300"}`}
                          >
                            <input
                              type="checkbox"
                              disabled={isPrimary}
                              checked={isPrimary || isChecked}
                              onChange={() => handleTargetGroupToggle(g.id)}
                              className="w-3.5 h-3.5 text-blue-600 rounded focus:ring-0 cursor-pointer"
                            />
                            <span className={isPrimary ? "font-bold text-slate-400" : "font-medium"}>
                              {g.name} {g.code ? `(${g.code})` : ""} {isPrimary && (isRtl ? "(رئيسية)" : "(Primary)")}
                            </span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Inline Group Removal Confirmation Dialog */}
                {groupRemovalPending && (
                  <div className="p-3 border border-red-200 dark:border-red-900/30 bg-red-50/50 dark:bg-red-950/10 rounded-xl space-y-2">
                    <div className="flex gap-2 text-red-600 dark:text-red-400">
                      <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                      <div className="text-xs font-semibold leading-relaxed">
                        {isRtl 
                          ? `تحذير: إزالة المجموعة "${groupRemovalPending.groupName}" سيؤدي إلى إلغاء تعيين المنتجات التالية:` 
                          : `Warning: Deselecting group "${groupRemovalPending.groupName}" will invalidate these assigned products:`}
                      </div>
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono pl-6 leading-relaxed max-h-[80px] overflow-y-auto">
                      {groupRemovalPending.affectedProducts.map(pid => {
                        const prod = productsList.find(p => p.id === pid);
                        return prod ? `${prod.name} [${prod.sku || prod.id}]` : pid;
                      }).join(", ")}
                    </div>
                    <div className="flex justify-end gap-2 text-[10px]">
                      <button
                        type="button"
                        onClick={handleCancelGroupRemoval}
                        className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded font-bold hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                      >
                        {isRtl ? "إلغاء التغيير" : "Cancel (Keep Group)"}
                      </button>
                      <button
                        type="button"
                        onClick={handleConfirmGroupRemoval}
                        className="px-2.5 py-1 bg-red-600 text-white rounded font-bold hover:bg-red-700 cursor-pointer"
                      >
                        {isRtl ? "نعم، احذف المنتجات" : "Yes, Remove Products"}
                      </button>
                    </div>
                  </div>
                )}

                {/* Legacy Unresolved Products Alert */}
                {legacyUnresolvedProducts.length > 0 && (
                  <div className="p-2 border border-amber-200 dark:border-amber-900/20 bg-amber-50/40 dark:bg-amber-950/5 rounded-xl space-y-1">
                    <div className="flex gap-1.5 text-amber-600 dark:text-amber-400 text-[10px] font-bold">
                      <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                      <span>{isRtl ? "المنتجات القديمة المعينة بالاسم:" : "Legacy Name-Based Assignments:"}</span>
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono leading-relaxed pl-4">
                      {legacyUnresolvedProducts.join(", ")}
                    </div>
                    <div className="text-[9px] text-slate-400 dark:text-slate-500 pl-4 leading-relaxed italic">
                      {isRtl 
                        ? "لم يتم العثور على معرّفات المنتج لهذه السجلات. سيتم الحفاظ عليها حتى تقوم بإعادة حفظ المستخدم." 
                        : "No Product IDs found for these records. They will be resolved once you re-assign them using the checkboxes below."}
                    </div>
                  </div>
                )}
                </>}

                {/* Eligible Products Checklist */}
                {(() => {
                  const eligibleProducts = assignmentAdminContract.representativePromotionGroups
                    ? deriveEligibleProducts({ products: productsList, primaryPromotionGroupId, targetPromotionGroupIds })
                    : getAssignableCanonicalProducts({ products: productsList, promotionGroups: promotionGroupsList });

                  const filteredEligibleProducts = eligibleProducts.filter(p => {
                    const searchLower = productSearch.toLowerCase();
                    const pName = (p.name || (p as any).productName || "").toLowerCase();
                    const pBrand = (p.brand || "").toLowerCase();
                    const pSku = (p.sku || "").toLowerCase();
                    return pName.includes(searchLower) || pBrand.includes(searchLower) || pSku.includes(searchLower);
                  });

                  const handleSelectAllEligible = () => {
                    const eligibleIds = filteredEligibleProducts.map(p => p.id);
                    setSelectedProductIds(prev => {
                      const union = new Set([...prev, ...eligibleIds]);
                      return Array.from(union);
                    });
                  };

                  const handleClearAllEligible = () => {
                    const eligibleIdsSet = new Set(filteredEligibleProducts.map(p => p.id));
                    setSelectedProductIds(prev => prev.filter(id => !eligibleIdsSet.has(id)));
                  };

                  return (
                    <div className="space-y-2 border-t border-slate-100 dark:border-slate-800/60 pt-2.5">
                      <div className="flex justify-between items-baseline">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                          {t.assignedProductsLabel} ({eligibleProducts.length} {isRtl ? "مؤهلة" : "Eligible"})
                        </label>
                        {eligibleProducts.length > 0 && (
                          <div className="flex gap-2 text-[10px]">
                            <button
                              type="button"
                              onClick={handleSelectAllEligible}
                              className="font-bold text-blue-600 hover:text-blue-700 cursor-pointer"
                            >
                              {t.selectAll}
                            </button>
                            <span className="text-slate-300">|</span>
                            <button
                              type="button"
                              onClick={handleClearAllEligible}
                              className="font-bold text-slate-500 hover:text-slate-600 cursor-pointer"
                            >
                              {isRtl ? "إلغاء تحديد الكل" : "Clear All"}
                            </button>
                          </div>
                        )}
                      </div>

                      {eligibleProducts.length > 0 && (
                        <div className="relative">
                          <SearchIcon className="absolute left-2.5 top-2.5 text-slate-400" size={13} />
                          <input
                            type="text"
                            placeholder={isRtl ? "ابحث بين المنتجات المؤهلة..." : "Search eligible products..."}
                            value={productSearch}
                            onChange={(e) => setProductSearch(e.target.value)}
                            className="w-full pl-8 pr-3 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-700 dark:text-slate-300 outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                      )}

                      <div className="max-h-[140px] overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-xl p-3 space-y-2.5 bg-slate-50/20 dark:bg-slate-850/10">
                        {eligibleProducts.length === 0 ? (
                          <div className="text-center py-6 text-xs text-slate-500 leading-relaxed italic">
                            {assignmentAdminContract.representativePromotionGroups
                              ? (isRtl ? "يرجى تحديد مجموعة ترويج (رئيسية أو إضافية) لعرض المنتجات المؤهلة." : "Please select a Promotion Group (Primary or Additional) to display eligible products.")
                              : (isRtl ? "لا توجد منتجات نشطة مرتبطة بمجموعة ترويج معتمدة." : "No active Products with a canonical Promotion Group are available.")}
                          </div>
                        ) : filteredEligibleProducts.length === 0 ? (
                          <div className="text-center py-6 text-xs text-slate-500">
                            {isRtl ? "لم يتم العثور على أي منتج يطابق البحث" : "No products match your search query."}
                          </div>
                        ) : (
                          filteredEligibleProducts.map(p => {
                            const pName = p.name || (p as any).productName || "Unnamed Product";
                            const pBrand = p.brand || pName;
                            const isChecked = selectedProductIds.includes(p.id);
                            return (
                              <label key={p.id} className="flex items-start gap-2.5 cursor-pointer text-xs font-semibold text-slate-700 dark:text-slate-300 select-none">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedProductIds(prev => [...prev, p.id]);
                                    } else {
                                      setSelectedProductIds(prev => prev.filter(id => id !== p.id));
                                    }
                                  }}
                                  className="w-4 h-4 text-blue-600 rounded mt-0.5 focus:ring-0 cursor-pointer"
                                />
                                <div className="flex flex-col">
                                  <span>{pName} {pBrand && pBrand !== pName ? `(${pBrand})` : ""}</span>
                                  {!assignmentAdminContract.representativePromotionGroups && <span className="text-[9px] text-slate-500">{promotionGroupsList.find(group => group.id === p.promotionGroupId)?.name}</span>}
                                  <span className="text-[9px] text-slate-400 font-mono mt-0.5">{p.sku || p.id}</span>
                                </div>
                              </label>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
              )}

              {(role === Role.FINANCE || role === Role.ORDER_OPS_OFFICER || role === Role.FINANCE_MANAGER) && (
                <div className="p-4 bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 rounded-2xl space-y-2">
                  <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300 font-bold text-xs">
                    <Shield size={16} />
                    <span>{isRtl ? "توصيات نطاق وصلاحيات ضابط الطلبات" : "Order Officer Scope & Capabilities Recommendation"}</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    {isRtl
                      ? "دور ضابط المالية / العمليات مخصص لمراجعة وتدقيق طلبات الشراء Commercial Orders. يستوجب تحديد الدولة (ليبيا) ونطاق الأمان الوطني (National Scope). صلاحيات الطلبات تقتصر على مراحله المخصصة فقط ولا تمنح الوصول إلى الزيارات الميدانية أو العينات."
                      : "Order Operations and Finance Officer roles handle commercial order review workflows. These roles require Country selection with National Security Scope. Order capabilities do not grant access to unrelated modules like rep visits or sample allocations."
                    }
                  </p>
                </div>
              )}

              {/* Assigned Areas Cascading Selector */}
              {inheritedScope && (
                <div className="p-4 bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 rounded-2xl space-y-2" data-scope-source="descendants">
                  <div className="text-xs font-bold text-emerald-700 dark:text-emerald-300">{isRtl ? "النطاق الجغرافي" : "GEOGRAPHIC SCOPE"}</div>
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">{isRtl ? "موروث من المرؤوسين" : "Inherited from Subordinates"}</div>
                  <p className="text-[10px] text-slate-500">{isRtl ? "يتم اشتقاق الدول والمحافظات والمدن والمناطق المعتمدة من المرؤوسين النشطين المسموح بهم وقت التشغيل. يظل النطاق فارغاً وآمناً عند عدم وجود مساهمات صالحة." : "Countries, Districts, Cities, and Areas are resolved at runtime from active permitted descendants. Scope remains empty and fail-closed when no valid descendant contributes."}</p>
                </div>
              )}
              {organizationScope && (
                <div className="p-4 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 rounded-2xl space-y-1" data-scope-source="organization">
                  <div className="text-xs font-bold text-slate-700 dark:text-slate-300">{isRtl ? "النطاق المؤسسي" : "ORGANIZATION-DERIVED SCOPE"}</div>
                  <p className="text-[10px] text-slate-500">{isRtl ? "يتم اشتقاق النطاق من سياسة المؤسسة المعتمدة، وليس من تعيين مناطق مباشر." : "Scope is derived from the canonical organization policy, not from direct Area assignment."}</p>
                </div>
              )}
              {assignmentAdminContract.canonicalGeography && (
              <div className="space-y-3 p-3 bg-slate-50/50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 rounded-2xl">
                <div className="flex justify-between items-baseline">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                    {isRtl ? "إسناد المناطق الجغرافية المعتمدة" : "Assign Approved Areas"}
                  </label>
                  <span className="text-[10px] font-semibold text-indigo-500">
                    {assignedAreas.length} {isRtl ? "مناطق مسندة" : "Areas Assigned"}
                  </span>
                </div>

                {/* Dropdowns Cascade */}
                <div className="grid grid-cols-2 gap-2 text-xxs">
                  {/* Country */}
                  <div className="space-y-0.5">
                    <label className="font-semibold text-slate-400 block">{isRtl ? "الدولة" : "Country"}</label>
                    <details className="relative group">
                      <summary className="list-none w-full px-2 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-950 text-[11px] flex justify-between cursor-pointer">
                        <span>{assignCountryIds.length ? `${assignCountryIds.length} ${isRtl ? "محددة" : "Selected"}` : `-- ${isRtl ? "اختر الدول" : "Select Countries"} --`}</span><span>▾</span>
                      </summary>
                      <div className="absolute z-40 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border bg-white dark:bg-slate-950 p-2 shadow-lg space-y-1">
                        {(() => { const all = selectionState(assignCountryIds, availableCountryOptions.map(item => item.id)); return <label className="flex items-center gap-2 border-b pb-1 font-bold cursor-pointer"><input type="checkbox" checked={all.checked} ref={node => { if (node) node.indeterminate = all.indeterminate; }} onChange={event => event.target.checked ? applyCascadeState(addCascadeSelections(cascadeState(), "countryIds", availableCountryOptions.map(item => item.id))) : requestCascadeRemoval("country", availableCountryOptions.map(item => item.id))} />{isRtl ? "تحديد كل الدول" : "Select All Countries"}</label>; })()}
                        {availableCountryOptions.map(option => <label key={option.id} className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={assignCountryIds.includes(option.id)} onChange={event => toggleCascadeParent("country", option.id, event.target.checked)} />{option.name}</label>)}
                      </div>
                    </details>
                  </div>

                  {/* District */}
                  <div className="space-y-0.5">
                    <label className="font-semibold text-slate-400 block">{isRtl ? "المحافظة" : "District"}</label>
                    <details className={`relative group ${!assignCountryIds.length ? "pointer-events-none opacity-50" : ""}`}>
                      <summary className="list-none w-full px-2 py-1.5 border rounded-lg bg-white dark:bg-slate-950 text-[11px] flex justify-between cursor-pointer"><span>{assignDistrictIds.length ? `${assignDistrictIds.length} ${isRtl ? "محددة" : "Selected"}` : `-- ${isRtl ? "اختر المحافظات" : "Select Districts"} --`}</span><span>▾</span></summary>
                      <div className="absolute z-40 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border bg-white dark:bg-slate-950 p-2 shadow-lg space-y-1">
                        {(() => { const all = selectionState(assignDistrictIds, availableDistrictOptions.map(item => item.id)); return <label className="flex items-center gap-2 border-b pb-1 font-bold cursor-pointer"><input type="checkbox" checked={all.checked} ref={node => { if (node) node.indeterminate = all.indeterminate; }} onChange={event => event.target.checked ? applyCascadeState(addCascadeSelections(cascadeState(), "districtIds", availableDistrictOptions.map(item => item.id))) : requestCascadeRemoval("district", availableDistrictOptions.map(item => item.id))} />{isRtl ? "تحديد كل المحافظات المتاحة" : "Select All Available Districts"}</label>; })()}
                        {availableDistrictOptions.map(option => <label key={option.id} className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={assignDistrictIds.includes(option.id)} onChange={event => toggleCascadeParent("district", option.id, event.target.checked)} />{option.countryName} / {option.name}</label>)}
                      </div>
                    </details>
                  </div>

                  {/* Cities */}
                  <div className="space-y-0.5">
                    <label className="font-semibold text-slate-400 block">{isRtl ? "المدن" : "Cities"}</label>
                    <details className={`relative group ${!assignDistrictIds.length ? "pointer-events-none opacity-50" : ""}`}>
                      <summary className="list-none w-full px-2 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-950 text-slate-800 dark:text-white cursor-pointer text-[11px] flex justify-between items-center">
                        <span>{assignCityIds.length > 0
                          ? (isRtl ? `${assignCityIds.length} مدن محددة` : `${assignCityIds.length} Cities Selected`)
                          : (isRtl ? "-- اختر المدن --" : "-- Select Cities --")}</span>
                        <span className="text-slate-400">▾</span>
                      </summary>
                      <div className="absolute z-30 mt-1 w-full max-h-40 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-2 shadow-lg space-y-1">
                        {(() => { const all = selectionState(assignCityIds, availableCityOptions.map(item => item.id)); return <label className="flex items-center gap-2 border-b pb-1 font-bold cursor-pointer"><input type="checkbox" checked={all.checked} ref={node => { if (node) node.indeterminate = all.indeterminate; }} onChange={event => event.target.checked ? applyCascadeState(addCascadeSelections(cascadeState(), "cityIds", availableCityOptions.map(item => item.id))) : requestCascadeRemoval("city", availableCityOptions.map(item => item.id))} />{isRtl ? "تحديد كل المدن المتاحة" : "Select All Available Cities"}</label>; })()}
                        {availableCityOptions.map(cityOption => (
                          <label key={cityOption.id} className="flex items-center gap-2 px-1 py-1 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900 rounded">
                            <input
                              type="checkbox"
                              checked={assignCityIds.includes(cityOption.id)}
                              onChange={(event) => toggleCascadeParent("city", cityOption.id, event.target.checked)}
                              className="accent-indigo-600"
                            />
                            <span>{cityOption.countryName} / {cityOption.districtName} / {cityOption.name}</span>
                          </label>
                        ))}
                      </div>
                    </details>
                  </div>

                  {/* Areas */}
                  <div className="space-y-0.5">
                    <label className="font-semibold text-slate-400 block">{isRtl ? "المناطق" : "Areas"}</label>
                    <details className={`relative group ${assignCityIds.length === 0 ? "pointer-events-none opacity-50" : ""}`}>
                      <summary className="list-none w-full px-2 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-950 text-slate-800 dark:text-white cursor-pointer text-[11px] flex justify-between items-center">
                        <span>{assignedAreas.length > 0
                          ? (isRtl ? `${assignedAreas.length} مناطق محددة` : `${assignedAreas.length} Areas Selected`)
                          : (isRtl ? "-- اختر المناطق --" : "-- Select Areas --")}</span>
                        <span className="text-slate-400">▾</span>
                      </summary>
                      <div className="absolute z-30 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-2 shadow-lg space-y-1">
                        {(() => { const all = selectionState(assignedAreas.map(item => item.id), availableAreaOptions.map(item => item.id)); return <label className="flex items-center gap-2 border-b pb-1 font-bold cursor-pointer"><input type="checkbox" checked={all.checked} ref={node => { if (node) node.indeterminate = all.indeterminate; }} onChange={event => event.target.checked ? applyCascadeState(addCascadeSelections(cascadeState(), "areaIds", availableAreaOptions.map(item => item.id))) : requestCascadeRemoval("area", availableAreaOptions.map(item => item.id))} />{isRtl ? "تحديد كل المناطق المتاحة" : "Select All Available Areas"}</label>; })()}
                        {availableAreaOptions.map(areaOption => (
                          <label key={areaOption.id} className="flex items-start gap-2 px-1 py-1 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900 rounded">
                            <input
                              type="checkbox"
                              checked={assignedAreas.some(area => area.id === areaOption.id)}
                              onChange={(event) => applyCascadeState(toggleCascadeArea(cascadeState(), areaOption.id, event.target.checked, areasList))}
                              className="mt-0.5 accent-indigo-600"
                            />
                            <span>{areaOption.countryName} / {areaOption.districtName} / {areaOption.cityName} / {areaOption.name}</span>
                          </label>
                        ))}
                      </div>
                    </details>
                  </div>
                </div>

                {geographyRemovalPending && (
                  <div className="p-3 border border-red-200 dark:border-red-900/30 bg-red-50/50 dark:bg-red-950/10 rounded-xl space-y-2">
                    <div className="flex gap-2 text-red-600 dark:text-red-400 text-xs font-semibold">
                      <AlertTriangle size={15} className="shrink-0" />
                      <span>{isRtl ? "سيؤدي هذا التغيير إلى إزالة الاختيارات الجغرافية التابعة. راجع التأثير ثم أكد." : "This change will remove dependent geography selections. Review the impact before confirming."}</span>
                    </div>
                    <div className="text-[10px] text-slate-600 dark:text-slate-300 space-y-1">
                      <div>{isRtl ? "المحافظات" : "Districts"}: {geographyRemovalPending.districtIds.map(id => districtsList.find(item => item.id === id)?.name || id).join(", ") || "—"}</div>
                      <div>{isRtl ? "المدن" : "Cities"}: {geographyRemovalPending.cityIds.map(id => citiesList.find(item => item.id === id)?.name || id).join(", ") || "—"}</div>
                      <div>{isRtl ? "المناطق" : "Areas"}: {geographyRemovalPending.areaIds.map(id => assignedAreas.find(item => item.id === id)?.name || id).join(", ") || "—"}</div>
                    </div>
                    <div className="flex justify-end gap-2 text-[10px]">
                      <button type="button" onClick={() => setGeographyRemovalPending(null)} className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 rounded font-bold">{isRtl ? "إلغاء" : "Cancel"}</button>
                      <button type="button" onClick={() => { applyCascadeState(applyCascadeRemoval(cascadeState(), geographyRemovalPending)); setGeographyRemovalPending(null); }} className="px-2.5 py-1 bg-red-600 text-white rounded font-bold">{isRtl ? "تأكيد الإزالة" : "Confirm Removal"}</button>
                    </div>
                  </div>
                )}

                {/* List of Assigned Areas */}
                <div className="max-h-[120px] overflow-y-auto border border-slate-150 dark:border-slate-800 rounded-xl p-2.5 space-y-2 bg-white/50 dark:bg-slate-950/20">
                  {assignedAreas.length === 0 ? (
                    <div className="text-center text-[10px] py-4 text-slate-400 font-semibold italic">
                      {isRtl ? "لا توجد مناطق مسندة حالياً" : "No areas assigned yet."}
                    </div>
                  ) : (
                    assignedAreas.map((item) => (
                      <div key={item.id} className="flex justify-between items-center text-xxs bg-slate-50 dark:bg-slate-900 p-1.5 px-2.5 rounded-lg border border-slate-100 dark:border-slate-800">
                        <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                          <MapPin size={11} className="text-indigo-500" />
                          <span className="font-semibold">{item.name}</span>
                          <span className="text-[10px] text-slate-400">({item.id})</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setAssignedAreas(prev => prev.filter(area => area.id !== item.id));
                          }}
                          className="p-1 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-md transition-colors cursor-pointer flex items-center justify-center"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
              )}

              {/* Geographic Hierarchy Section */}
              <div className="border-t border-slate-100 dark:border-slate-800 pt-4 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <h4 className="text-xs font-bold text-slate-800 dark:text-white uppercase tracking-wider flex items-center gap-1.5 font-sans">
                    <MapPin size={14} className="text-emerald-500" />
                    {isRtl ? "التوزيع الجغرافي" : "Geographic Hierarchy Path"}
                  </h4>
                  {assignmentAdminContract.canonicalGeography && (
                    <span className="text-[10px] font-medium text-indigo-500 normal-case bg-indigo-50 dark:bg-indigo-950/20 px-2 py-0.5 rounded-full border border-indigo-100 dark:border-indigo-900/30">
                      ✨ {isRtl ? "مستمد تلقائياً من المنطقة المسندة" : "Auto-derived from assigned Area"}
                    </span>
                  )}
                </div>
                {assignmentAdminContract.canonicalGeography && derivedFormScope && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]" data-testid="derived-geography-summary">
                    <div className="rounded-lg bg-slate-50 dark:bg-slate-900 p-2"><b>{isRtl ? "الدول" : "Countries"}:</b> {derivedFormScope.countryIds.map(id => countriesList.find(item => item.id === id)?.name || id).join(", ")}</div>
                    <div className="rounded-lg bg-slate-50 dark:bg-slate-900 p-2"><b>{isRtl ? "المحافظات" : "Districts"}:</b> {derivedFormScope.districtIds.map(id => districtsList.find(item => item.id === id)?.name || id).join(", ")}</div>
                    <div className="rounded-lg bg-slate-50 dark:bg-slate-900 p-2"><b>{isRtl ? "المدن" : "Cities"}:</b> {derivedFormScope.cityIds.map(id => citiesList.find(item => item.id === id)?.name || id).join(", ")}</div>
                    <div className="rounded-lg bg-slate-50 dark:bg-slate-900 p-2"><b>{isRtl ? "المناطق" : "Areas"}:</b> {derivedFormScope.areaIds.length}</div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {/* Country */}
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                      {isRtl ? "الدولة" : "Country"}
                    </label>
                    <select
                      value={country}
                      onChange={(e) => {
                        setCountry(e.target.value);
                        setDistrict("");
                        setCity("");
                      }}
                      disabled
                      className={`w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-transparent text-xs text-slate-800 dark:text-white outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer ${assignmentAdminContract.canonicalGeography ? "opacity-60 bg-slate-50/50 dark:bg-slate-900/50 cursor-not-allowed" : ""}`}
                    >
                      <option value="">{isRtl ? "اختر الدولة" : "Select Country"}</option>
                      {countriesList.map(c => (
                        <option key={c.id} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* District */}
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                      {isRtl ? "المنطقة / المقاطعة" : "District / Zone"}
                    </label>
                    <select
                      value={district}
                      onChange={(e) => {
                        setDistrict(e.target.value);
                        setCity("");
                      }}
                      disabled
                      className={`w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-transparent text-xs text-slate-800 dark:text-white outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer ${assignmentAdminContract.canonicalGeography ? "opacity-60 bg-slate-50/50 dark:bg-slate-900/50 cursor-not-allowed" : ""}`}
                    >
                      <option value="">{isRtl ? "اختر المحافظة" : "Select District"}</option>
                      {districtsList.filter(d => {
                        const countryObj = countriesList.find(c => c.name === country);
                        return countryObj ? d.countryId === countryObj.id : true;
                      }).map(d => (
                        <option key={d.id} value={d.name}>{d.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* City */}
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                      {isRtl ? "المدينة" : "City"}
                    </label>
                    <select
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      disabled
                      className={`w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-transparent text-xs text-slate-800 dark:text-white outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer ${assignmentAdminContract.canonicalGeography ? "opacity-60 bg-slate-50/50 dark:bg-slate-900/50 cursor-not-allowed" : ""}`}
                    >
                      <option value="">{isRtl ? "اختر المدينة" : "Select City"}</option>
                      {citiesList.filter(c => {
                        const districtObj = districtsList.find(d => d.name === district);
                        return districtObj ? c.districtId === districtObj.id : true;
                      }).map(c => (
                        <option key={c.id} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Employment & Security Scope Section */}
              <div className="border-t border-slate-100 dark:border-slate-800 pt-4 space-y-4">
                <h4 className="text-xs font-bold text-slate-800 dark:text-white uppercase tracking-wider flex items-center gap-1.5 font-sans">
                  <Shield size={14} className="text-blue-500" />
                  {isRtl ? "بيانات التوظيف ونطاق الأمان" : "Employment & Security Scope"}
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Employment Status */}
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                      {isRtl ? "حالة التوظيف" : "Employment Status"}
                    </label>
                    <select
                      value={employmentStatus}
                      onChange={(e) => {
                        setEmploymentStatus(e.target.value);
                        if (e.target.value === "Active") {
                          setActiveAccount(true);
                        } else {
                          setActiveAccount(false);
                        }
                      }}
                      className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-transparent text-xs text-slate-800 dark:text-white outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                    >
                      <option value="Active">{isRtl ? "نشط" : "Active"}</option>
                      <option value="Inactive">{isRtl ? "غير نشط" : "Inactive"}</option>
                      <option value="On Leave">{isRtl ? "في إجازة" : "On Leave"}</option>
                      <option value="Suspended">{isRtl ? "موقوف" : "Suspended"}</option>
                    </select>
                  </div>

                  {/* Security Scope */}
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                      {isRtl ? "نطاق الأمان" : "Security Scope (Visibility)"}
                    </label>
                    <select
                      value={securityScope}
                      onChange={(e) => setSecurityScope(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-transparent text-xs text-slate-800 dark:text-white outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                    >
                      <option value="Global">{isRtl ? "عالمي" : "Global (All Data)"}</option>
                      <option value="National">{isRtl ? "وطني" : "National (Country)"}</option>
                      <option value="Regional">{isRtl ? "إقليمي" : "Regional (Region)"}</option>
                      <option value="Territory Only">{isRtl ? "المقاطعة فقط" : "Territory Only"}</option>
                      <option value="Subordinates Only">{isRtl ? "المرؤوسين فقط" : "Subordinates Only"}</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Login Information & Credentials Section */}
              <div className="border-t border-slate-100 dark:border-slate-800 pt-4 space-y-4">
                <h4 className="text-xs font-bold text-slate-800 dark:text-white uppercase tracking-wider flex items-center gap-1.5 font-sans">
                  <Key size={14} className="text-amber-500" />
                  {isRtl ? "بيانات الاعتماد وتسجيل الدخول" : "Login Information & Access"}
                </h4>

                <div className="p-3.5 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-4">
                  <div>
                    <h4 className="text-xs font-bold text-slate-800 dark:text-white">{isRtl ? "السماح بتسجيل الدخول" : "Allow Application Login"}</h4>
                    <p className="text-[10px] text-slate-400 font-medium mt-0.5">{isRtl ? "تمكين أو حظر تسجيل الدخول لهذا المستخدم" : "Enable or block mobile & web login for this user account"}</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={loginAllowed}
                      onChange={(e) => setLoginAllowed(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-200 dark:bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Username */}
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">{isRtl ? "اسم المستخدم" : "Login Username"}</label>
                    <input
                      type="text"
                      placeholder="e.g., john.doe"
                      value={credentialUsername}
                      onChange={(e) => setCredentialUsername(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-transparent text-xs text-slate-800 dark:text-white outline-hidden focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  {/* Password with Generate */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center">
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">{isRtl ? "كلمة المرور الأولية" : "Initial Password"}</label>
                      <button
                        type="button"
                        onClick={handleGeneratePassword}
                        className="text-[10px] font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer"
                      >
                        <RefreshCw size={10} />
                        <span>{t.generate}</span>
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        placeholder="Set user password"
                        value={credentialPassword}
                        onChange={(e) => setCredentialPassword(e.target.value)}
                        className="w-full pl-3 pr-10 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-transparent text-xs text-slate-800 dark:text-white outline-hidden focus:ring-1 focus:ring-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                      >
                        {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

            </form>

            {/* Footer buttons */}
            <div className="p-5 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2.5 bg-slate-50/30 dark:bg-slate-850/10">
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="px-4 py-2 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-850 text-slate-500 dark:text-slate-300 text-xs font-bold rounded-lg cursor-pointer"
              >
                {t.cancel}
              </button>
              <button
                type="button"
                onClick={handleSaveUserForm}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors cursor-pointer"
              >
                {t.save}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {activeModal === 'delete' && selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in" id="modal-delete-user">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-sm shadow-2xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-amber-50 dark:bg-amber-950/40 rounded-full flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0 mx-auto sm:mx-0">
                <AlertTriangle size={20} />
              </div>
              <div className="space-y-1.5 flex-1">
                <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">
                  {isRtl ? "إيقاف وأرشفة حساب المستخدم؟" : "Deactivate and Archive User Account?"}
                </h3>
                <p className="text-xxs text-slate-500 dark:text-slate-400 leading-normal">
                  {isRtl 
                    ? "سيؤدي هذا الإجراء إلى إيقاف وأرشفة حساب المستخدم مع الحفاظ على كافة البيانات التاريخية وسجلات التدقيق."
                    : "This operation will deactivate and soft-archive this user account. Historical data is preserved for audit logs."}
                </p>
                <div className="bg-slate-50 dark:bg-slate-850 p-2 border border-slate-100 dark:border-slate-800 rounded-lg text-xxs font-mono font-bold text-slate-700 dark:text-slate-300 mt-2">
                  ID: {selectedUser.id} <br />
                  Name: {selectedUser.name} <br />
                  Role: {selectedUser.role}
                </div>
              </div>
            </div>
            
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setActiveModal(null)}
                className="px-3 py-1.5 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-850 text-slate-500 dark:text-slate-300 text-xxs font-bold rounded-lg cursor-pointer"
              >
                {t.cancel}
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xxs font-bold rounded-lg transition-colors cursor-pointer"
              >
                {isRtl ? "تأكيد الإيقاف والأرشفة" : "Deactivate and Archive"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
