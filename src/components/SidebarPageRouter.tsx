import React from "react";
import { 
  User, 
  Physician, 
  Pharmacy, 
  Product, 
  KeyMessage, 
  AuditLog, 
  Permissions, 
  Role,
  PhysicianVisit as PhysicianVisitType, 
  PhysicianVisitCompletionResult,
  PharmacyVisit as PharmacyVisitType,
  ImportHistory as ImportHistoryType,
  UserTerritoryAssignment,
  UserProductAssignment,
  ProductPromotionGroup,
  normalizeRole,
  OrderStageFilter
} from "../types";

import { isUserOperational } from "../lib/securityEngine";
import { getReadiness } from "../lib/userPolicyEngine";
import type { AccessGovernanceRecord } from "../lib/accessGovernance";
import { canAccessCanonicalView } from "../lib/canonicalAccessControl";
import { getAssignmentOperationalState, getActiveCanonicalAssignmentsForUser } from "../lib/productAssignmentService";
import { FirestoreErrorInfo } from "../lib/firebaseError";

import Dashboard from "./Dashboard";
import PhysicianVisit from "./PhysicianVisit";
import PharmacyVisit from "./PharmacyVisit";
import { PharmacyVisitEngine } from "../features/pharmacyVisit/PharmacyVisitEngine";
import { PharmacyVisitDraftsPage } from "../features/pharmacyVisit/PharmacyVisitDraftsPage";
import { isV2PilotUser } from "../features/pharmacyVisit/config/pharmacyVisitConfig";
import VisitsPage from "./VisitsPage";
import ImportModule from "./ImportModule";
import TemplateCatalog from "./TemplateCatalog";
import MasterData from "./MasterData";
import PhysicianSpecialties from "./PhysicianSpecialties";
import Administration from "./Administration";
import RoleSidebarSettings from "./RoleSidebarSettings";
import UserManagement from "./UserManagement";
import AuditLedger from "./AuditLedger";
import MedicalPlanner from "./MedicalPlanner";
import SalesPlanner from "./SalesPlanner";
import PlaceholderPage from "./PlaceholderPage";
import PhysicianList from "./PhysicianList";
import PharmacyList from "./PharmacyList";
import ProductList from "./ProductList";
import GPSVerifiedPhysicians from "./GPSVerifiedPhysicians";
import GPSVerifiedPharmacies from "./GPSVerifiedPharmacies";
import SalesOffers from "./sales/SalesOffers";
import SalesOrders from "./sales/SalesOrders";
import SalesStockRequests from "./sales/SalesStockRequests";

import SampleConsumptionReports from "./samples/SampleConsumptionReports";
import SampleManagement from "./samples/SampleManagement";
import { isSampleManagementRoute, resolveSampleManagementTab } from "../lib/sampleWorkspace";

import MyTerritory from "./territory/MyTerritory";
import TeamManagement from "./territory/TeamManagement";
import TerritoryManagement from "./territory/TerritoryManagement";

import MarketingCampaigns from "./marketing/MarketingCampaigns";
import MarketingActivities from "./marketing/MarketingActivities";
import MarketingMaterials from "./marketing/MarketingMaterials";
import MarketingApprovals from "./marketing/MarketingApprovals";
import VisitMarketingRequestWorklist from "./marketing/VisitMarketingRequestWorklist";

import TeamActivity from "./supervision/TeamActivity";
import LeaveApprovals from "./supervision/LeaveApprovals";
import SupervisorVisits from "./supervision/SupervisorVisits";
import TaskCenter from "./supervision/TaskCenter";
import CoachingReports from "./supervision/CoachingReports";

import AnalyticsDashboard from "./analytics/AnalyticsDashboard";
import AnalyticsAIReports from "./analytics/AnalyticsAIReports";
import PerformanceDashboardPage from "./analytics/PerformanceDashboardPage";
import TerritorySynergyPage from "./analytics/TerritorySynergyPage";
import MedicalVisitQualityPage from "./analytics/MedicalVisitQualityPage";
import SalesVisitQualityPage from "./analytics/SalesVisitQualityPage";
import ProductDashboardPage from "./analytics/ProductDashboardPage";
import ReportsHubPage from "./analytics/ReportsHubPage";
import AnalyticsSecurityTestsPage from "./analytics/AnalyticsSecurityTestsPage";

import FinanceManager from "./finance/FinanceManager";
import CustomerAccountsPage from "./finance/CustomerAccountsPage";
import PaymentCollectionPage from "./payments/PaymentCollectionPage";
import OperationsHub from "./operations/OperationsHub";
import SupervisorApprovals from "./supervision/SupervisorApprovals";
import AccountHub from "./account/AccountHub";

import MyTasks from "./productivity/MyTasks";
import MyWorkday from "./productivity/MyWorkday";
import NotificationsHub from "./productivity/NotificationsHub";
import MeetingHub from "./productivity/MeetingHub";
import NotesHub from "./productivity/NotesHub";
import ProductTargetHub from "./targets/ProductTargetHub";
import PhysiciansHub from "./field/PhysiciansHub";
import AddPhysicianForm from "./field/AddPhysicianForm";
import PhysicianProfile from "./field/PhysicianProfile";
import PhysicianVisitHistory from "./field/PhysicianVisitHistory";
import VisitSummaryModal from "./VisitSummaryModal";
import AddPharmacyForm from "./pharmacies/AddPharmacyForm";
import PharmacyProfileCard from "./pharmacies/PharmacyProfileCard";
import PharmacyVisitHistory from "./pharmacies/PharmacyVisitHistory";

import AddProductForm from "./products/AddProductForm";
import ProductProfileCard from "./products/ProductProfileCard";
import BrandsDistribution from "./products/BrandsDistribution";
import TherapeuticAreas from "./products/TherapeuticAreas";
import ProductAssignments from "./products/ProductAssignments";
import KeyMessages from "./products/KeyMessages";
import ResourceCenter from "./products/ResourceCenter";

import { LogOut, CheckCircle, ShieldAlert, BookOpen, Settings as SettingsIcon, XCircle, AlertTriangle } from "lucide-react";
import { signOut } from "firebase/auth";
import { auth } from "../lib/firebase";
import type { PhysicianVisitReadState } from "../lib/physicianVisitReadClient";
import type { PharmacyVisitReadState } from "../lib/pharmacyVisitReadClient";
import type { ScopedPhysicianVisitSummary } from "../lib/physicianVisitHistoryClient";

