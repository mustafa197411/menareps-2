import React, { useState, useMemo } from "react";
import { Users, Search, Download, Plus, Star, MapPin, Calendar, CheckCircle2, ChevronDown, Trash, UserPlus, X, Briefcase } from "lucide-react";
import { User } from "../../types";
import { getTeamRoleCounts } from "../../lib/teamMetrics";

interface TeamMember {
  id: string;
  name: string;
  role: string;
  assignedHub: string;
  visitsThisMonth: number;
  completionRate: number; // percentage
  status: "Active / In Field" | "Off-duty" | "Assigned";
  email: string;
}

interface TeamManagementProps {
  lang: "en" | "ar";
  currentUser: User;
  users?: User[];
  setUsers?: React.Dispatch<React.SetStateAction<User[]>>;
  physicianVisits?: any[];
  pharmacyVisits?: any[];
}

export default function TeamManagement({ 
  lang,
  currentUser,
  users = [],
  setUsers,
  physicianVisits = [],
  pharmacyVisits = []
}: TeamManagementProps) {
  const isRtl = lang === "ar";

  // Compute team members dynamically from real users list
  const team = useMemo(() => {
    return users.filter((u) => u.id !== currentUser.id).map((u) => {
      const userVisits = physicianVisits.filter(v => v.representativeId === u.id || v.repId === u.id).length + 
                         pharmacyVisits.filter(v => v.representativeId === u.id || v.repId === u.id).length;

      return {
        id: u.id || `U-${Math.floor(Math.random() * 10000)}`,
        name: `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email || "No Name",
        role: u.role || "Pending Approval",
        assignedHub: u.territory || u.region || (isRtl ? "عام للجميع" : "All Portfolio"),
        visitsThisMonth: userVisits,
        completionRate: userVisits > 0 ? 100 : 0,
        status: u.active ? "Active / In Field" : "Off-duty",
        email: u.email || "",
      } as TeamMember;
    });
  }, [users, currentUser.id, physicianVisits, pharmacyVisits, isRtl]);

  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("All");
  const [isAddOpen, setIsAddOpen] = useState(false);

  // New Member Form State
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberRole, setNewMemberRole] = useState("Medical Representative");
  const [newMemberHub, setNewMemberHub] = useState("");
  const [newMemberEmail, setNewMemberEmail] = useState("");

  const uniqueRoles = useMemo(() => {
    const roles = new Set(team.map(t => t.role));
    return ["All", ...Array.from(roles)];
  }, [team]);

  const filteredTeam = useMemo(() => {
    return team.filter(member => {
      const matchesSearch = member.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
        member.assignedHub.toLowerCase().includes(searchQuery.toLowerCase()) ||
        member.email.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesRole = roleFilter === "All" || member.role === roleFilter;
      return matchesSearch && matchesRole;
    });
  }, [team, searchQuery, roleFilter]);

  // Aggregate stats
  const stats = useMemo(() => {
    const roleCounts = getTeamRoleCounts(team);
    const totalTeam = roleCounts.totalTeam;
    const activeReps = team.filter(t => t.status === "Active / In Field").length;
    
    return {
      totalTeam,
      activeReps,
      medicalReps: roleCounts.medicalReps,
      salesReps: roleCounts.salesReps,
      performance: totalTeam > 0 ? "Active" : "N/A"
    };
  }, [team]);

  const handleAddMember = (e: React.FormEvent) => {
    e.preventDefault();
    alert(isRtl
      ? "يجب إنشاء الموظفين وتعيينهم من إدارة المستخدمين المعتمدة."
      : "Create and assign employees through canonical User Management.");
    setIsAddOpen(false);

    // Reset Form
    setNewMemberName("");
    setNewMemberHub("");
    setNewMemberEmail("");
    setNewMemberRole("Medical Representative");
  };

  const handleDeleteMember = (id: string) => {
    void id;
    alert(isRtl
      ? "يجب إدارة حسابات الموظفين من إدارة المستخدمين المعتمدة."
      : "Manage employee accounts through canonical User Management.");
  };

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900 flex items-center gap-2">
            <Users className="h-6 w-6 text-blue-600" />
            {isRtl ? "إدارة فريق العمل الميداني" : "Team Management"}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {isRtl ? "مراقبة وإدارة أداء فريقك الميداني وتغطيتهم للزيارات" : "Monitor and manage your team's performance"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => {
              const headers = [
                "Email", "First Name", "Last Name", "Role", "Manager Email", "Territories"
              ];
              const csvRows = [headers.join(",")];
              team.forEach(m => {
                const nameParts = m.name.split(" ");
                const firstName = nameParts[0] || "";
                const lastName = nameParts.slice(1).join(" ") || "Employee";
                const row = [
                  `"${(m.email || `${m.id.toLowerCase()}@menareps.com`).replace(/"/g, '""')}"`,
                  `"${firstName.replace(/"/g, '""')}"`,
                  `"${lastName.replace(/"/g, '""')}"`,
                  `"${(m.role || "Medical Representative").replace(/"/g, '""')}"`,
                  `"manager@menareps.com"`,
                  `"${(m.assignedHub || "").replace(/"/g, '""')}"`
                ];
                csvRows.push(row.join(","));
              });
              const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + csvRows.join("\n");
              const encodedUri = encodeURI(csvContent);
              const link = document.createElement("a");
              link.setAttribute("href", encodedUri);
              link.setAttribute("download", `users_export_${new Date().toISOString().split("T")[0]}.csv`);
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50 transition-colors"
          >
            <Download className="h-4 w-4" />
            {isRtl ? "تصدير CSV" : "Export CSV"}
          </button>
          <button 
            onClick={() => setIsAddOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg shadow-sm hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
            {isRtl ? "إضافة عضو فريق" : "Add Team Member"}
          </button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">
              {isRtl ? "إجمالي الفريق" : "Total Team"}
            </p>
            <h3 className="text-2xl font-bold text-gray-950 mt-1">{stats.totalTeam}</h3>
            <p className="text-xs text-gray-400 mt-1">
              {isRtl
                ? `${stats.medicalReps} طبي، ${stats.salesReps} تجاري`
                : `${stats.medicalReps} Medical, ${stats.salesReps} Sales`}
            </p>
          </div>
          <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
            <Users className="h-6 w-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">
              {isRtl ? "المندوبون الطبيون" : "Medical Reps"}
            </p>
            <h3 className="text-2xl font-bold text-gray-950 mt-1">{stats.medicalReps}</h3>
            <p className="text-xs text-gray-400 mt-1">
              {isRtl ? "نشطين بالزيارات العلمية" : "Active medical profiling"}
            </p>
          </div>
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-lg">
            <Briefcase className="h-6 w-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">
              {isRtl ? "المندوبون التجاريون" : "Sales Reps"}
            </p>
            <h3 className="text-2xl font-bold text-gray-950 mt-1">{stats.salesReps}</h3>
            <p className="text-xs text-gray-400 mt-1">
              {isRtl ? "تغطية الصيدليات وتأكيد الطلبيات" : "Active order fulfillment"}
            </p>
          </div>
          <div className="p-3 bg-purple-50 text-purple-600 rounded-lg">
            <Users className="h-6 w-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">
              {isRtl ? "حالة الأداء" : "Performance"}
            </p>
            <h3 className="text-2xl font-bold text-emerald-600 mt-1">{isRtl ? "ممتاز" : stats.performance}</h3>
            <p className="text-xs text-gray-400 mt-1">
              {isRtl ? "حالة تغطية الفريق" : "Team status optimized"}
            </p>
          </div>
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-lg">
            <Star className="h-6 w-6 animate-pulse" />
          </div>
        </div>
      </div>

      {/* Filters bar */}
      <div className="flex flex-col sm:flex-row gap-4">
        {/* Search bar */}
        <div className="relative flex-1">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={isRtl ? "البحث عن أعضاء الفريق..." : "Search team members..."}
            className="w-full text-sm pl-9 pr-3 py-2.5 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm"
          />
          <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
        </div>

        {/* Roles Filter Dropdown */}
        <div className="relative w-full sm:w-64">
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="w-full text-sm pl-3 pr-10 py-2.5 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 appearance-none transition-all shadow-sm cursor-pointer"
          >
            {uniqueRoles.map(r => (
              <option key={r} value={r}>
                {r === "All" ? (isRtl ? "جميع الأدوار" : "All Roles") : r}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-3 h-4 w-4 text-gray-400 pointer-events-none" />
        </div>
      </div>

      {/* Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredTeam.map((member) => {
          const initials = member.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
          const isFullProgress = member.completionRate === 100;
          
          return (
            <div 
              key={member.id}
              className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-all flex flex-col justify-between relative overflow-hidden group"
            >
              <div>
                {/* Header: Name and Role Badge */}
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-700 font-bold text-sm flex items-center justify-center border border-blue-100 shadow-inner">
                    {initials}
                  </div>
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center justify-between">
                      <h4 className="text-md font-semibold text-gray-900 leading-tight group-hover:text-blue-600 transition-colors">
                        {member.name}
                      </h4>
                      <button 
                        onClick={() => handleDeleteMember(member.id)}
                        className="text-gray-300 hover:text-red-500 p-1 rounded-md hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100"
                        title={isRtl ? "إزالة المندوب" : "Remove member"}
                      >
                        <Trash className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5 items-center">
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100">
                        <Briefcase className="w-3 h-3" />
                        {member.role}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Details Section */}
                <div className="mt-5 space-y-2 text-sm text-gray-600">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-gray-400" />
                    <span>
                      {isRtl ? "معين في: " : "Assigned: "}
                      <span className="font-medium text-gray-800">{member.assignedHub}</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-gray-400" />
                    <span>
                      {isRtl ? "زيارات هذا الشهر: " : "Visits this month: "}
                      <span className="font-semibold text-gray-950">{member.visitsThisMonth}</span>
                    </span>
                  </div>
                </div>

                {/* Completion Rate Progress */}
                <div className="mt-5 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-gray-500">{isRtl ? "معدل الإنجاز" : "Completion Rate"}</span>
                    <span className={`font-bold ${isFullProgress ? "text-emerald-600" : "text-blue-600"}`}>
                      {member.completionRate}%
                    </span>
                  </div>
                  <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full transition-all duration-500 ${isFullProgress ? "bg-emerald-500" : "bg-blue-600"}`}
                      style={{ width: `${member.completionRate}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Status and Footer Info */}
              <div className="border-t border-gray-50 pt-3 mt-4 flex items-center justify-between text-xs text-gray-400">
                <span className="font-mono">{member.email}</span>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  member.status === "Active / In Field" ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : "bg-gray-100 text-gray-600"
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${member.status === "Active / In Field" ? "bg-emerald-500" : "bg-gray-400"}`} />
                  {member.status}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Team Member Dialog Modal */}
      {isAddOpen && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full border border-gray-100 animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h3 className="text-md font-bold text-gray-900 flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-blue-600" />
                {isRtl ? "إضافة عضو فريق جديد" : "Add Team Member"}
              </h3>
              <button 
                onClick={() => setIsAddOpen(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-50 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleAddMember} className="p-4 space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-700">
                  {isRtl ? "اسم المندوب كاملاً *" : "Representative Full Name *"}
                </label>
                <input
                  type="text"
                  required
                  value={newMemberName}
                  onChange={(e) => setNewMemberName(e.target.value)}
                  placeholder="e.g. Omar Al-Fares"
                  className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-700">
                  {isRtl ? "الدور والمسؤولية" : "Role / Responsibility"}
                </label>
                <select
                  value={newMemberRole}
                  onChange={(e) => setNewMemberRole(e.target.value)}
                  className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                >
                  <option value="Medical Representative">{isRtl ? "مندوب طبي" : "Medical Representative"}</option>
                  <option value="Sales Representative">{isRtl ? "مندوب مبيعات" : "Sales Representative"}</option>
                  <option value="Medical Supervisor">{isRtl ? "مشرف طبي" : "Medical Supervisor"}</option>
                  <option value="Sales Supervisor">{isRtl ? "مشرف مبيعات" : "Sales Supervisor"}</option>
                  <option value="Order Operations Officer">{isRtl ? "مسؤول عمليات الطلبات" : "Order Operations Officer"}</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-700">
                  {isRtl ? "نطاق العمل / الإقليم الجغرافي" : "Assigned Regional Hub / Territory"}
                </label>
                <input
                  type="text"
                  value={newMemberHub}
                  onChange={(e) => setNewMemberHub(e.target.value)}
                  placeholder="e.g. Tripoli Central West"
                  className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-700">
                  {isRtl ? "البريد الإلكتروني" : "Email Address"}
                </label>
                <input
                  type="email"
                  value={newMemberEmail}
                  onChange={(e) => setNewMemberEmail(e.target.value)}
                  placeholder="e.g. omar@esand.com"
                  className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsAddOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  {isRtl ? "إلغاء" : "Cancel"}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 shadow-sm"
                >
                  {isRtl ? "إضافة" : "Add Member"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
