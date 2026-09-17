import React, { useEffect, useMemo, useState } from "react";
import { Boxes, ClipboardList, PackageCheck, ShieldCheck, Stethoscope, Warehouse } from "lucide-react";
import { collection, onSnapshot, query, where, type Query, type DocumentData } from "firebase/firestore";
import type { Permissions, Physician, Product, User } from "../../types";
import { db } from "../../lib/firebase";
import { getAuthorizedInitialSampleTab, getSampleManagementRoute, getVisibleSampleManagementTabs, type SampleManagementTab } from "../../lib/sampleWorkspace";
import { getAuthorizedSampleUserIds, getSampleDataScope, hasSampleCapability } from "../../lib/sampleAuthorization";
import SampleAllocation from "./SampleAllocation";
import SampleApprovals from "./SampleApprovals";
import SampleRequests from "./SampleRequests";
import SampleInventory from "./SampleInventory";
import SampleDisbursedLog from "./SampleDisbursedLog";
import { subscribeToScopedSampleCollection } from "../../lib/sampleScopeClient";

interface SampleManagementProps {
  currentUser: User;
  users: User[];
  products: Product[];
  physicians: Physician[];
  permissions?: Permissions;
  lang: "en" | "ar";
  profileLoaded?: boolean;
  initialTab?: SampleManagementTab;
  onNavigate?: (target: string) => void;
}

const icons = { overview: Boxes, catalog: PackageCheck, inventory: Warehouse, requests: ClipboardList, approvals: ShieldCheck, allocations: Boxes, distribution: Stethoscope };

