import React, { useState } from "react";
import { GitFork, List, Eye, ZoomIn, ZoomOut, Maximize2, ChevronDown, ChevronRight, Mail, ShieldAlert, Award, User, UserCheck } from "lucide-react";

interface OrgNode {
  name: string;
  role: string;
  email: string;
  reports?: OrgNode[];
}

interface OrganizationStructureProps {
  lang: "en" | "ar";
}

export default function OrganizationStructure({ lang }: OrganizationStructureProps) {
  const isRtl = lang === "ar";
  const [viewType, setViewType] = useState<"tree" | "list">("tree");
  const [zoom, setZoom] = useState<number>(100);

  // Corporate hierarchical structure
  const orgData: OrgNode[] = [
    {
      name: "WalikK Khalid",
      role: "Order Operations Officer",
      email: "walidk@esand.com"
    },
    {
      name: "Mohammed Ramadon",
      role: "Store Manager",
      email: "store@esand.com",
      reports: [
        { name: "Hatem Hatem", role: "Delivery Officer", email: "hatem@esand.com" },
        { name: "Ismail Ismail", role: "Delivery Officer", email: "ismail@esand.com" }
      ]
    },
    {
      name: "Mohammed Yousha",
      role: "Treasury User",
      email: "yousha@esand.com"
    },
    {
      name: "Mustafa Super Admin",
      role: "Super Admin",
      email: "mustafa@pharmacrm.com"
    },
    {
      name: "admin",
      role: "Admin",
      email: "admin@esand.com"
    },
    {
      name: "Salah Hmouda",
      role: "General Manager",
      email: "gm@esand.com",
      reports: [
        {
          name: "Libyasmm Manager",
          role: "Sales & Marketing Manager",
          email: "libyasmm.test@esand.com",
          reports: [
            { name: "Product Manager", role: "Product Manager", email: "pm@esand.com" },
            {
              name: "Aya Alfaitouri",
              role: "Medical Manager",
              email: "aya@esand.com",
              reports: [
                { name: "Aisha Amary", role: "Medical Supervisor", email: "aisha@esand.com" }
              ]
            }
          ]
        },
        {
          name: "libyaMedical Manager",
          role: "Medical Manager",
          email: "libyamedical@esand.com",
          reports: [
            { name: "Tripoli Medsuper", role: "Medical Supervisor", email: "tripoli@esand.com" },
            { name: "Centre Medsuper", role: "Medical Supervisor", email: "centre@esand.com" },
            { name: "Pharmacy Supervisor", role: "Medical Supervisor", email: "pharmacysupervisors@esand.com" },
            { name: "west supervisor west", role: "Medical Supervisor", email: "wsupervisor@esand.com" }
          ]
        },
        {
          name: "libyaM Marketing",
          role: "Marketing Manager",
          email: "libyamk.test@esand.com"
        },
        {
          name: "Hisham Rajab",
          role: "Financial Manager",
          email: "hisham@esand.com",
          reports: [
            { name: "AkramF Breedan", role: "Financial Officer", email: "akram.test@esand.com" },
            { name: "Mohammed Abu Laba", role: "Inventory Manager", email: "laba@esand.com" }
          ]
        },
        {
          name: "Esam Rajab",
          role: "Sales Manager",
          email: "esam.test@esand.com",
          reports: [
            { name: "wholesales Supervisor", role: "Sales Supervisor", email: "whole@esand.com" },
            { name: "Wajdi Qarba", role: "Sales Supervisor", email: "wajdi.test@esand.com" }
          ]
        }
      ]
    },
    {
      name: "Osama Alshibani",
      role: "Medical Rep",
      email: "osama@esand.com"
    },
    {
      name: "Mustafa shwayat",
      role: "Super Admin",
      email: "shwayat.mustafa@gmail.com"
    }
  ];

  // Helper to count total members recursively
  const countMembers = (nodes: OrgNode[]): number => {
    let count = nodes.length;
    nodes.forEach(node => {
      if (node.reports) {
        count += countMembers(node.reports);
      }
    });
    return count;
  };

  const totalMembersCount = countMembers(orgData);

  // Zoom helpers
  const handleZoomIn = () => setZoom(prev => Math.min(prev + 10, 150));
  const handleZoomOut = () => setZoom(prev => Math.max(prev - 10, 30));
  const handleZoomReset = () => setZoom(100);

  // List View Nested Node Renderer
  const [collapsedNodes, setCollapsedNodes] = useState<Record<string, boolean>>({});

  const toggleCollapse = (nodeName: string) => {
    setCollapsedNodes(prev => ({
      ...prev,
      [nodeName]: !prev[nodeName]
    }));
  };

  const renderNestedList = (node: OrgNode, depth: number = 0) => {
    const isCollapsed = collapsedNodes[node.name];
    const hasReports = node.reports && node.reports.length > 0;
    const initials = node.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

    return (
      <div key={node.name} className="select-none">
        {/* Node Row */}
        <div 
          style={{ paddingLeft: `${depth * 28 + 12}px` }}
          className="flex items-center justify-between py-2.5 border-b border-gray-50 hover:bg-gray-50/75 transition-colors"
        >
          <div className="flex items-center gap-3">
            {/* Toggle Arrow */}
            {hasReports ? (
              <button 
                onClick={() => toggleCollapse(node.name)}
                className="p-1 rounded hover:bg-gray-200 text-gray-500 transition-colors"
              >
                {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
            ) : (
              <div className="w-6" />
            )}

            {/* Initials Avatar */}
            <div className="w-9 h-9 rounded-full bg-blue-50 text-blue-700 font-bold text-xs flex items-center justify-center border border-blue-100 shadow-sm">
              {initials}
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-900">{node.name}</span>
                <span className="text-[10px] text-gray-400 font-mono hidden md:inline">{node.email}</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-700">
                  {node.role}
                </span>
                {hasReports && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700">
                    {node.reports!.length} {node.reports!.length === 1 ? (isRtl ? "تقرير" : "report") : (isRtl ? "تقارير" : "reports")}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 pr-4">
            <span className="text-xs text-gray-400 font-mono hidden sm:inline">{node.email}</span>
          </div>
        </div>

        {/* Child Reports */}
        {hasReports && !isCollapsed && (
          <div className="relative">
            {/* Indent Guide Line */}
            <div 
              style={{ left: `${depth * 28 + 24}px` }}
              className="absolute top-0 bottom-0 w-px bg-gray-100"
            />
            {node.reports!.map(report => renderNestedList(report, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  // Tree View Nested Card Renderer
  const renderTreeCard = (node: OrgNode) => {
    const initials = node.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    const hasReports = node.reports && node.reports.length > 0;

    return (
      <div key={node.name} className="flex flex-col items-center">
        {/* Card itself */}
        <div className="bg-white px-5 py-4 rounded-xl border border-blue-500 shadow-sm min-w-[220px] text-center flex flex-col items-center space-y-2 relative">
          <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-700 font-bold text-xs flex items-center justify-center border border-blue-100">
            {initials}
          </div>
          <div>
            <h5 className="text-sm font-bold text-gray-900">{node.name}</h5>
            <p className="text-[10px] text-gray-400 font-mono mt-0.5">{node.email}</p>
          </div>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-50 text-gray-700 text-[10px] font-semibold border border-gray-100">
            {node.role}
          </span>
          {hasReports && (
            <span className="absolute -bottom-2.5 bg-blue-600 text-white font-bold text-[9px] px-1.5 py-0.5 rounded-full shadow-sm border border-white">
              {node.reports!.length} {isRtl ? "تقارير" : "reports"}
            </span>
          )}
        </div>

        {/* Children connecting line and recursion */}
        {hasReports && (
          <div className="flex flex-col items-center mt-6 relative w-full">
            {/* Vertical Line */}
            <div className="absolute -top-6 bottom-full w-px bg-gray-200 h-6" />
            <div className="w-px bg-gray-200 h-4" />

            {/* Horizontal Line connector */}
            <div className="flex gap-8 relative pt-4">
              {node.reports!.length > 1 && (
                <div className="absolute top-0 left-[110px] right-[110px] h-px bg-gray-200" />
              )}
              {node.reports!.map((report, idx) => (
                <div key={report.name} className="relative flex flex-col items-center">
                  {/* Branch connector vertical tick */}
                  <div className="absolute -top-4 w-px h-4 bg-gray-200" />
                  {renderTreeCard(report)}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900 flex items-center gap-2">
            <GitFork className="h-6 w-6 text-blue-600" />
            {isRtl ? "الهيكل التنظيمي للشركة" : "Organization Structure"}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {isRtl ? "عرض واستكشاف التسلسل الهرمي للمشرفين والمندوبين الميدانيين" : "View and explore the organizational hierarchy"}
          </p>
        </div>

        {/* Toggle buttons */}
        <div className="inline-flex rounded-xl p-1 bg-gray-100 self-start">
          <button
            onClick={() => setViewType("tree")}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              viewType === "tree" ? "bg-blue-600 text-white shadow-sm" : "text-gray-600 hover:text-gray-950"
            }`}
          >
            <GitFork className="h-3.5 w-3.5" />
            {isRtl ? "مخطط الشجرة" : "Tree View"}
          </button>
          <button
            onClick={() => setViewType("list")}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              viewType === "list" ? "bg-blue-600 text-white shadow-sm" : "text-gray-600 hover:text-gray-950"
            }`}
          >
            <List className="h-3.5 w-3.5" />
            {isRtl ? "عرض القائمة" : "List View"}
          </button>
        </div>
      </div>

      {/* Main Board Card */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden flex flex-col min-h-[500px]">
        {/* Toolbar */}
        <div className="bg-gray-50 border-b border-gray-100 px-5 py-3 flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
            <GitFork className="h-4 w-4 text-blue-600" />
            {isRtl ? "مخطط الهيكل التنظيمي" : "Organization Chart"}
          </span>

          <div className="flex items-center gap-4">
            {viewType === "tree" && (
              <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg p-1 shadow-sm">
                <button 
                  onClick={handleZoomOut} 
                  className="p-1.5 rounded text-gray-500 hover:bg-gray-100 hover:text-gray-950 transition-colors" 
                  title={isRtl ? "تصغير" : "Zoom Out"}
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
                <button 
                  onClick={handleZoomReset}
                  className="text-xs px-2.5 font-bold text-gray-700 hover:text-blue-600 transition-colors"
                >
                  {zoom}%
                </button>
                <button 
                  onClick={handleZoomIn} 
                  className="p-1.5 rounded text-gray-500 hover:bg-gray-100 hover:text-gray-950 transition-colors" 
                  title={isRtl ? "تكبير" : "Zoom In"}
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            <span className="text-xs font-bold text-gray-400 bg-gray-100 px-3 py-1 rounded-full">
              {totalMembersCount} {isRtl ? "عضو نشط" : "members"}
            </span>
          </div>
        </div>

        {/* Content Board */}
        <div className="flex-1 p-6 overflow-auto bg-gray-50/20">
          {viewType === "tree" ? (
            <div className="flex justify-center min-w-max p-8 transition-transform duration-200 origin-top" style={{ transform: `scale(${zoom / 100})` }}>
              <div className="flex flex-col items-center">
                {/* Peer Group representing top rows */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-8">
                  {orgData.map(node => (
                    <div key={node.name} className="flex flex-col items-center">
                      {renderTreeCard(node)}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm">
              <div className="divide-y divide-gray-100">
                {orgData.map(node => renderNestedList(node, 0))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
