import React, { useState, useEffect } from "react";
import { 
  LayoutDashboard, 
  Stethoscope, 
  Pill, 
  Database, 
  Warehouse, 
  FileText, 
  ShoppingCart, 
  History, 
  Settings as SettingsIcon, 
  Users, 
  LogOut,
  ChevronDown,
  ChevronRight,
  Globe,
  CircleDot,
  Coins,
  Clock,
  Target,
  Package,
  Truck,
  Bell,
  Video,
  CheckSquare,
  Boxes,
  CreditCard,
  BookOpen,
  MapPin,
  UserCheck
} from "lucide-react";
import { Role, User, Permissions } from "../types";
import { isSampleManagementRoute } from "../lib/sampleWorkspace";
import type { AccessGovernanceRecord } from "../lib/accessGovernance";
import { canAccessCanonicalModule, canAccessCanonicalView } from "../lib/canonicalAccessControl";
import { sidebarNavigationRegistryForRole } from "../lib/sidebarNavigationRegistry";

interface SidebarProps {
  currentUser: User;
  activeView: string;
  setActiveView: (view: string) => void;
  lang: "en" | "ar";
  permissionsMatrix: Record<Role, Permissions>;
  accessGovernanceMatrix: Partial<Record<Role, AccessGovernanceRecord>>;
}

interface SidebarChild {
  id: string;
  label: { en: string; ar: string };
  roles?: Role[];
  badge?: string | number;
}

interface SidebarGroup {
  id: string;
  label: { en: string; ar: string };
  icon: any;
  children?: SidebarChild[];
  roles?: Role[];
}

const SIDEBAR_GROUP_ICONS: Record<string, any> = {
  dashboard: LayoutDashboard, "field-operations": Stethoscope, pharmacies: Pill,
  products: Database, "master-data": Boxes, samples: Warehouse, marketing: FileText,
  "sales-and-orders": ShoppingCart, "territory-team": MapPin, supervision: UserCheck,
  finance: Coins, productivity: Clock, targets: Target, inventory: Package,
  operations: Truck, analytics: History, administration: SettingsIcon, account: Users,
};