function SampleOverview({ currentUser, users, permissions, lang, onSelect }: Pick<SampleManagementProps, "currentUser" | "users" | "permissions" | "lang"> & { onSelect: (tab: SampleManagementTab) => void }) {
  const isRep = hasSampleCapability(currentUser, "VIEW_OWN_SAMPLE_BALANCE", permissions) && !hasSampleCapability(currentUser, "VIEW_TEAM_SAMPLE_BALANCE", permissions);
  const [metrics, setMetrics] = useState({ activeSkus: 0, centralAvailable: 0, blockedBatches: 0, pendingRequests: 0, awaitingAllocation: 0, partialAllocation: 0, repAvailable: 0, recentDistributions: 0 });
  useEffect(() => {
    const unsubscribers: Array<() => void> = [];
    const requestScopeCapability = hasSampleCapability(currentUser, "ALLOCATE_SAMPLE_STOCK", permissions) ? "VIEW_SAMPLE_INVENTORY" : hasSampleCapability(currentUser, "VIEW_TEAM_SAMPLE_REQUESTS", permissions) ? "VIEW_TEAM_SAMPLE_REQUESTS" : "VIEW_OWN_SAMPLE_REQUESTS";
    const scope = getSampleDataScope(currentUser, requestScopeCapability, permissions);
    const authorizedIds = getAuthorizedSampleUserIds(currentUser, users, scope);
    const scopedSubscribe = (collectionName: string, consume: (rows: Array<{ data(): DocumentData }>) => void) =>
      subscribeToScopedSampleCollection(db, collectionName, scope, authorizedIds, consume);
    if (hasSampleCapability(currentUser, "CREATE_SAMPLE_SKU", permissions) || hasSampleCapability(currentUser, "EDIT_SAMPLE_SKU", permissions)) {
      unsubscribers.push(onSnapshot(collection(db, "sampleCatalog"), snapshot => setMetrics(value => ({ ...value, activeSkus: snapshot.docs.filter(item => item.data().active !== false && item.data().status !== "INACTIVE" && !item.data().isDeleted).length }))));
    }
    if (hasSampleCapability(currentUser, "VIEW_OWN_SAMPLE_REQUESTS", permissions) || hasSampleCapability(currentUser, "VIEW_TEAM_SAMPLE_REQUESTS", permissions) || hasSampleCapability(currentUser, "ALLOCATE_SAMPLE_STOCK", permissions)) unsubscribers.push(scopedSubscribe("sampleRequests", rows => { const requests = rows.map(item => item.data()).filter(item => !item.isDeleted); setMetrics(value => ({ ...value, pendingRequests: requests.filter(item => item.status === "PENDING_APPROVAL").length, awaitingAllocation: requests.filter(item => item.status === "AWAITING_ALLOCATION" || item.status === "APPROVED").length, partialAllocation: requests.filter(item => item.status === "PARTIALLY_ALLOCATED").length })); }));
    if (hasSampleCapability(currentUser, "VIEW_OWN_SAMPLE_BALANCE", permissions) || hasSampleCapability(currentUser, "VIEW_TEAM_SAMPLE_BALANCE", permissions)) {
      unsubscribers.push(scopedSubscribe("sampleAllocations", rows => setMetrics(value => ({ ...value, repAvailable: rows.reduce((sum, item) => { const data = item.data(); return data.status === "ACTIVE" && !data.isDeleted ? sum + Number(data.quantityRemaining || 0) : sum; }, 0) }))));
    }
    if (hasSampleCapability(currentUser, "VIEW_PHYSICIAN_SAMPLE_HISTORY", permissions)) {
      unsubscribers.push(scopedSubscribe("sampleDisbursedLogs", rows => setMetrics(value => ({ ...value, recentDistributions: rows.filter(item => !item.data().isDeleted).length }))));
    }
    if (hasSampleCapability(currentUser, "VIEW_SAMPLE_INVENTORY", permissions)) {
      unsubscribers.push(onSnapshot(collection(db, "sampleInventory"), snapshot => setMetrics(value => ({ ...value, centralAvailable: snapshot.docs.reduce((sum, item) => sum + Number(item.data().availableQuantity || 0), 0) }))));
      unsubscribers.push(onSnapshot(collection(db, "sampleBatches"), snapshot => setMetrics(value => ({ ...value, blockedBatches: snapshot.docs.filter(item => ["BLOCKED", "EXPIRED"].includes(item.data().status)).length }))));
    }
    return () => unsubscribers.forEach(unsubscribe => unsubscribe());
  }, [currentUser, users, permissions]);
  const cards = isRep
    ? [
        { tab: "allocations" as const, label: lang === "ar" ? "رصيدي المتاح من العينات" : "My available Sample balance", detail: String(metrics.repAvailable) },
        { tab: "requests" as const, label: lang === "ar" ? "طلباتي المعلقة" : "My pending requests", detail: String(metrics.pendingRequests) },
        { tab: "requests" as const, label: lang === "ar" ? "معتمد وبانتظار التخصيص" : "Approved — Awaiting Allocation", detail: String(metrics.awaitingAllocation + metrics.partialAllocation) },
        { tab: "distribution" as const, label: lang === "ar" ? "توزيعاتي" : "My distributions", detail: String(metrics.recentDistributions) }
      ]
    : [
        ...(hasSampleCapability(currentUser, "CREATE_SAMPLE_SKU", permissions) || hasSampleCapability(currentUser, "EDIT_SAMPLE_SKU", permissions) ? [{ tab: "catalog" as const, label: lang === "ar" ? "وحدات العينات النشطة" : "Active Sample SKUs", detail: String(metrics.activeSkus) }] : []),
        ...(hasSampleCapability(currentUser, "VIEW_SAMPLE_INVENTORY", permissions) ? [{ tab: "inventory" as const, label: lang === "ar" ? "المخزون المركزي المتاح" : "Central available stock", detail: String(metrics.centralAvailable) }, { tab: "inventory" as const, label: lang === "ar" ? "دفعات محظورة / منتهية" : "Blocked / expired batches", detail: String(metrics.blockedBatches) }] : []),
        ...(hasSampleCapability(currentUser, "VIEW_TEAM_SAMPLE_REQUESTS", permissions) ? [{ tab: "requests" as const, label: lang === "ar" ? "طلبات معلقة ضمن النطاق" : "Pending scoped requests", detail: String(metrics.pendingRequests) }] : []),
        ...(hasSampleCapability(currentUser, "APPROVE_SAMPLE_REQUEST", permissions) ? [{ tab: "approvals" as const, label: lang === "ar" ? "الموافقات المعلقة" : "Pending approvals", detail: String(metrics.pendingRequests) }] : []),
        ...(hasSampleCapability(currentUser, "ALLOCATE_SAMPLE_STOCK", permissions) ? [{ tab: "allocations" as const, label: lang === "ar" ? "بانتظار التخصيص" : "Awaiting allocation", detail: String(metrics.awaitingAllocation + metrics.partialAllocation) }] : [])
      ];
  return <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4" id="samples-overview-cards">
    {cards.map(card => <button key={card.tab} onClick={() => onSelect(card.tab)} className="text-start bg-white rounded-xl border border-gray-100 shadow-xs p-5 hover:border-indigo-200 hover:shadow-sm transition-all">
      <p className="text-sm font-bold text-gray-900">{card.label}</p><p className="text-2xl font-mono font-bold text-indigo-600 mt-2">{card.detail}</p>
    </button>)}
  </div>;
}