interface SidebarPageRouterProps {
  activeView: string;
  setActiveView: (view: string) => void;
  currentUser: User;
  setCurrentUser: (user: User) => void;
  users: User[];
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
  physicians: Physician[];
  pharmacies: Pharmacy[];
  products: Product[];
  keyMessages: KeyMessage[];
  permissionsMatrix: Record<Role, Permissions>;
  accessGovernanceMatrix: Partial<Record<Role, AccessGovernanceRecord>>;
  setPermissionsMatrix: (matrix: Record<Role, Permissions>) => void;
  physicianVisits: PhysicianVisitType[];
  physicianVisitReadState: PhysicianVisitReadState;
  physicianVisitSummaries: Map<string, ScopedPhysicianVisitSummary>;
  physicianVisitSummaryStatus: "IDLE" | "LOADING" | "READY" | "ERROR";
  loadScopedPhysicianHistory: (physicianId: string, subjectUid?: string) => Promise<ScopedPhysicianVisitSummary>;
  pharmacyVisits: PharmacyVisitType[];
  pharmacyVisitReadState: PharmacyVisitReadState;
  importHistory: ImportHistoryType[];
  auditLogs: AuditLog[];
  handleLogAudit: (action: string, entity: string, details: string) => void;
  handleCompletePhysicianVisit: (visit: PhysicianVisitType) => Promise<PhysicianVisitCompletionResult>;
  handleCompletePharmacyVisit: (visit: PharmacyVisitType) => void;
  handleImportSuccess: (module: any, records: any[], importMode?: "UPSERT" | "CREATE_NEW_ONLY" | "UPDATE_EXISTING_ONLY") => Promise<{
    success: boolean;
    status?: "COMPLETED" | "PARTIAL" | "FAILED";
    attemptedCount?: number;
    createdCount?: number;
    updatedCount?: number;
    skippedCount?: number;
    failedCount?: number;
    persistedDocumentIds?: string[];
    errors?: string[];
    error?: string;
  }>;
  handleRollbackImport: (importId: string) => void;
  onAddPhysician: (physician: Physician) => Promise<void>;
  onUpdatePhysician?: (physician: Physician) => Promise<void>;
  onDeletePhysician?: (id: string) => void;
  onAddPharmacy: (pharmacy: Pharmacy) => void;
  onUpdatePharmacy?: (pharmacy: Pharmacy) => void;
  onDeletePharmacy?: (id: string) => void;
  onAddProduct: (product: Product) => void;
  onUpdateProduct?: (product: Product) => void;
  onDeleteProduct?: (prodId: string) => void;
  lang: "en" | "ar";
  productPromotionGroups?: ProductPromotionGroup[];
  userTerritoryAssignments?: UserTerritoryAssignment[];
  userProductAssignments?: UserProductAssignment[];
  profileLoaded?: boolean;
  managerHydrated?: boolean;
  assignmentsHydrated?: boolean;
  territoryAssignmentsHydrated?: boolean;
  productAssignmentsHydrated?: boolean;
  isOperational?: boolean;
  operationalReport?: { status: string; reasons: string[] };
  dbError?: FirestoreErrorInfo | null;
  onViewVisitSummary?: (visit: any) => void;
}

