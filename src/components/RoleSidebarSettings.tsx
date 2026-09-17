import React, { useEffect, useMemo, useState } from "react";
import { Check, Eye, EyeOff, Info, Lock, RotateCcw, Save, Search, Shield, X } from "lucide-react";
import { auth } from "../lib/firebase";
import { CANONICAL_USER_ROLES, Role, type Permissions, type User } from "../types";
import type { AccessGovernanceRecord } from "../lib/accessGovernance";
import { evaluateModuleAccess, evaluateViewAccess, type CanonicalAccessDecision } from "../lib/canonicalAccessControl";
import { normalizeNavigationRestrictions, type NavigationRestrictions } from "../lib/navigationRestrictionPolicy";
import { sidebarNavigationRegistryForRole, type SidebarNavigationGroup, type SidebarNavigationItem } from "../lib/sidebarNavigationRegistry";

interface Props {
  lang: "en" | "ar";
  currentUser: User;
  permissionsMatrix: Record<Role, Permissions>;
  accessGovernanceMatrix: Partial<Record<Role, AccessGovernanceRecord>>;
}

type StatusFilter = "all" | "visible" | "conditional" | "hidden";
type DisplayStatus = Exclude<StatusFilter, "all">;
interface EvaluatedItem { item: SidebarNavigationItem; decision: CanonicalAccessDecision; upstream: CanonicalAccessDecision }
interface EvaluatedGroup extends EvaluatedItem { item: SidebarNavigationGroup; children: EvaluatedItem[] }

const empty = (): NavigationRestrictions => ({ hiddenModules: [], hiddenViews: [] });

function displayStatus(decision: CanonicalAccessDecision): DisplayStatus {
  if (decision.baseline === "CONDITIONAL") return "conditional";
  return decision.allowed ? "visible" : "hidden";
}

function statusPresentation(decision: CanonicalAccessDecision) {
  if (decision.baseline === "CONDITIONAL") return {
    text: decision.allowed ? "Conditional — Currently Allowed" : "Conditional — Currently Denied",
    cls: decision.allowed ? "bg-amber-100 text-amber-800" : "bg-orange-100 text-orange-800",
    reason: decision.allowed
      ? "The existing specialized condition is currently satisfied; no navigation restriction is applied."
      : decision.reason === "GOVERNANCE_DENY"
        ? "Restricted by role navigation governance. The underlying specialized condition remains authoritative."
        : "The existing specialized capability condition is not currently satisfied.",
  };
  return decision.allowed
    ? { text: "Visible", cls: "bg-emerald-100 text-emerald-700", reason: "Canonical role baseline: ALLOW." }
    : { text: "Hidden", cls: "bg-slate-200 text-slate-600", reason: decision.reason === "GOVERNANCE_DENY" ? "Restricted by role navigation governance." : "Canonical role baseline: DENY." };
}

function matchesFilter(decision: CanonicalAccessDecision, filter: StatusFilter): boolean {
  return filter === "all" || displayStatus(decision) === filter;
}