export default function SampleManagement({ currentUser, users, products, physicians, permissions, lang, profileLoaded, initialTab = "overview", onNavigate }: SampleManagementProps) {
  const visibleTabs = useMemo(() => getVisibleSampleManagementTabs(currentUser, permissions), [currentUser, permissions]);
  const authorizedInitial = getAuthorizedInitialSampleTab(currentUser, initialTab, permissions);
  const [activeTab, setActiveTab] = useState<SampleManagementTab>(authorizedInitial);
  useEffect(() => setActiveTab(getAuthorizedInitialSampleTab(currentUser, initialTab, permissions)), [currentUser, initialTab, permissions]);
  const isRtl = lang === "ar";
  const selectTab = (tab: SampleManagementTab) => {
    setActiveTab(tab);
    onNavigate?.(getSampleManagementRoute(tab));
  };
  return <div className="space-y-5 max-w-[1600px] mx-auto" dir={isRtl ? "rtl" : "ltr"} id="sample-management-workspace">
    <div className="bg-white p-5 sm:p-6 rounded-xl border border-gray-100 shadow-xs">
      <h1 className="text-2xl font-bold text-gray-900">{isRtl ? "إدارة العينات" : "Sample Management"}</h1>
      <p className="text-sm text-gray-500 mt-1">{isRtl ? "مساحة تشغيل موحدة لدورة حياة العينات" : "Unified operations workspace for the canonical Samples lifecycle"}</p>
    </div>
    <nav className="bg-white rounded-xl border border-gray-100 px-2 overflow-x-auto" aria-label="Sample Management tabs">
      <div className="flex min-w-max">
        {visibleTabs.map(tab => { const Icon = icons[tab.id]; return <button key={tab.id} id={`sample-tab-${tab.id}`} onClick={() => selectTab(tab.id)} className={`flex items-center gap-2 px-4 py-3 text-sm border-b-2 whitespace-nowrap ${activeTab === tab.id ? "border-indigo-600 text-indigo-700 font-bold" : "border-transparent text-gray-500 hover:text-gray-800"}`}><Icon className="w-4 h-4" />{tab.label[lang]}</button>; })}
      </div>
    </nav>
    <section id={`sample-management-panel-${activeTab}`}>
      {activeTab === "overview" && <SampleOverview currentUser={currentUser} users={users} permissions={permissions} lang={lang} onSelect={selectTab} />}
      {activeTab === "catalog" && <SampleInventory currentUser={currentUser} products={products} permissions={permissions} lang={lang} workspaceSection="catalog" />}
      {activeTab === "inventory" && <SampleInventory currentUser={currentUser} products={products} permissions={permissions} lang={lang} workspaceSection="inventory" />}
      {activeTab === "requests" && <SampleRequests currentUser={currentUser} users={users} physicians={physicians} permissions={permissions} lang={lang} profileLoaded={profileLoaded} />}
      {activeTab === "approvals" && <SampleApprovals currentUser={currentUser} users={users} physicians={physicians} permissions={permissions} lang={lang} profileLoaded={profileLoaded} />}
      {activeTab === "allocations" && <SampleAllocation currentUser={currentUser} users={users} products={products} permissions={permissions} lang={lang} profileLoaded={profileLoaded} />}
      {activeTab === "distribution" && <SampleDisbursedLog currentUser={currentUser} users={users} products={products} physicians={physicians} permissions={permissions} lang={lang} onNavigate={onNavigate} />}
    </section>
  </div>;
}