export default function SidebarPageRouter({
  activeView,
  setActiveView,
  currentUser,
  setCurrentUser,
  users,
  setUsers,
  physicians,
  pharmacies,
  products,
  productPromotionGroups = [],
  keyMessages,
  permissionsMatrix,
  accessGovernanceMatrix,
  setPermissionsMatrix,
  physicianVisits,
  physicianVisitReadState,
  physicianVisitSummaries,
  physicianVisitSummaryStatus,
  loadScopedPhysicianHistory,
  pharmacyVisits,
  pharmacyVisitReadState,
  importHistory,
  auditLogs,
  handleLogAudit,
  handleCompletePhysicianVisit,
  handleCompletePharmacyVisit,
  handleImportSuccess,
  handleRollbackImport,
  onAddPhysician,
  onUpdatePhysician,
  onDeletePhysician,
  onAddPharmacy,
  onUpdatePharmacy,
  onDeletePharmacy,
  onAddProduct,
  onUpdateProduct,
  onDeleteProduct,
  lang,
  userTerritoryAssignments = [],
  userProductAssignments = [],
  profileLoaded,
  managerHydrated,
  assignmentsHydrated,
  territoryAssignmentsHydrated = false,
  productAssignmentsHydrated = false,
  isOperational: isOperationalProp,
  operationalReport: operationalReportProp,
  dbError,
  onViewVisitSummary
}: SidebarPageRouterProps) {
  
  const isRtl = lang === "ar";

  React.useEffect(() => {
    const timestamp = new Date().toISOString();
    console.info(`[DIAGNOSTIC] [${timestamp}] Router mounted`, {
      userId: currentUser?.id || "none",
      role: currentUser?.role || "none",
      activeView
    });
  }, []);

  const isRep = currentUser.role === Role.MEDICAL_REP || currentUser.role === Role.SALES_REP;

  const checkActive = currentUser.active === true;
  const checkEmployment = currentUser.employmentStatus === "Active";
  const checkRole = currentUser.role && (currentUser.role as string) !== "Pending Approval";
  const checkNotDeleted = currentUser.isDeleted !== true;

  const hasArea = (currentUser.areaIds && currentUser.areaIds.length > 0) || 
                  (currentUser.territories && currentUser.territories.length > 0) ||
                  (userTerritoryAssignments && userTerritoryAssignments.some(a => a.userId === currentUser.id && a.status === "Active"));
  
  const hasProduct = (currentUser.products && currentUser.products.length > 0) ||
                     (userProductAssignments && userProductAssignments.some(a => a.userId === currentUser.id && a.status === "Active"));

  const checkArea = !isRep || hasArea;
  const checkProduct = !isRep || hasProduct;

  const hasAccess = checkActive && checkEmployment && checkRole && checkNotDeleted && checkArea && checkProduct;

  if (!hasAccess) {
    const checklistItems = [
      {
        id: "active",
        labelEn: "Account Enabled by Administrator",
        labelAr: "تفعيل الحساب من قبل المسؤول",
        status: checkActive
      },
      {
        id: "employment",
        labelEn: "Employment Status is Active",
        labelAr: "حالة العمل نشطة (Active)",
        status: checkEmployment
      },
      {
        id: "role",
        labelEn: "Operational Role Assigned",
        labelAr: "تعيين دور تشغيلي للمستخدم",
        status: checkRole
      },
      {
        id: "deleted",
        labelEn: "Account Status is Active (Not Deleted)",
        labelAr: "حالة الحساب نشطة (غير محذوف)",
        status: checkNotDeleted
      }
    ];

    if (isRep) {
      checklistItems.push(
        {
          id: "area",
          labelEn: "At least one Geographic Area assigned",
          labelAr: "تعيين منطقة جغرافية واحدة على الأقل",
          status: hasArea
        },
        {
          id: "product",
          labelEn: "At least one Product assigned",
          labelAr: "تعيين منتج واحد على الأقل",
          status: hasProduct
        }
      );
    }

    return (
      <div className="max-w-xl mx-auto my-12 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-850 rounded-2xl p-8 text-center space-y-6 shadow-sm animate-fade-in" id="pending-approval-view">
        <div className="w-16 h-16 bg-amber-50 dark:bg-amber-950/40 rounded-full flex items-center justify-center mx-auto text-amber-500">
          <ShieldAlert size={28} />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            {isRtl ? "لم يتم إكمال إعداد الحساب للتشغيل" : "Account Setup Incomplete / Inactive"}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
            {isRtl 
              ? "يجب على مسؤول النظام إكمال تعيين جميع الحقول التشغيلية وتفعيل حسابك قبل أن تتمكن من تسجيل الدخول والوصول لكامل ميزات النظام."
              : "An administrator must complete your account configuration and set your status to active before you can access the operational workspace."}
          </p>
        </div>

        {/* Live Operational Checklist */}
        <div className="bg-slate-50 dark:bg-slate-950/50 rounded-xl p-5 text-left border border-slate-100 dark:border-slate-800/80 space-y-3">
          <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800 pb-2 flex items-center justify-between">
            <span>{isRtl ? "متطلبات الوصول التشغيلي" : "Operational Readiness Checklist"}</span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
              {isRtl ? "مطلوب" : "Required"}
            </span>
          </h3>
          <ul className="space-y-2.5">
            {checklistItems.map(item => (
              <li key={item.id} className="flex items-center gap-3 text-xs">
                {item.status ? (
                  <CheckCircle className="text-emerald-500 flex-shrink-0" size={16} />
                ) : (
                  <XCircle className="text-rose-500 flex-shrink-0" size={16} />
                )}
                <span className={`font-medium ${item.status ? "text-slate-600 dark:text-slate-300" : "text-slate-400 dark:text-slate-500 line-through decoration-slate-200/60"}`}>
                  {isRtl ? item.labelAr : item.labelEn}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="border-t border-slate-100 dark:border-slate-800 pt-4 flex flex-col items-center">
          <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
            {isRtl ? "البريد الإلكتروني" : "Operator Email"}: {currentUser.email}
          </span>
          <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 mt-1">
            {isRtl ? "حالة الحساب" : "Account Status"}: <span className="text-rose-500 dark:text-rose-400 font-bold">{isRtl ? "غير جاهز تشغيلياً" : "Incomplete / Suspended"}</span>
          </span>
        </div>
        <button
          onClick={async () => {
            await signOut(auth);
          }}
          className="w-full py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
        >
          {isRtl ? "تسجيل الخروج" : "Log Out / Sign In with Another Account"}
        </button>
      </div>
    );
  }

  if (
    activeView.startsWith("pharmacies-") &&
    currentUser.role === Role.MEDICAL_REP
  ) {
    return (
      <div className="p-8 max-w-2xl mx-auto my-12 bg-amber-50 border border-amber-200 dark:bg-amber-950/30 dark:border-amber-900 rounded-2xl shadow-lg text-center space-y-4" id="med-rep-pharmacy-blocked-card">
        <div className="w-16 h-16 bg-amber-100 dark:bg-amber-900/50 rounded-2xl flex items-center justify-center mx-auto text-amber-600 dark:text-amber-400">
          <ShieldAlert size={32} />
        </div>
        <h3 className="text-xl font-bold text-amber-900 dark:text-amber-200">
          {isRtl ? "سجلات الصيدليات مقتصرة على مندوبي المبيعات" : "Pharmacy Workflows Restricted"}
        </h3>
        <p className="text-sm text-amber-800 dark:text-amber-300 leading-relaxed max-w-lg mx-auto">
          {isRtl
            ? "لا يملك المندوب الطبي صلاحية الوصول إلى عمليات وحدود الصيدليات. تقتصر إدارة الصيدليات والأنشطة التجارية على مندوبي المبيعات فقط."
            : "Medical Representatives do not have access to Pharmacy workflows or records. Pharmacy management and commercial visits are strictly restricted to Sales Representatives."}
        </p>
      </div>
    );
  }

  const isFieldActivityView = [
    "field-physician-list",
    "field-physician-visit",
    "field-gps-verified",
    "field-medical-planner",
    "pharmacies-list",
    "pharmacies-gps-verified",
    "pharmacies-sales-planner",
    "pharmacies-pharmacy-visit",
    "pharmacies-visit-drafts"
  ].includes(activeView);

  const isPharmacyView = [
    "pharmacies-list",
    "pharmacies-gps-verified",
    "pharmacies-sales-planner",
    "pharmacies-pharmacy-visit",
    "pharmacies-visit-drafts"
  ].includes(activeView);

  const isSalesRepresentativePharmacyAccess =
    currentUser.role === Role.SALES_REP &&
    isPharmacyView &&
    ((currentUser.areaIds && currentUser.areaIds.length > 0) || (userTerritoryAssignments && userTerritoryAssignments.length > 0));

  // Determine reactive operational status from props or live calculation
  const effectiveIsOperational = typeof isOperationalProp === "boolean"
    ? isOperationalProp
    : (operationalReportProp?.status === "Operational" || (currentUser ? isUserOperational(currentUser, userTerritoryAssignments, userProductAssignments, users, products) : false));

  const effectiveReportStatus = operationalReportProp?.status || (effectiveIsOperational ? "Operational" : "Incomplete");

  // Operational inputs hydration check
  const isHydrating = profileLoaded === false ||
    (!!currentUser?.managerId && currentUser.managerId.trim() !== "" && managerHydrated === false) ||
    assignmentsHydrated === false ||
    effectiveReportStatus === "Pending";

  if (
    isFieldActivityView &&
    !isSalesRepresentativePharmacyAccess &&
    (currentUser.role === Role.MEDICAL_REP || currentUser.role === Role.SALES_REP)
  ) {
    // 1. Loading state while operational inputs are still hydrating
    if (isHydrating && !effectiveIsOperational) {
      console.info(
        "[REP_OPERATIONAL_UI_GATE_JSON]",
        JSON.stringify({
          uid: currentUser.id || currentUser.uid || "",
          role: currentUser.role || "",
          profileLoaded: profileLoaded ?? true,
          managerHydrated: managerHydrated ?? true,
          usersLoaded: Array.isArray(users) && users.length > 0,
          productsLoaded: Array.isArray(products) && products.length > 0,
          territoryAssignmentsLoaded: Array.isArray(userTerritoryAssignments) && userTerritoryAssignments.length > 0,
          productAssignmentsLoaded: Array.isArray(userProductAssignments) && userProductAssignments.length > 0,
          operationalReportStatus: effectiveReportStatus,
          isOperational: effectiveIsOperational,
          blockerRendered: false,
          blockerReason: "HYDRATING"
        })
      );

      return (
        <div className="max-w-md mx-auto my-12 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-850 rounded-2xl p-8 text-center space-y-4 shadow-sm animate-fade-in" id="operational-loading-view">
          <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            {isRtl ? "جاري تحميل البيانات التشغيلية..." : "Loading Operational Profile..."}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {isRtl ? "يرجى الانتظار بينما يتم تجهيز التعيينات والملف الشخصي." : "Please wait while territory and product alignments are being synchronized."}
          </p>
        </div>
      );
    }

    // 2. Physician query error state (if Operational, but physician query returned permission/network error)
    if (effectiveIsOperational && dbError && (dbError.path?.includes("physicians") || dbError.path === "physicians")) {
      console.info(
        "[REP_OPERATIONAL_UI_GATE_JSON]",
        JSON.stringify({
          uid: currentUser.id || currentUser.uid || "",
          role: currentUser.role || "",
          profileLoaded: profileLoaded ?? true,
          managerHydrated: managerHydrated ?? true,
          usersLoaded: Array.isArray(users) && users.length > 0,
          productsLoaded: Array.isArray(products) && products.length > 0,
          territoryAssignmentsLoaded: Array.isArray(userTerritoryAssignments) && userTerritoryAssignments.length > 0,
          productAssignmentsLoaded: Array.isArray(userProductAssignments) && userProductAssignments.length > 0,
          operationalReportStatus: effectiveReportStatus,
          isOperational: effectiveIsOperational,
          blockerRendered: false,
          blockerReason: "PHYSICIAN_QUERY_ERROR"
        })
      );

      return (
        <div className="max-w-md mx-auto my-12 bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/50 rounded-2xl p-8 text-center space-y-4 shadow-sm animate-fade-in" id="physician-query-error-view">
          <div className="w-12 h-12 bg-rose-50 dark:bg-rose-950/40 rounded-full flex items-center justify-center mx-auto text-rose-500">
            <ShieldAlert size={28} />
          </div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            {isRtl ? "تعذر تحميل الأطباء المصرح لهم" : "Unable to load authorized physicians."}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {dbError.error || (isRtl ? "يرجى التحقق من صلاحيات الاستعلام أو شبكة الاتصال." : "Please check query permissions or connection status.")}
          </p>
        </div>
      );
    }

    // 3. Truly incomplete state after hydration completes
    if (!effectiveIsOperational) {
      const opState = getAssignmentOperationalState(currentUser);
      const activeReport = getActiveCanonicalAssignmentsForUser({
        assignments: userProductAssignments,
        userId: currentUser.id,
        products
      });

      let blockTitle = isRtl ? "المندوب غير مفعّل عملياً بعد" : "Representative Profile Incomplete";
      let blockMessage = isRtl
        ? "هذا المندوب غير مفعّل عملياً بعد. يرجى تعيين منطقة جغرافية واحدة ومنتج واحد على الأقل قبل السماح بالأنشطة الميدانية."
        : "This representative is not yet operational. Please assign at least one Area and one Product before field activities are allowed.";
      let blockStatusLabel = isRtl ? "الوضع التشغيلي: غير جاهز للعمل" : "Status: Not Operational / No Alignments";

      if (opState.state === "PENDING") {
        blockTitle = isRtl ? "جاري مزامنة تعيينات المنتجات" : "Product Assignments Syncing";
        blockMessage = isRtl
          ? "مزامنة تعيينات المنتجات جارية حالياً. العمليات التشغيلية غير متاحة مؤقتاً."
          : "Product assignments are being synchronized. Operational workflows are temporarily unavailable.";
        blockStatusLabel = isRtl ? "الحالة: جاري المزامنة..." : "Status: Syncing...";
      } else if (opState.state === "FAILED") {
        blockTitle = isRtl ? "فشل مزامنة تعيينات المنتجات" : "Synchronization Failed";
        blockMessage = isRtl
          ? "فشلت مزامنة المنتجات الخاصة بك. مراجعة المسؤول مطلوبة."
          : "Product assignment synchronization failed. Administrator review is required.";
        blockStatusLabel = isRtl ? "الحالة: فشلت المزامنة" : "Status: Sync Failed";
      } else if (opState.state === "LEGACY_REVIEW_REQUIRED") {
        blockTitle = isRtl ? "تتطلب المنتجات مراجعة" : "Legacy Review Required";
        blockMessage = isRtl
          ? "تتطلب تعيينات المنتجات السابقة هجرة مبرمجة قبل الاستخدام الفعلي."
          : "Legacy Product assignments require controlled migration before operational use.";
        blockStatusLabel = isRtl ? "الحالة: تتطلب مراجعة المنتجات السابقة" : "Status: Legacy Review Required";
      } else if (activeReport.assignments.length === 0) {
        blockTitle = isRtl ? "لا توجد منتجات نشطة" : "No Active Products";
        blockMessage = isRtl
          ? "لا توجد منتجات نشطة معينة لهذا المندوب."
          : "No active Products are assigned to this representative.";
        blockStatusLabel = isRtl ? "الحالة: لا توجد تعيينات نشطة" : "Status: No Active Products";
      }

      console.info(
        "[REP_OPERATIONAL_UI_GATE_JSON]",
        JSON.stringify({
          uid: currentUser.id || currentUser.uid || "",
          role: currentUser.role || "",
          profileLoaded: profileLoaded ?? true,
          managerHydrated: managerHydrated ?? true,
          usersLoaded: Array.isArray(users) && users.length > 0,
          productsLoaded: Array.isArray(products) && products.length > 0,
          territoryAssignmentsLoaded: Array.isArray(userTerritoryAssignments) && userTerritoryAssignments.length > 0,
          productAssignmentsLoaded: Array.isArray(userProductAssignments) && userProductAssignments.length > 0,
          operationalReportStatus: effectiveReportStatus,
          isOperational: effectiveIsOperational,
          blockerRendered: true,
          blockerReason: effectiveReportStatus
        })
      );

      return (
        <div className="max-w-md mx-auto my-12 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-850 rounded-2xl p-8 text-center space-y-6 shadow-sm animate-fade-in" id="not-operational-view">
          <div className="w-16 h-16 bg-amber-50 dark:bg-amber-950/40 rounded-full flex items-center justify-center mx-auto text-amber-500">
            <ShieldAlert size={28} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
              {blockTitle}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
              {blockMessage}
            </p>
          </div>
          <div className="border-t border-slate-100 dark:border-slate-850 pt-4 flex flex-col items-center">
            <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
              {isRtl ? "معرّف المندوب" : "Representative ID"}: {currentUser.id || "N/A"}
            </span>
            <span className="text-[10px] font-mono text-red-500 dark:text-red-400 mt-1 font-bold">
              {blockStatusLabel}
            </span>
          </div>
          <button
            onClick={() => setActiveView("dashboard")}
            className="w-full py-2 bg-slate-600 hover:bg-slate-700 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
          >
            {isRtl ? "العودة للرئيسية" : "Return to Dashboard"}
          </button>
        </div>
      );
    }

    // 4. Operational state -> log UI gate diagnostic
    console.info(
      "[REP_OPERATIONAL_UI_GATE_JSON]",
      JSON.stringify({
        uid: currentUser.id || currentUser.uid || "",
        role: currentUser.role || "",
        profileLoaded: profileLoaded ?? true,
        managerHydrated: managerHydrated ?? true,
        usersLoaded: Array.isArray(users) && users.length > 0,
        productsLoaded: Array.isArray(products) && products.length > 0,
        territoryAssignmentsLoaded: Array.isArray(userTerritoryAssignments) && userTerritoryAssignments.length > 0,
        productAssignmentsLoaded: Array.isArray(userProductAssignments) && userProductAssignments.length > 0,
        operationalReportStatus: effectiveReportStatus,
        isOperational: effectiveIsOperational,
        blockerRendered: false,
        blockerReason: "NONE"
      })
    );
  }

  const isViewAllowed = (viewId: string): boolean => {
    return canAccessCanonicalView({
      user: currentUser,
      rolePermissions: permissionsMatrix[currentUser.role],
      accessGovernance: accessGovernanceMatrix[currentUser.role],
    }, viewId);
  };

  if (!isViewAllowed(activeView)) {
    return (
      <div className="max-w-md mx-auto my-12 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-850 rounded-2xl p-8 text-center space-y-6 shadow-sm animate-fade-in" id="access-denied-view">
        <div className="w-16 h-16 bg-amber-50 dark:bg-amber-950/40 rounded-full flex items-center justify-center mx-auto text-amber-500">
          <ShieldAlert size={28} />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            {isRtl ? "غير مصرح بالدخول" : "Access Restrictions Active"}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
            {isRtl 
              ? `صلاحياتك الحالية لدور (${currentUser.role}) لا تسمح لك بالوصول إلى هذه الصفحة.`
              : `Your active enterprise role (${currentUser.role}) does not possess the sufficient permissions required to access the requested operational page.`}
          </p>
        </div>
        <div className="border-t border-slate-100 dark:border-slate-800 pt-4 flex flex-col items-center">
          <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
            {isRtl ? "معرّف المندوب" : "Operator UID"}: {currentUser.id || "N/A"}
          </span>
          <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 mt-1">
            {isRtl ? "المنطقة" : "Area"}: {currentUser.region} / {currentUser.territory}
          </span>
        </div>
        <button
          onClick={() => setActiveView("dashboard")}
          className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
        >
          {isRtl ? "العودة للرئيسية" : "Return to Control Panel"}
        </button>
      </div>
    );
  }

  // Logout action view helper
  if (activeView === "account-logout") {
    return (
      <div className="max-w-md mx-auto my-12 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 text-center space-y-6 shadow-md animate-fade-in">
        <div className="w-16 h-16 bg-red-50 dark:bg-red-950/40 rounded-full flex items-center justify-center mx-auto text-red-500">
          <LogOut size={28} />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            {isRtl ? "تأكيد تسجيل الخروج" : "Confirm Logout Action"}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
            {isRtl 
              ? "سيتم قفل وإغلاق جلستك التشغيلية النشطة الحالية والتحقق من مزامنة سجل GPS."
              : "Ensure your active GPS-verified check-ins are logged and synchronized before termination."}
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setActiveView("dashboard")}
            className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold rounded-lg transition-colors cursor-pointer"
          >
            {isRtl ? "إلغاء العودة" : "Cancel Return"}
          </button>
          <button
            onClick={() => {
              alert(isRtl ? "تمت محاكاة تسجيل الخروج بأمان!" : "Logged out successfully in simulation sandbox!");
              setActiveView("dashboard");
            }}
            className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
          >
            {isRtl ? "تأكيد الخروج" : "Terminate Session"}
          </button>
        </div>
      </div>
    );
  }

  let selectedRouteComponent = "Unknown";
  if (activeView === "field-physicians") {
    selectedRouteComponent = "PhysiciansHub";
  } else if (
    activeView === "field-physician-list" ||
    activeView === "physicians" ||
    activeView === "physician-list"
  ) {
    selectedRouteComponent = "PhysicianList";
  }

  console.info(
    "[PHYSICIAN_PROP_ROUTER_JSON]",
    JSON.stringify({
      activeView,
      receivedPhysicianCount: Array.isArray(physicians) ? physicians.length : 0,
      receivedPhysicianIds: Array.isArray(physicians) ? physicians.map(p => p.id) : [],
      selectedRouteComponent
    })
  );

  // Exact mapping of static views
  switch (isSampleManagementRoute(activeView) ? "sample-management" : activeView) {
    case "dashboard":
      return (
        <Dashboard
          currentUser={currentUser}
          physicianVisits={physicianVisits || []}
          pharmacyVisits={pharmacyVisits || []}
          lang={lang}
          users={users || []}
          physicians={physicians || []}
          pharmacies={pharmacies || []}
          products={products || []}
        />
      );

    // Specialized Planner views
    case "field-medical-planner":
      return (
        <MedicalPlanner 
          lang={lang}
          currentUser={currentUser}
          users={users}
        />
      );

    case "pharmacies-sales-planner":
      return (
        <SalesPlanner
          pharmacies={pharmacies}
          lang={lang}
          currentUser={currentUser}
          users={users}
          userTerritoryAssignments={userTerritoryAssignments}
          userProductAssignments={userProductAssignments}
        />
      );

    // Rebuilt, fully compliant workflows
    case "field-physician-visit":
      return (
        <PhysicianVisit
          currentUser={currentUser}
          physicians={physicians}
          products={products}
          productPromotionGroups={productPromotionGroups}
          keyMessages={keyMessages}
          lang={lang}
          onCompleteVisit={handleCompletePhysicianVisit}
          physicianVisits={physicianVisits}
          physicianVisitSummaries={physicianVisitSummaries}
          physicianVisitSummaryStatus={physicianVisitSummaryStatus}
          userTerritoryAssignments={userTerritoryAssignments}
          userProductAssignments={userProductAssignments}
          isOperational={isOperationalProp}
          operationalReport={operationalReportProp}
          users={users}
        />
      );

    case "pharmacies-pharmacy-visit":
      if (isV2PilotUser(currentUser.id)) {
        return (
          <PharmacyVisitEngine
            currentUser={currentUser}
            authorizedPharmacies={pharmacies}
            entryContext={{
              entrySource: "DIRECT_MENU"
            }}
            lang={lang}
            onNavigate={(view: string, params?: any) => {
              if (params?.resumeDraft) {
                // If navigating with resumeDraft parameter
              }
              setActiveView(view);
            }}
            products={products}
            userProductAssignments={userProductAssignments}
          />
        );
      }
      return (
        <PharmacyVisit
          currentUser={currentUser}
          pharmacies={pharmacies}
          products={products}
          lang={lang}
          onCompletePharmacyVisit={handleCompletePharmacyVisit}
          onNavigate={setActiveView}
          userTerritoryAssignments={userTerritoryAssignments}
          userProductAssignments={userProductAssignments}
        />
      );

    case "pharmacies-visit-drafts":
      return (
        <PharmacyVisitDraftsPage
          currentUser={currentUser}
          authorizedPharmacies={pharmacies}
          products={products}
          userProductAssignments={userProductAssignments}
          lang={lang}
          onNavigate={setActiveView}
          onResumeDraft={(draft) => {
            // Render PharmacyVisitEngine with resumeDraft
            setActiveView("pharmacies-pharmacy-visit");
          }}
        />
      );

    // Administration and Core components
    case "admin-data-import":
      return (
        <ImportModule
          currentUser={currentUser}
          lang={lang}
          onImportSuccess={handleImportSuccess}
          importHistory={importHistory}
          onRollbackImport={handleRollbackImport}
        />
      );

    case "admin-template-catalog":
      return (
        <TemplateCatalog
          currentUser={currentUser}
          lang={lang}
          permissionsMatrix={permissionsMatrix}
          setActiveView={setActiveView}
        />
      );

    case "admin":
      return (
        <Administration
          lang={lang}
          permissionsMatrix={permissionsMatrix}
          onUpdatePermissions={setPermissionsMatrix}
          onLogAudit={handleLogAudit}
          currentUser={currentUser}
          physicians={physicians}
          pharmacies={pharmacies}
        />
      );

    case "audit":
      return (
        <AuditLedger
          lang={lang}
          auditLogs={auditLogs}
        />
      );

    case "master":
    case "master-data":
      return (
        <MasterData
          currentUser={currentUser}
          physicians={physicians}
          pharmacies={pharmacies}
          products={products}
          keyMessages={keyMessages}
          productPromotionGroups={productPromotionGroups}
          lang={lang}
        />
      );

    case "master-promotion-groups":
      return (
        <MasterData
          currentUser={currentUser}
          physicians={physicians}
          pharmacies={pharmacies}
          products={products}
          keyMessages={keyMessages}
          productPromotionGroups={productPromotionGroups}
          lang={lang}
          initialCatalog="promotionGroups"
        />
      );

    case "master-specialties":
      return (
        <PhysicianSpecialties
          currentUser={currentUser}
          physicians={physicians}
          lang={lang}
        />
      );

    // ==========================================
    // PLACEHOLDER ROUTING MODULES
    // ==========================================

    // Field Operations Placeholders
    case "field-physicians":
      return <PhysiciansHub lang={lang} onNavigate={setActiveView} />;
    case "field-physician-list":
    case "physicians":
    case "physician-list":
      return (
        <PhysicianList
          currentUser={currentUser}
          physicians={physicians}
          onAddPhysician={onAddPhysician}
          onUpdatePhysician={onUpdatePhysician}
          onDeletePhysician={onDeletePhysician}
          lang={lang}
          users={users}
          products={products}
          productPromotionGroups={productPromotionGroups}
          userTerritoryAssignments={userTerritoryAssignments}
          userProductAssignments={userProductAssignments}
          physicianVisits={physicianVisits}
          physicianVisitSummaries={physicianVisitSummaries}
          physicianVisitSummaryStatus={physicianVisitSummaryStatus}
          loadScopedPhysicianHistory={loadScopedPhysicianHistory}
          onViewVisitSummary={onViewVisitSummary}
          isOperational={isOperationalProp}
          operationalReport={operationalReportProp}
        />
      );
    case "field-add-physician":
      return <AddPhysicianForm lang={lang} currentUser={currentUser} onNavigate={setActiveView} onAddPhysician={onAddPhysician} />;
    case "field-physician-profile":
      return <PhysicianProfile lang={lang} onNavigate={setActiveView} physicians={physicians} physicianVisits={physicianVisits} />;
    case "field-gps-verified":
      return (
        <GPSVerifiedPhysicians 
          lang={lang} 
          currentUser={currentUser}
          physicianVisits={physicianVisits}
          physicians={physicians}
          onViewVisitSummary={onViewVisitSummary}
        />
      );
    case "visits-review":
    case "field-visits-review":
    case "visits":
      return (
        <VisitsPage
          lang={lang}
          currentUser={currentUser}
          setActiveView={setActiveView}
          users={users || []}
          pharmacies={pharmacies || []}
          physicians={physicians || []}
          pharmacyVisits={pharmacyVisits || []}
          pharmacyVisitReadState={pharmacyVisitReadState}
          physicianVisits={physicianVisits || []}
          physicianVisitReadState={physicianVisitReadState}
          products={products || []}
          onViewVisitSummary={onViewVisitSummary}
        />
      );

    case "field-physician-visit-history":
      return (
        <VisitsPage
          lang={lang}
          currentUser={currentUser}
          setActiveView={setActiveView}
          users={users || []}
          pharmacies={pharmacies || []}
          physicians={physicians || []}
          pharmacyVisits={pharmacyVisits || []}
          physicianVisits={physicianVisits || []}
          pharmacyVisitReadState={pharmacyVisitReadState}
          physicianVisitReadState={physicianVisitReadState}
          products={products || []}
          onViewVisitSummary={onViewVisitSummary}
          initialTab="physician"
        />
      );

    // Pharmacies Placeholders
    case "pharmacies-list":
      console.info(
        "[PHARMACY_ROUTER_PROP_JSON]",
        JSON.stringify({
          incomingCount: pharmacies.length,
          documentIds: pharmacies.map(p => p.id),
          activeView,
          currentUserUid: currentUser.id,
          role: currentUser.role
        })
      );
      console.info("[PHARMACY_PIPELINE_TRACE]", {
        stage: "3. Router Prop",
        count: pharmacies.length,
        targetIdPresent: pharmacies.some(r => r.id === "PHM-TAJOURA-A"),
        exclusionReason: pharmacies.some(r => r.id === "PHM-TAJOURA-A") ? undefined : "Missing in Router prop"
      });
      return (
        <PharmacyList
          currentUser={currentUser}
          pharmacies={pharmacies}
          onAddPharmacy={onAddPharmacy}
          onUpdatePharmacy={onUpdatePharmacy}
          onDeletePharmacy={onDeletePharmacy}
          lang={lang}
          users={users}
        />
      );
    case "pharmacies-add":
      return (
        <AddPharmacyForm 
          lang={lang} 
          currentUser={currentUser}
          onNavigate={setActiveView} 
          onAddPharmacy={onAddPharmacy} 
        />
      );
    case "pharmacies-profile":
      return (
        <PharmacyProfileCard 
          lang={lang} 
          onNavigate={setActiveView} 
        />
      );
    case "pharmacies-gps-verified":
      return (
        <GPSVerifiedPharmacies
          lang={lang}
          currentUser={currentUser}
          users={users}
          pharmacyVisits={pharmacyVisits}
          pharmacies={pharmacies}
        />
      );
    case "pharmacies-visit-history":
      return (
        <VisitsPage
          lang={lang}
          currentUser={currentUser}
          setActiveView={setActiveView}
          users={users}
          pharmacies={pharmacies}
          physicians={physicians}
          pharmacyVisits={pharmacyVisits}
          physicianVisits={physicianVisits}
          pharmacyVisitReadState={pharmacyVisitReadState}
          onViewVisitSummary={onViewVisitSummary}
          initialTab="pharmacy"
        />
      );

    // Products Placeholders
    case "products-list":
      return (
        <ProductList
          currentUser={currentUser}
          products={products}
          productPromotionGroups={productPromotionGroups}
          onAddProduct={onAddProduct}
          onUpdateProduct={onUpdateProduct}
          onDeleteProduct={onDeleteProduct}
          lang={lang}
          keyMessages={keyMessages}
        />
      );
    case "products-add":
      return (
        <AddProductForm
          lang={lang}
          productPromotionGroups={productPromotionGroups}
          onNavigate={setActiveView}
          onAddProduct={onAddProduct}
          products={products}
        />
      );
    case "products-profile":
      return (
        <ProductProfileCard
          lang={lang}
          onNavigate={setActiveView}
          products={products}
        />
      );
    case "products-brands":
      return (
        <BrandsDistribution
          lang={lang}
          onNavigate={setActiveView}
        />
      );
    case "products-therapeutic-areas":
      return (
        <TherapeuticAreas
          lang={lang}
          onNavigate={setActiveView}
        />
      );
    case "products-assignments":
      return (
        <ProductAssignments
          lang={lang}
          onNavigate={setActiveView}
        />
      );
    case "products-key-messages":
      return (
        <KeyMessages
          lang={lang}
          currentUser={currentUser}
          products={products}
          onNavigate={setActiveView}
        />
      );
    case "products-resource-center":
      return (
        <ResourceCenter
          lang={lang}
          currentUser={currentUser}
          permissions={permissionsMatrix[currentUser.role]}
          products={products}
          productPromotionGroups={productPromotionGroups}
          onNavigate={setActiveView}
        />
      );

    // Samples Modules
    case "sample-management":
    case "samples-management":
    case "samples-allocation":
    case "samples-approvals":
    case "samples-physician":
    case "samples-requests":
    case "samples-inventory":
      return (
        <SampleManagement
          currentUser={currentUser}
          users={users}
          products={products}
          physicians={physicians}
          permissions={permissionsMatrix[currentUser.role]}
          lang={lang}
          profileLoaded={profileLoaded}
          initialTab={resolveSampleManagementTab(activeView)}
          onNavigate={setActiveView}
        />
      );
    case "samples-reports":
      return (
        <SampleConsumptionReports currentUser={currentUser} users={users} products={products} physicians={physicians} permissions={permissionsMatrix[currentUser.role]} lang={lang} />
      );

    case "marketing-my-requests":
      return <VisitMarketingRequestWorklist currentUser={currentUser} lang={lang} />;
    case "marketing-materials-requests":
    case "marketing-settings":
      return (
        <MarketingMaterials currentUser={currentUser} lang={lang} />
      );
    case "marketing-activities":
    case "marketing-add-activity":
    case "marketing-calendar":
      return (
        <MarketingActivities currentUser={currentUser} lang={lang} />
      );
    case "marketing-campaigns":
      return (
        <MarketingCampaigns currentUser={currentUser} lang={lang} />
      );
    case "marketing-events":
    case "marketing-approvals":
      return (
        <MarketingApprovals currentUser={currentUser} lang={lang} />
      );

    // Sales & Orders Views
    case "sales-offers":
      return <SalesOffers lang={lang} />;
    case "sales-orders":
      return (
        <SalesOrders 
          products={products} 
          pharmacies={pharmacies} 
          lang={lang} 
          currentUser={currentUser}
          onLogAudit={handleLogAudit}
          userTerritoryAssignments={userTerritoryAssignments}
          userProductAssignments={userProductAssignments}
          profileLoaded={profileLoaded}
        />
      );
    case "sales-stock-requests":
      return <SalesStockRequests products={products} pharmacies={pharmacies} lang={lang} />;

    // Analytics Placeholders
    case "analytics-performance":
      return (
        <PerformanceDashboardPage 
          currentUser={currentUser} 
          lang={lang} 
          users={users}
          physicians={physicians}
          pharmacies={pharmacies}
          products={products}
          userTerritoryAssignments={userTerritoryAssignments}
          userProductAssignments={userProductAssignments}
          physicianVisits={physicianVisits}
          pharmacyVisits={pharmacyVisits}
        />
      );
    case "analytics-medical-quality":
      return (
        <MedicalVisitQualityPage
          currentUser={currentUser}
          lang={lang}
          users={users}
          physicians={physicians}
          products={products}
          userTerritoryAssignments={userTerritoryAssignments}
          userProductAssignments={userProductAssignments}
          physicianVisits={physicianVisits}
        />
      );
    case "analytics-sales-quality":
      return (
        <SalesVisitQualityPage
          currentUser={currentUser}
          lang={lang}
          users={users}
          pharmacies={pharmacies}
          products={products}
          userTerritoryAssignments={userTerritoryAssignments}
          userProductAssignments={userProductAssignments}
          pharmacyVisits={pharmacyVisits}
        />
      );
    case "analytics-territory-synergy":
      return (
        <TerritorySynergyPage
          currentUser={currentUser}
          lang={lang}
          users={users}
          physicians={physicians}
          pharmacies={pharmacies}
          products={products}
          userTerritoryAssignments={userTerritoryAssignments}
          userProductAssignments={userProductAssignments}
          physicianVisits={physicianVisits}
          pharmacyVisits={pharmacyVisits}
        />
      );
    case "analytics-product":
      return (
        <ProductDashboardPage 
          currentUser={currentUser} 
          lang={lang} 
          users={users}
          products={products}
          userTerritoryAssignments={userTerritoryAssignments}
          userProductAssignments={userProductAssignments}
          physicianVisits={physicianVisits}
          pharmacyVisits={pharmacyVisits}
        />
      );
    case "analytics-reports":
      return (
        <ReportsHubPage 
          currentUser={currentUser} 
          lang={lang} 
          users={users}
          products={products}
          userTerritoryAssignments={userTerritoryAssignments}
          userProductAssignments={userProductAssignments}
          physicianVisits={physicianVisits}
          pharmacyVisits={pharmacyVisits}
          onLogAudit={handleLogAudit}
        />
      );
    case "analytics-sample":
      return (
        <SampleManagement
          currentUser={currentUser} users={users} products={products} physicians={physicians}
          permissions={permissionsMatrix[currentUser.role]} lang={lang} profileLoaded={profileLoaded}
          initialTab="overview" onNavigate={setActiveView}
        />
      );
    case "analytics-supervisor-reports":
    case "analytics-supervisor-performance":
      return (
        <ReportsHubPage currentUser={currentUser} lang={lang} users={users} products={products} userTerritoryAssignments={userTerritoryAssignments} userProductAssignments={userProductAssignments} physicianVisits={physicianVisits} pharmacyVisits={pharmacyVisits} onLogAudit={handleLogAudit} />
      );
    case "analytics-ai-reports":
      return (
        <AnalyticsAIReports 
          currentUser={currentUser} 
          lang={lang} 
          users={users}
          physicians={physicians}
          pharmacies={pharmacies}
          products={products}
          userTerritoryAssignments={userTerritoryAssignments}
          userProductAssignments={userProductAssignments}
          physicianVisits={physicianVisits}
          pharmacyVisits={pharmacyVisits}
        />
      );
    case "analytics-security-tests":
      return (
        <AnalyticsSecurityTestsPage 
          currentUser={currentUser} 
          lang={lang} 
          onLogAudit={handleLogAudit}
        />
      );

    // Administration Placeholders
    case "admin-user-management":
      return (
        <UserManagement
          lang={lang}
          users={users}
          setUsers={setUsers}
          currentUser={currentUser}
          setCurrentUser={setCurrentUser}
          handleLogAudit={handleLogAudit}
          userTerritoryAssignments={userTerritoryAssignments}
          userProductAssignments={userProductAssignments}
          territoryAssignmentsHydrated={territoryAssignmentsHydrated}
          productAssignmentsHydrated={productAssignmentsHydrated}
        />
      );
    case "admin-role-settings":
      return (
        <RoleSidebarSettings
          lang={lang}
          currentUser={currentUser}
          permissionsMatrix={permissionsMatrix}
          accessGovernanceMatrix={accessGovernanceMatrix}
        />
      );
    case "admin-location":
      return (
        <Administration
          lang={lang}
          permissionsMatrix={permissionsMatrix}
          onUpdatePermissions={setPermissionsMatrix}
          onLogAudit={handleLogAudit}
          initialTab="geography"
          currentUser={currentUser}
          physicians={physicians}
          pharmacies={pharmacies}
        />
      );
    case "admin-regional":
      return (
        <Administration
          lang={lang}
          permissionsMatrix={permissionsMatrix}
          onUpdatePermissions={setPermissionsMatrix}
          onLogAudit={handleLogAudit}
          initialTab="localization"
          currentUser={currentUser}
          physicians={physicians}
          pharmacies={pharmacies}
        />
      );
    case "admin-product-assignment-audit":
      return (
        <Administration
          lang={lang}
          permissionsMatrix={permissionsMatrix}
          onUpdatePermissions={setPermissionsMatrix}
          onLogAudit={handleLogAudit}
          initialTab="product-audits"
          currentUser={currentUser}
          physicians={physicians}
          pharmacies={pharmacies}
        />
      );
    case "admin-location-settings":
      return (
        <Administration
          lang={lang}
          permissionsMatrix={permissionsMatrix}
          onUpdatePermissions={setPermissionsMatrix}
          onLogAudit={handleLogAudit}
          initialTab="geography"
          currentUser={currentUser}
          physicians={physicians}
          pharmacies={pharmacies}
        />
      );
    case "admin-order-workflow-settings":
      return (
        <Administration
          lang={lang}
          permissionsMatrix={permissionsMatrix}
          onUpdatePermissions={setPermissionsMatrix}
          onLogAudit={handleLogAudit}
          initialTab="order-workflow"
          currentUser={currentUser}
          physicians={physicians}
          pharmacies={pharmacies}
        />
      );

    // Finance Pages
    case "finance-customer-accounts":
      return (
        <CustomerAccountsPage 
          currentUser={currentUser} 
          lang={lang} 
          userTerritoryAssignments={userTerritoryAssignments} 
        />
      );

    case "finance-payment-processing":
    case "payment-collection":
    case "payment-collections":
      return (
        <PaymentCollectionPage currentUser={currentUser} lang={lang} />
      );

    case "finance-financials":
    case "finance-receipt-books":
    case "finance-receipt-tracking":
    case "finance-dashboard":
    case "finance-reports":
    case "finance-budget-management":
      return (
        <FinanceManager currentUser={currentUser} lang={lang} />
      );

    case "finance-approvals":
    case "finance-approved":
    case "finance-rejected":
      return (
        <SalesOrders 
          products={products}
          pharmacies={pharmacies}
          lang={lang}
          currentUser={currentUser}
          onLogAudit={handleLogAudit}
          userTerritoryAssignments={userTerritoryAssignments}
          userProductAssignments={userProductAssignments}
          profileLoaded={profileLoaded}
          initialStageFilter={
            activeView === "finance-approvals" 
              ? "FINANCE_REVIEW" 
              : activeView === "finance-approved" 
              ? "OPERATIONS_REVIEW" 
              : "CLOSED"
          }
        />
      );

    case "finance-customer-status":
    case "finance-balances":
    case "finance-credit-monitoring":
      return (
        <FinanceManager currentUser={currentUser} lang={lang} initialTab="credit" />
      );

    // Productivity Pages
    case "productivity-notifications":
      return <NotificationsHub lang={lang} currentUser={currentUser} setActiveView={setActiveView} profileLoaded={profileLoaded} />;
    case "productivity-tasks":
      return <MyTasks lang={lang} />;
    case "productivity-notes":
      return <NotesHub lang={lang} />;
    case "productivity-workday":
      return <MyWorkday lang={lang} currentUser={currentUser} />;
    case "productivity-meetings":
      return <MeetingHub lang={lang} />;

    // Targets Pages
    case "targets-product-targets":
      return <ProductTargetHub lang={lang} currentUser={currentUser} />;

    // Inventory Pages
    case "inventory-bulk-updates":
    case "inventory-purchase-orders":
    case "inventory-dashboard":
    case "inventory-reports":
    case "inventory-batch-management":
      return <div className="p-8"><div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-8 text-sm text-slate-500">{isRtl ? "تم إيقاف شاشة المخزون التجريبية. استخدم عمليات التنفيذ المعتمدة وسجل مخزون العينات." : "The legacy fictional inventory screen is retired. Use canonical Fulfillment Operations and Sample Inventory."}</div></div>;
    case "inventory-warehouse-operations":
    case "operations-fulfillment-center":
      return (
        <SalesOrders 
          products={products}
          pharmacies={pharmacies}
          lang={lang}
          currentUser={currentUser}
          onLogAudit={handleLogAudit}
          userTerritoryAssignments={userTerritoryAssignments}
          userProductAssignments={userProductAssignments}
          profileLoaded={profileLoaded}
          initialStageFilter="STORE_PREPARATION"
        />
      );
    case "operations-order-operations": {
      const activeRole = currentUser?.role ? normalizeRole(currentUser.role) : null;
      let defaultStageForOps = "ALL";
      if (activeRole === Role.FINANCE) {
        defaultStageForOps = "FINANCE_REVIEW";
      } else if (activeRole === Role.ORDER_OPS_OFFICER) {
        defaultStageForOps = "OPERATIONS_REVIEW";
      } else if (activeRole === Role.STORE_MANAGER || activeRole === Role.WAREHOUSE_MANAGER || activeRole === Role.INVENTORY_OFFICER) {
        defaultStageForOps = "STORE_PREPARATION";
      } else if (activeRole === Role.DELIVERY_OFFICER) {
        defaultStageForOps = "DISPATCH";
      } else if (activeRole === Role.SALES_REP || activeRole === Role.MEDICAL_REP) {
        defaultStageForOps = "SUBMISSION";
      }
      return (
        <SalesOrders 
          products={products}
          pharmacies={pharmacies}
          lang={lang}
          currentUser={currentUser}
          onLogAudit={handleLogAudit}
          userTerritoryAssignments={userTerritoryAssignments}
          userProductAssignments={userProductAssignments}
          profileLoaded={profileLoaded}
          initialStageFilter={defaultStageForOps as OrderStageFilter}
        />
      );
    }
    case "operations-delivery-management":
      return (
        <SalesOrders 
          products={products}
          pharmacies={pharmacies}
          lang={lang}
          currentUser={currentUser}
          onLogAudit={handleLogAudit}
          userTerritoryAssignments={userTerritoryAssignments}
          userProductAssignments={userProductAssignments}
          profileLoaded={profileLoaded}
          initialStageFilter="DISPATCH"
        />
      );
    case "operations-customer-service":
      return (
        <OperationsHub lang={lang} initialTab="support" />
      );

    // Account Placeholders
    case "account-user-manual":
      return (
        <AccountHub currentUser={currentUser} lang={lang} initialTab="manual" />
      );
    case "account-settings":
      return (
        <AccountHub currentUser={currentUser} lang={lang} initialTab="settings" />
      );

    // Territory & Team Views
    case "territory-my-territory":
      return (
        <MyTerritory 
          lang={lang} 
          currentUser={currentUser}
          physicians={physicians}
          pharmacies={pharmacies}
          users={users}
          userTerritoryAssignments={userTerritoryAssignments || []}
        />
      );

    case "territory-team-list":
      return (
        <TeamManagement 
          lang={lang} 
          currentUser={currentUser}
          users={users}
          setUsers={setUsers}
          physicianVisits={physicianVisits}
          pharmacyVisits={pharmacyVisits}
        />
      );

    case "territory-organization":
      return (
        <TeamManagement
          lang={lang}
          currentUser={currentUser}
          users={users}
          setUsers={setUsers}
          physicianVisits={physicianVisits}
          pharmacyVisits={pharmacyVisits}
        />
      );

    case "territory-management":
      return (
        <TerritoryManagement lang={lang} currentUser={currentUser} users={users} />
      );

    // Supervision Placeholders
    case "supervision-coaching-reports":
      return (
        <CoachingReports lang={lang} currentUser={currentUser} users={users} physicians={physicians} pharmacies={pharmacies} />
      );

    case "supervision-team-activity":
      return <TeamActivity lang={lang} currentUser={currentUser} users={users} />;

    case "supervision-approvals":
      return (
        <SupervisorApprovals lang={lang} />
      );

    case "supervision-leave-approvals":
      return <LeaveApprovals lang={lang} currentUser={currentUser} users={users} />;

    case "supervision-visits":
      return <SupervisorVisits mode="HISTORY" lang={lang} currentUser={currentUser} users={users} physicians={physicians} pharmacies={pharmacies} products={products} />;

    case "supervision-field-visits":
      return <SupervisorVisits mode="FIELD" lang={lang} currentUser={currentUser} users={users} physicians={physicians} pharmacies={pharmacies} products={products} />;

    case "supervision-planning":
      return <SupervisorVisits mode="PLANNING" lang={lang} currentUser={currentUser} users={users} physicians={physicians} pharmacies={pharmacies} products={products} />;

    case "supervision-task-center":
      return <TaskCenter lang={lang} />;

    default:
      return (
        <div className="p-8 text-center bg-white dark:bg-slate-900 border rounded-2xl">
          <ShieldAlert className="mx-auto text-amber-500 mb-2" size={32} />
          <h2 className="text-lg font-bold">Unrecognized Module ID Route</h2>
          <p className="text-xs text-slate-400 mt-1">The routing trigger '{activeView}' is registered in sidebar metadata but has not been resolved.</p>
        </div>
      );
  }
}