export default function Sidebar({
  currentUser,
  activeView,
  setActiveView,
  lang,
  permissionsMatrix,
  accessGovernanceMatrix,
}: SidebarProps) {
  const isRtl = lang === "ar";

  useEffect(() => {
    const timestamp = new Date().toISOString();
    console.info(`[DIAGNOSTIC] [${timestamp}] Sidebar mounted`, {
      userId: currentUser?.id || "none",
      role: currentUser?.role || "none",
      activeView
    });
  }, []);

  const t = {
    en: {
      crm: "MENAREPS CRM",
      tagline: "Pharma Field Operations",
      role: "Role",
      region: "Region"
    },
    ar: {
      crm: "مينا ريبس CRM",
      tagline: "إدارة العمليات الدوائية الميدانية",
      role: "الدور",
      region: "المنطقة"
    }
  }[lang];

  const menuConfig: SidebarGroup[] = sidebarNavigationRegistryForRole(currentUser.role).map(group => ({
    ...group,
    children: group.children ? [...group.children] : undefined,
    icon: SIDEBAR_GROUP_ICONS[group.id] || LayoutDashboard,
  }));

  // Collapsed sections management state
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  // Auto-expand section containing activeView on mount or view change
  useEffect(() => {
    const parentGroup = menuConfig.find(group => 
      group.children?.some(child => child.id === activeView || (child.id === "sample-management" && isSampleManagementRoute(activeView)))
    );
    if (parentGroup) {
      setExpandedSections(prev => ({
        ...prev,
        [parentGroup.id]: true
      }));
    }
  }, [activeView]);

  const toggleSection = (groupId: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [groupId]: !prev[groupId]
    }));
  };

  const accessContext = {
    user: currentUser,
    rolePermissions: permissionsMatrix[currentUser.role],
    accessGovernance: accessGovernanceMatrix[currentUser.role],
  };

  // Sidebar metadata is presentation-only; the canonical evaluator is authoritative.
  const isGroupAllowed = (group: SidebarGroup) => {
    return canAccessCanonicalModule(accessContext, group.id)
      || Boolean(group.children?.some(child => canAccessCanonicalView(accessContext, child.id)));
  };

  const isChildAllowed = (childId: string) => {
    return canAccessCanonicalView(accessContext, childId);
  };

  return (
    <div className={`flex flex-col w-64 h-full bg-slate-900 text-slate-300 border-r border-slate-800 transition-all duration-300 ${isRtl ? 'order-last border-r-0 border-l' : ''}`} id="sidebar-container">
      
      {/* Brand Header */}
      <div className="flex items-center gap-3 p-5 border-b border-slate-800/80" id="sidebar-header">
        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-lg text-white font-sans shadow-sm" id="sidebar-brand-m">
          M
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-extrabold tracking-tight text-white font-sans" id="crm-title">
            MENAREPS <span className="text-blue-500 font-bold">CRM</span>
          </span>
          <span className="text-[9px] font-mono text-slate-500 tracking-wider" id="crm-tagline">
            {t.tagline}
          </span>
        </div>
      </div>

      {/* Logged in User Badge */}
      <div className="p-4 bg-slate-950/20 border-b border-slate-800/80" id="user-badge-panel">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold font-sans text-xs shrink-0">
            {currentUser.name.split(" ").map(n => n[0]).join("")}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-bold text-white truncate" id="user-name">
              {currentUser.name}
            </span>
            <span className="text-[9px] font-mono bg-slate-800 text-blue-400 px-1.5 py-0.5 rounded border border-slate-700 self-start mt-0.5 truncate" id="user-role-tag">
              {currentUser.role}
            </span>
          </div>
        </div>
        <div className="mt-2.5 flex justify-between text-[9px] text-slate-500 font-mono" id="user-meta-lines">
          <span>{t.region}: {currentUser.region}</span>
          <span>{currentUser.territory !== "All" ? currentUser.territory : ""}</span>
        </div>
      </div>

      {/* Hierarchical Collapsible Navigation */}
      <div className="flex-1 overflow-y-auto px-2.5 py-4 space-y-1 scrollbar-thin select-none" id="sidebar-navigation">
        {menuConfig.map((group) => {
          if (!isGroupAllowed(group)) return null;

          const IconComponent = group.icon;
          const hasChildren = group.children && group.children.length > 0;
          const isExpanded = !!expandedSections[group.id];
          const isGroupActive = activeView === group.id || group.children?.some(c => c.id === activeView || (c.id === "sample-management" && isSampleManagementRoute(activeView)));

          if (!hasChildren) {
            // Root menu item like Dashboard
            const isActive = activeView === group.id;
            return (
              <button
                key={group.id}
                onClick={() => setActiveView(group.id)}
                className={`flex items-center gap-3 w-full px-3.5 py-2.5 text-xs font-bold rounded-lg transition-all duration-150 ${
                  isActive 
                    ? "bg-slate-800 text-white shadow-xs border-l-4 border-blue-500" 
                    : "text-slate-400 hover:bg-slate-850 hover:text-white"
                }`}
                id={`nav-item-${group.id}`}
              >
                <IconComponent size={16} className={isActive ? "text-blue-400" : "text-slate-500"} />
                <span className="truncate">{isRtl ? group.label.ar : group.label.en}</span>
              </button>
            );
          }

          return (
            <div key={group.id} className="space-y-1" id={`group-container-${group.id}`}>
              {/* Parent Expandable Container Button */}
              <button
                onClick={() => toggleSection(group.id)}
                className={`flex items-center justify-between w-full px-3.5 py-2.5 text-xs font-bold rounded-lg transition-all duration-150 ${
                  isGroupActive 
                    ? "text-white bg-slate-850/40" 
                    : "text-slate-400 hover:bg-slate-850 hover:text-white"
                }`}
              >
                <div className="flex items-center gap-3 truncate">
                  <IconComponent size={16} className={isGroupActive ? "text-blue-400" : "text-slate-500"} />
                  <span className="truncate">{isRtl ? group.label.ar : group.label.en}</span>
                </div>
                
                {/* Chevron icon toggler */}
                <ChevronDown 
                  size={14} 
                  className={`text-slate-500 transition-transform duration-200 shrink-0 ${
                    isExpanded ? "transform rotate-180 text-blue-400" : ""
                  }`} 
                />
              </button>

              {/* Nested Collapsible Children list */}
              {isExpanded && (
                <div className="pl-6 pr-1 space-y-0.5 border-l border-slate-800/80 ml-5 my-1 animate-slide-down">
                  {group.children?.filter((child) => isChildAllowed(child.id)).map((child) => {
                    const isChildActive = activeView === child.id || (child.id === "sample-management" && isSampleManagementRoute(activeView));
                    return (
                      <button
                        key={child.id}
                        onClick={() => setActiveView(child.id)}
                        className={`flex items-center justify-between w-full px-3 py-1.5 text-[11px] font-medium rounded-md transition-all duration-150 ${
                          isChildActive
                            ? "bg-blue-600/10 text-blue-400 font-bold border-r-2 border-blue-500 bg-slate-800/50"
                            : "text-slate-400 hover:text-white hover:bg-slate-850/20"
                        }`}
                        id={`nav-child-${child.id}`}
                      >
                        <div className="flex items-center gap-2.5 truncate">
                          <CircleDot size={8} className={isChildActive ? "text-blue-400 scale-125" : "text-slate-600"} />
                          <span className="truncate">{isRtl ? child.label.ar : child.label.en}</span>
                        </div>
                        {child.badge && (
                          <span className="bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0">
                            {child.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

    </div>
  );
}