export default function RoleSidebarSettings({ lang, currentUser, permissionsMatrix, accessGovernanceMatrix }: Props) {
  const isRtl = lang === "ar";
  const [selectedRole, setSelectedRole] = useState<Role>(Role.MEDICAL_REP);
  const [draft, setDraft] = useState<NavigationRestrictions>(empty);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const authorized = currentUser.role === Role.SUPER_ADMIN || currentUser.role === Role.ADMIN;
  const persisted = accessGovernanceMatrix[selectedRole];

  useEffect(() => setDraft(normalizeNavigationRestrictions(persisted?.navigationRestrictions)), [selectedRole, persisted]);

  const selectedUser = useMemo(() => ({
    id: `role-preview:${selectedRole}`, name: selectedRole, email: "role-preview@example.invalid",
    role: selectedRole, active: true, territory: "", region: "",
  } as User), [selectedRole]);
  const governance = useMemo<AccessGovernanceRecord>(() => ({
    role: selectedRole,
    active: persisted?.active !== false,
    navigation: persisted?.navigation || [],
    navigationRestrictions: draft,
    capabilities: persisted?.capabilities || [],
    dataScopeMode: persisted?.dataScopeMode || "CUSTOM",
    scopePolicy: persisted?.scopePolicy,
  }), [selectedRole, persisted, draft]);
  const context = { user: selectedUser, rolePermissions: permissionsMatrix[selectedRole], accessGovernance: governance };
  const upstreamContext = { user: selectedUser, rolePermissions: permissionsMatrix[selectedRole], accessGovernance: persisted ? { ...persisted, navigationRestrictions: empty() } : null };
  const registry = sidebarNavigationRegistryForRole(selectedRole);
  const evaluatedRegistry: EvaluatedGroup[] = registry.map(group => ({
    item: group,
    decision: evaluateModuleAccess(context, group.id),
    upstream: evaluateModuleAccess(upstreamContext, group.id),
    children: (group.children || []).map(child => ({ item: child, decision: evaluateViewAccess(context, child.id), upstream: evaluateViewAccess(upstreamContext, child.id) })),
  }));
  const counts = evaluatedRegistry.flatMap(group => [group.decision, ...group.children.map(child => child.decision)]).reduce((result, decision) => {
    result[displayStatus(decision)] += 1;
    return result;
  }, { visible: 0, conditional: 0, hidden: 0 });
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredRegistry = evaluatedRegistry.map(group => {
    const moduleMatchesSearch = !normalizedQuery || group.item.label[lang].toLocaleLowerCase().includes(normalizedQuery);
    const children = group.children.filter(child => (moduleMatchesSearch || child.item.label[lang].toLocaleLowerCase().includes(normalizedQuery)) && matchesFilter(child.decision, statusFilter));
    return moduleMatchesSearch && matchesFilter(group.decision, statusFilter) || children.length ? { ...group, children } : null;
  }).filter((group): group is EvaluatedGroup => group !== null);

  if (!authorized) return <div id="role-sidebar-settings-denied" className="p-6 rounded-xl border border-red-200 bg-red-50 text-red-700 font-semibold">Access denied.</div>;

  const toggleModule = (moduleId: string) => {
    const upstream = evaluateModuleAccess(upstreamContext, moduleId);
    if (upstream.baseline === "DENY" || upstream.reason === "ROUTE_EXCEPTION_DENY") return;
    setDraft(value => ({ ...value, hiddenModules: value.hiddenModules.includes(moduleId as any) ? value.hiddenModules.filter(id => id !== moduleId) : [...value.hiddenModules, moduleId as any] }));
  };
  const toggleView = (viewId: string) => {
    const upstream = evaluateViewAccess(upstreamContext, viewId);
    if (upstream.baseline === "DENY" || upstream.reason === "ROUTE_EXCEPTION_DENY") return;
    setDraft(value => ({ ...value, hiddenViews: value.hiddenViews.includes(viewId) ? value.hiddenViews.filter(id => id !== viewId) : [...value.hiddenViews, viewId] }));
  };
  const mutate = async (operation: "SAVE" | "RESET") => {
    setSaving(true); setMessage("");
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("AUTH_REQUIRED");
      const response = await fetch("/api/access-governance/navigation/mutate", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ operation, role: selectedRole, ...(operation === "SAVE" ? { restrictions: draft } : {}) }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).code || "SAVE_FAILED");
      if (operation === "RESET") setDraft(empty());
      setMessage(operation === "RESET" ? "Navigation restrictions reset to canonical defaults." : "Navigation restrictions saved.");
    } catch (error) { setMessage(`Unable to update navigation: ${error instanceof Error ? error.message : "UNKNOWN"}`); }
    finally { setSaving(false); }
  };

  const restrictionButton = (entry: EvaluatedItem, moduleId?: string) => {
    const locked = entry.upstream.baseline === "DENY" || entry.upstream.reason === "ROUTE_EXCEPTION_DENY";
    const restricted = moduleId ? draft.hiddenViews.includes(entry.item.id) : draft.hiddenModules.includes(entry.item.id as any);
    return <button type="button" aria-label={`Restrict ${entry.item.id}`} disabled={locked} onClick={() => moduleId ? toggleView(entry.item.id) : toggleModule(entry.item.id)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40">{locked ? <Lock size={14}/> : restricted ? <EyeOff size={14}/> : <Eye size={14}/>}</button>;
  };
  const statusBadge = (decision: CanonicalAccessDecision) => {
    const display = statusPresentation(decision);
    return <span className={`rounded-full px-2 py-1 text-[9px] font-bold leading-tight ${display.cls}`}>{display.text}</span>;
  };

  return <div id="role-sidebar-settings-page" className="space-y-4" dir={isRtl ? "rtl" : "ltr"}>
    <header className="flex flex-col gap-3 border-b border-slate-200 pb-4 xl:flex-row xl:items-end xl:justify-between"><div><h1 className="text-xl font-bold text-slate-900">Role Sidebar Settings</h1><p className="mt-1 text-xs text-slate-500">Configure and preview restriction-only Sidebar visibility for canonical MENAREPS roles.</p></div><div className="flex flex-wrap gap-2 text-[10px] font-bold"><span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-700">Visible {counts.visible}</span><span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-800">Conditional {counts.conditional}</span><span className="rounded-full bg-slate-200 px-2.5 py-1 text-slate-600">Hidden {counts.hidden}</span></div></header>

    <section className="grid grid-cols-1 gap-3 rounded-xl border bg-white p-4 md:grid-cols-2 xl:grid-cols-[minmax(13rem,1fr)_minmax(15rem,1.4fr)_auto_auto] xl:items-end">
      <label className="text-[10px] font-bold uppercase text-slate-500">Role<select id="role-sidebar-role-select" value={selectedRole} onChange={event => setSelectedRole(event.target.value as Role)} className="mt-1 block w-full rounded-lg border px-3 py-2 text-sm font-normal normal-case text-slate-800">{CANONICAL_USER_ROLES.map(role => <option key={role}>{role}</option>)}</select></label>
      <label className="text-[10px] font-bold uppercase text-slate-500">Search<span className="relative mt-1 block"><Search size={14} className="absolute left-3 top-2.5 text-slate-400"/><input id="role-sidebar-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search modules and views" className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm font-normal normal-case text-slate-800"/></span></label>
      <label className="text-[10px] font-bold uppercase text-slate-500">Status<select id="role-sidebar-status-filter" value={statusFilter} onChange={event => setStatusFilter(event.target.value as StatusFilter)} className="mt-1 block w-full rounded-lg border px-3 py-2 text-sm font-normal normal-case text-slate-800"><option value="all">All</option><option value="visible">Visible</option><option value="conditional">Conditional</option><option value="hidden">Hidden</option></select></label>
      <button id="role-sidebar-preview" type="button" onClick={() => setPreviewOpen(true)} className="flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold text-slate-700"><Shield size={15}/>Preview Sidebar</button>
    </section>

    <section aria-label="Sidebar Structure" className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
      {filteredRegistry.map(group => { const display = statusPresentation(group.decision); return <article key={group.item.id} data-navigation-module={group.item.id} className="overflow-hidden rounded-xl border bg-white shadow-sm"><div className="flex items-start justify-between gap-2 bg-slate-50 p-3"><div className="min-w-0"><h2 className="truncate text-sm font-bold text-slate-800">{group.item.label[lang]}</h2><span className="font-mono text-[9px] text-slate-400">{group.item.id}</span></div><div className="flex shrink-0 items-center gap-1">{statusBadge(group.decision)}<button type="button" title={display.reason} aria-label={`${group.item.id}: ${display.reason}`} className="rounded-md p-1.5 text-slate-400 hover:bg-white"><Info size={14}/></button>{restrictionButton(group)}</div></div><div className="divide-y">{group.children.map(child => { const childDisplay = statusPresentation(child.decision); return <div key={child.item.id} data-navigation-view={child.item.id} className="flex items-center gap-2 px-3 py-2"><span className="min-w-0 flex-1 truncate text-xs text-slate-700">{child.item.label[lang]}</span>{statusBadge(child.decision)}<button type="button" title={childDisplay.reason} aria-label={`${child.item.id}: ${childDisplay.reason}`} className="rounded-md p-1 text-slate-400 hover:bg-slate-50"><Info size={13}/></button>{restrictionButton(child, group.item.id)}</div>; })}{group.children.length === 0 && <div className="px-3 py-2 text-[10px] text-slate-400">No child views match the current filters.</div>}</div></article>; })}
      {filteredRegistry.length === 0 && <div className="col-span-full rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">No modules or views match the current search and status filter.</div>}
    </section>

    {previewOpen && <div role="dialog" aria-modal="true" aria-labelledby="role-sidebar-preview-title" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" onMouseDown={event => { if (event.currentTarget === event.target) setPreviewOpen(false); }}><div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-slate-900 p-5 text-slate-200 shadow-2xl"><div className="flex items-start justify-between"><div><h2 id="role-sidebar-preview-title" className="font-bold">Effective Sidebar Preview</h2><p className="mt-1 text-[10px] text-slate-400">Same shared registry and canonical evaluator as the production Sidebar.</p></div><button type="button" aria-label="Close Sidebar preview" onClick={() => setPreviewOpen(false)} className="rounded-md p-1 text-slate-400 hover:bg-slate-800"><X size={17}/></button></div><div className="mt-4 space-y-2">{evaluatedRegistry.filter(group => group.decision.allowed).map(group => <div key={group.item.id} className="rounded-lg bg-slate-800 p-3"><div className="text-xs font-semibold">{group.item.label[lang]}</div>{group.children.some(child => child.decision.allowed) && <div className="mt-2 space-y-1 border-l border-slate-700 pl-3">{group.children.filter(child => child.decision.allowed).map(child => <div key={child.item.id} className="text-[11px] text-slate-400">{child.item.label[lang]}</div>)}</div>}</div>)}</div></div></div>}

    {message && <div className="flex items-center gap-2 rounded-lg border p-3 text-sm"><Check size={16}/>{message}</div>}
    <footer className="flex flex-wrap justify-end gap-3"><button id="role-sidebar-reset" disabled={saving} onClick={() => mutate("RESET")} className="flex gap-2 rounded-lg border px-4 py-2 text-sm font-bold"><RotateCcw size={16}/>Reset to Canonical Defaults</button><button id="role-sidebar-save" disabled={saving} onClick={() => mutate("SAVE")} className="flex gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white"><Save size={16}/>Save / Apply</button></footer>
  </div>;
}
