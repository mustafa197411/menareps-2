import React, { useState, useEffect, useMemo, useRef } from "react";
import { Search, X, Plus, Check, Sparkles, Loader2, AlertCircle } from "lucide-react";
import { useSpecialties, registerNewSpecialty } from "../utils/specialtyService";
import { Role, PhysicianSpecialty, AuditLog } from "../types";
import { db } from "../lib/firebase";
import { collection, doc, setDoc } from "firebase/firestore";
import { saveAuditLogRecord } from "../lib/firestoreService";

export interface PhysicianSpecialtySelectorProps {
  multiple?: boolean;
  value?: string | string[]; // Selected ID(s) or name(s)
  valueType?: "id" | "name"; // Whether value corresponds to specialty ID or English name
  onChange: (value: any) => void;
  lang?: "en" | "ar";
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  allowRegistration?: boolean;
  currentUser?: any;
  className?: string;
}

export default function PhysicianSpecialtySelector({
  multiple = false,
  value,
  valueType = "id",
  onChange,
  lang = "en",
  disabled = false,
  required = false,
  placeholder,
  allowRegistration = false,
  currentUser,
  className = ""
}: PhysicianSpecialtySelectorProps) {
  const isRtl = lang === "ar";
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  // States
  const { specialties: specialtiesList, loading: isSpecialtiesLoading, status: specialtiesStatus } = useSpecialties();
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  
  // Inline Registration States
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSpecNameEn, setNewSpecNameEn] = useState("");
  const [newSpecNameAr, setNewSpecNameAr] = useState("");
  const [registrationError, setRegistrationError] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setShowAddForm(false);
        setSearchQuery("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Check authorization for inline registration
  const canRegister = useMemo(() => {
    if (!allowRegistration || !currentUser) return false;
    const r = currentUser.role;
    return (
      r === Role.SUPER_ADMIN ||
      r === Role.ADMIN ||
      r === Role.MEDICAL_MANAGER ||
      r === Role.PRODUCT_MANAGER ||
      r === Role.SYSTEM_ADMINISTRATOR
    );
  }, [allowRegistration, currentUser]);

  // Normalize selected value into a string array of IDs or Names
  const selectedValues = useMemo<string[]>(() => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    return [value];
  }, [value]);

  // Helper to check if a specialty is selected
  const isSelected = (spec: PhysicianSpecialty) => {
    const valToCompare = valueType === "name" ? spec.name : spec.id;
    return selectedValues.includes(valToCompare);
  };

  // Filter specialties based on search text and active vs inactive rules
  const filteredSpecialties = useMemo(() => {
    return specialtiesList.filter(spec => {
      // 1. Search filter
      const matchesSearch = !searchQuery ? true : (
        spec.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (spec.nameAr && spec.nameAr.toLowerCase().includes(searchQuery.toLowerCase())) ||
        spec.normalizedName.toLowerCase().includes(searchQuery.toLowerCase())
      );
      
      if (!matchesSearch) return false;

      // 2. Inactive rules: only show if active OR already selected (for history support)
      if (spec.isActive !== false) return true;
      return isSelected(spec);
    });
  }, [specialtiesList, searchQuery, selectedValues, valueType]);

  // Log Audit Helper (mimicking standard CRM logs)
  const logAudit = async (action: string, details: string) => {
    try {
      const logId = "log_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
      const auditRecord: AuditLog = {
        id: logId,
        timestamp: new Date().toISOString(),
        userId: currentUser?.id || "system",
        userName: currentUser?.name || "System",
        userRole: currentUser?.role || "System",
        action,
        entityType: "PhysicianSpecialty",
        entityName: "Specialties",
        details
      };
      await saveAuditLogRecord(auditRecord);
    } catch (e) {
      console.warn("Audit logging failed in Specialty Selector:", e);
    }
  };

  // Handle specialty click (toggle or select)
  const handleSelect = (spec: PhysicianSpecialty) => {
    const selectedVal = valueType === "name" ? spec.name : spec.id;
    
    if (multiple) {
      if (selectedValues.includes(selectedVal)) {
        onChange(selectedValues.filter(v => v !== selectedVal));
      } else {
        onChange([...selectedValues, selectedVal]);
      }
    } else {
      onChange(selectedVal);
      setIsOpen(false);
      setSearchQuery("");
    }
  };

  // Remove a pill/value directly
  const handleRemove = (selectedVal: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (multiple) {
      onChange(selectedValues.filter(v => v !== selectedVal));
    } else {
      onChange("");
    }
  };

  // Register new specialty inline
  const handleRegisterInline = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegistrationError("");
    const trimmedEn = newSpecNameEn.trim();
    const trimmedAr = newSpecNameAr.trim();

    if (!trimmedEn) {
      setRegistrationError(isRtl ? "الاسم الإنجليزي مطلوب" : "English name is required");
      return;
    }

    setIsRegistering(true);
    try {
      const result = await registerNewSpecialty(trimmedEn, trimmedAr, [], currentUser?.id || "system");
      if (result.success && result.specialty) {
        // Automatically select newly registered specialty
        const valToSelect = valueType === "name" ? result.specialty.name : result.specialty.id;
        if (multiple) {
          onChange([...selectedValues, valToSelect]);
        } else {
          onChange(valToSelect);
        }
        
        // Reset and close register form
        setNewSpecNameEn("");
        setNewSpecNameAr("");
        setShowAddForm(false);
        setIsOpen(false);
        logAudit("Create Specialty Inline", `Registered new specialty: ${trimmedEn}`);
      } else {
        setRegistrationError(result.error || (isRtl ? "فشل التسجيل" : "Registration failed"));
      }
    } catch (err: any) {
      setRegistrationError(err.message || String(err));
    } finally {
      setIsRegistering(false);
    }
  };

  // Find object by value
  const getSelectedObjects = useMemo(() => {
    return selectedValues.map(val => {
      return specialtiesList.find(s => {
        return valueType === "name" ? s.name === val : s.id === val;
      }) || { id: val, name: val, isActive: true };
    });
  }, [selectedValues, specialtiesList, valueType]);

  const defaultPlaceholder = multiple 
    ? (isRtl ? "اختر التخصصات المستهدفة..." : "Select target specialties...")
    : (isRtl ? "اختر التخصص الطبي..." : "Select medical specialty...");

  return (
    <div className={`relative ${className}`} ref={dropdownRef} dir={isRtl ? "rtl" : "ltr"}>
      {/* Selector Trigger Area */}
      <div 
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={`w-full min-h-[38px] p-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl flex flex-wrap gap-1.5 items-center justify-between cursor-pointer transition-all focus-within:ring-1 focus-within:ring-indigo-500 ${
          disabled ? "opacity-60 cursor-not-allowed bg-slate-50 dark:bg-slate-900" : "hover:border-slate-300 dark:hover:border-slate-700"
        }`}
      >
        <div className="flex flex-wrap gap-1.5 items-center flex-1">
          {getSelectedObjects.length === 0 ? (
            <span className="text-xs text-slate-400 font-medium px-1">
              {placeholder || defaultPlaceholder}
            </span>
          ) : (
            getSelectedObjects.map((spec: any) => (
              <span
                key={spec.id}
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-xxs font-semibold border transition-colors ${
                  spec.isActive === false
                    ? "bg-slate-100 dark:bg-slate-850 text-slate-500 border-slate-200 dark:border-slate-800"
                    : "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-100 dark:border-indigo-900/30"
                }`}
              >
                {isRtl ? (spec.nameAr || spec.name) : spec.name}
                {spec.isActive === false && (
                  <span className="text-[9px] opacity-75 font-normal">({isRtl ? "غير نشط" : "Inactive"})</span>
                )}
                {!disabled && (
                  <button
                    type="button"
                    onClick={(e) => handleRemove(valueType === "name" ? spec.name : spec.id, e)}
                    className="text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-200 transition-colors"
                  >
                    <X size={10} />
                  </button>
                )}
              </span>
            ))
          )}
        </div>
        
        {/* Dropdown Indicator */}
        <div className="text-slate-400 px-1">
          <svg className={`h-4 w-4 transform transition-transform ${isOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* Required Hidden Input for Form Submission validation */}
      {required && selectedValues.length === 0 && (
        <input tabIndex={-1} className="absolute opacity-0 pointer-events-none w-1 h-1" required />
      )}

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl p-1.5 space-y-1.5 max-h-72 flex flex-col">
          {/* Search bar inside dropdown */}
          {!showAddForm && (
            <div className="relative flex-none">
              <span className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-slate-400">
                <Search size={12} />
              </span>
              <input
                type="text"
                placeholder={isRtl ? "البحث عن تخصص..." : "Search specialty..."}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-150 dark:border-slate-800 rounded-lg py-1.5 pl-8 pr-4 text-xs focus:ring-1 focus:ring-indigo-500 outline-none font-medium"
                autoFocus
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute inset-y-0 right-3 flex items-center text-slate-400 hover:text-slate-600"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          )}

          {/* Specialty List Scrollable container */}
          {!showAddForm ? (
            <div className="overflow-y-auto flex-1 max-h-48 space-y-0.5 p-0.5">
              {isSpecialtiesLoading ? (
                <div className="flex items-center justify-center py-6 text-xxs text-slate-400 gap-1.5">
                  <Loader2 size={12} className="animate-spin text-indigo-500" />
                  <span>{isRtl ? "جاري تحميل التخصصات..." : "Loading specialties..."}</span>
                </div>
              ) : filteredSpecialties.length === 0 ? (
                <div className="py-6 text-center text-xxs text-slate-400 space-y-2">
                  <p>{isRtl ? "لا توجد نتائج مطابقة" : "No matching specialties found."}</p>
                  {canRegister && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddForm(true);
                        setNewSpecNameEn(searchQuery);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold shadow-xs transition-colors cursor-pointer"
                    >
                      <Plus size={11} />
                      {isRtl ? "تسجيل تخصص جديد" : "Register New Specialty"}
                    </button>
                  )}
                </div>
              ) : (
                filteredSpecialties.map(spec => {
                  const checked = isSelected(spec);
                  return (
                    <button
                      key={spec.id}
                      type="button"
                      onClick={() => handleSelect(spec)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left text-xs transition-colors cursor-pointer ${
                        checked
                          ? "bg-indigo-50/50 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-300 font-semibold"
                          : "text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {multiple && (
                          <input
                            type="checkbox"
                            checked={checked}
                            readOnly
                            className="h-3.5 w-3.5 text-indigo-600 focus:ring-indigo-500 border-slate-300 dark:border-slate-800 rounded cursor-pointer"
                          />
                        )}
                        <span className="truncate">
                          {isRtl ? (spec.nameAr || spec.name) : spec.name}
                        </span>
                        {spec.isActive === false && (
                          <span className="text-[9px] bg-slate-100 dark:bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded">
                            {isRtl ? "غير نشط" : "Inactive"}
                          </span>
                        )}
                      </div>
                      {checked && !multiple && <Check size={12} className="text-indigo-600" />}
                    </button>
                  );
                })
              )}
            </div>
          ) : (
            /* Inline Add Form */
            <form onSubmit={handleRegisterInline} className="p-3 bg-slate-50 dark:bg-slate-900/40 border border-slate-150 dark:border-slate-850 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xxs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                  <Sparkles size={11} className="text-indigo-500" />
                  {isRtl ? "تسجيل تخصص جديد" : "Register New Specialty"}
                </span>
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="p-1 text-slate-400 hover:text-slate-600"
                >
                  <X size={12} />
                </button>
              </div>

              {registrationError && (
                <div className="p-2 bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/40 text-rose-600 dark:text-rose-400 text-xxs rounded-lg flex items-center gap-1.5">
                  <AlertCircle size={12} />
                  <span className="truncate">{registrationError}</span>
                </div>
              )}

              <div className="space-y-2">
                <div className="space-y-0.5">
                  <label className="text-[10px] font-semibold text-slate-500">
                    {isRtl ? "الاسم بالإنجليزي *" : "English Name *"}
                  </label>
                  <input
                    type="text"
                    required
                    value={newSpecNameEn}
                    onChange={(e) => setNewSpecNameEn(e.target.value)}
                    placeholder="e.g. Immunology"
                    className="w-full text-xs p-2 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 focus:ring-1 focus:ring-indigo-500 outline-none"
                  />
                </div>

                <div className="space-y-0.5">
                  <label className="text-[10px] font-semibold text-slate-500">
                    {isRtl ? "الاسم بالعربي" : "Arabic Name"}
                  </label>
                  <input
                    type="text"
                    value={newSpecNameAr}
                    onChange={(e) => setNewSpecNameAr(e.target.value)}
                    placeholder="مثال: علم المناعة"
                    className="w-full text-xs p-2 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 focus:ring-1 focus:ring-indigo-500 outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-3 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xxs text-slate-600 hover:bg-slate-50 dark:hover:bg-slate-900 font-medium cursor-pointer"
                >
                  {isRtl ? "إلغاء" : "Cancel"}
                </button>
                <button
                  type="submit"
                  disabled={isRegistering}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xxs font-bold shadow-xs transition-colors flex items-center gap-1 cursor-pointer"
                >
                  {isRegistering ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <Plus size={11} />
                  )}
                  {isRtl ? "تسجيل" : "Register"}
                </button>
              </div>
            </form>
          )}

          {/* Quick-add trigger when list is showing but we want shortcut */}
          {!showAddForm && canRegister && (
            <div className="pt-1.5 border-t border-slate-100 dark:border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => setShowAddForm(true)}
                className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold hover:underline flex items-center gap-0.5 px-1 py-0.5"
              >
                <Plus size={10} />
                {isRtl ? "إضافة تخصص جديد" : "Add New Specialty"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
