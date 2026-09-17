import React, { useState, useEffect, useMemo, useRef } from "react";
import { 
  UserPlus, 
  MapPin, 
  ChevronLeft, 
  Check, 
  AlertCircle,
  Sparkles,
  Award,
  BookOpen,
  ArrowLeft,
  Info
} from "lucide-react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { useSpecialties } from "../../utils/specialtyService";
import PhysicianSpecialtySelector from "../PhysicianSpecialtySelector";
import { Role } from "../../types";

interface AddPhysicianFormProps {
  lang: "en" | "ar";
  currentUser?: any;
  onNavigate?: (target: string) => void;
  onAddPhysician?: (physician: any) => Promise<void>;
}

export default function AddPhysicianForm({ lang, currentUser, onNavigate, onAddPhysician }: AddPhysicianFormProps) {
  const createMutationKeyRef = useRef(crypto.randomUUID());
  const isRtl = lang === "ar";

  // Form states
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [classification, setClassification] = useState("B");
  const [region, setRegion] = useState("West");
  const [territory, setTerritory] = useState("");
  const [address, setAddress] = useState("");

  // Dynamic state from Firestore
  const { specialties: specialtiesList, status: specialtiesStatus, errorMessage: specialtiesErrorMessage } = useSpecialties();
  const [promotionGroups, setPromotionGroups] = useState<any[]>([]);
  const [productsList, setProductsList] = useState<any[]>([]);

  // Promotion Group focus selections
  const [primaryGroup, setPrimaryGroup] = useState<any | null>(null);
  const [targetGroups, setTargetGroups] = useState<any[]>([]);
  
  // UI States
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (specialtiesList.length > 0 && !specialty) {
      setSpecialty(specialtiesList[0].name);
    }
  }, [specialtiesList, specialty]);

  useEffect(() => {
    const unsubGroups = onSnapshot(collection(db, "productPromotionGroups"), (snap) => {
      setPromotionGroups(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)).filter(g => g.isActive !== false));
    });

    const unsubProducts = onSnapshot(collection(db, "products"), (snap) => {
      setProductsList(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
    });

    return () => {
      unsubGroups();
      unsubProducts();
    };
  }, []);

  const hasActiveProductsWarning = useMemo(() => {
    if (!primaryGroup) return false;
    const hasActive = productsList.some(p => 
      p.isActive !== false && 
      (p.promotionGroupId === primaryGroup.id || 
       p.brand?.toLowerCase() === primaryGroup.name?.toLowerCase() ||
       p.promotionGroupName?.toLowerCase() === primaryGroup.name?.toLowerCase())
    );
    return !hasActive;
  }, [primaryGroup, productsList]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!name.trim() || !territory.trim() || !address.trim() || !primaryGroup) {
      setError(isRtl 
        ? "يرجى ملء جميع الحقول الإلزامية واختيار مجموعة ترويجية رئيسية." 
        : "Please fill in all mandatory fields and select a Primary Promotion Group.");
      return;
    }

    setIsSubmitting(true);

    try {
      const matchedSpec = specialtiesList.find(s => s.name === specialty || s.id === specialty);
      const newPhysician = {
        id: `PHY-${Math.floor(100 + Math.random() * 900)}`,
        name,
        nameAr: nameAr || name,
        specialty: matchedSpec ? matchedSpec.name : specialty,
        specialtyId: matchedSpec ? matchedSpec.id : undefined,
        specialtyName: matchedSpec ? matchedSpec.name : undefined,
        classification,
        region,
        territory,
        address,
        latitude: null,
        longitude: null,
        gpsVerified: false,
        gpsVerificationStatus: "UNVERIFIED",
        gpsVerifiedAt: undefined,
        gpsVerifiedBy: undefined,
        firstVerifiedVisitId: null,
        lastVisitDate: "-",
        primaryPromotionGroupId: primaryGroup.id,
        primaryPromotionGroupName: primaryGroup.name,
        targetPromotionGroupIds: targetGroups.length > 0 ? targetGroups.map(g => g.id) : undefined,
        targetPromotionGroupNames: targetGroups.length > 0 ? targetGroups.map(g => g.name) : undefined,
        primaryBrand: primaryGroup.name,
        targetBrands: targetGroups.length > 0 ? targetGroups.map(g => g.name) : undefined,
        assignedRepId: currentUser?.id || undefined,
        creationIdempotencyKey: createMutationKeyRef.current,
      };

      if (onAddPhysician) {
        await onAddPhysician(newPhysician);
      }

      setSuccess(true);
      
      // Reset form
      setName("");
      setNameAr("");
      setTerritory("");
      setAddress("");
      setPrimaryGroup(null);
      setTargetGroups([]);
      createMutationKeyRef.current = crypto.randomUUID();
    } catch (saveError: any) {
      setError(saveError?.message || (isRtl
        ? "تعذر حفظ الطبيب. تم الاحتفاظ بالبيانات المدخلة."
        : "The physician could not be saved. Your entered data has been preserved."));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      {/* Header and Back navigation */}
      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => onNavigate && onNavigate("field-physician-list")}
            className="p-2 rounded-xl border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer text-slate-500"
          >
            <ArrowLeft size={16} className={isRtl ? "rotate-180" : ""} />
          </button>
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              {isRtl ? "تسجيل طبيب جديد" : "Onboard New Physician SKU"}
            </h2>
            <p className="text-xxs text-slate-400">
              {isRtl ? "إضافة طبيب جديد لشبكة التغطية وإسناده للمناطق والتصنيفات" : "Onboard clinic profiles, physical details, and key classifications."}
            </p>
          </div>
        </div>

        <button 
          onClick={() => onNavigate && onNavigate("field-physician-list")}
          className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
        >
          {isRtl ? "عرض القائمة كاملة" : "View Roster List"}
        </button>
      </div>

      {success ? (
        <div className="bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 p-8 rounded-2xl text-center space-y-4 animate-fade-in">
          <div className="mx-auto h-12 w-12 rounded-full bg-emerald-100 dark:bg-emerald-950/80 flex items-center justify-center text-emerald-600">
            <Check size={24} />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {isRtl ? "تم تسجيل الطبيب بنجاح!" : "Physician Registered Successfully!"}
            </h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              {isRtl 
                ? "تمت إضافة الطبيب بنجاح إلى قاعدة بيانات التغطية الميدانية، ويمكن للمندوبين الآن جدولة زياراتهم الطبية."
                : "The physician has been securely registered in the system and is now ready for active detailing scheduling."
              }
            </p>
          </div>
          <div className="flex justify-center gap-3 pt-4">
            <button
              onClick={() => setSuccess(false)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
            >
              {isRtl ? "إضافة طبيب آخر" : "Add Another"}
            </button>
            <button
              onClick={() => onNavigate && onNavigate("field-physician-list")}
              className="px-4 py-2 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 text-slate-600 text-xs font-bold rounded-xl transition-colors cursor-pointer"
            >
              {isRtl ? "الذهاب للقائمة" : "Go to Directory"}
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-6 shadow-xxs space-y-6">
          {error && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/40 text-rose-600 dark:text-rose-400 text-xs rounded-xl flex items-center gap-2">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {/* Core Info */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles size={13} className="text-indigo-500" />
              {isRtl ? "المعلومات الأساسية" : "Identity Parameters"}
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xxs font-semibold text-slate-500 dark:text-slate-400">
                  {isRtl ? "الاسم بالكامل (إنجليزي) *" : "Physician Full Name (EN) *"}
                </label>
                <input 
                  type="text" 
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Dr. Abdul Bari Al Manifi"
                  className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent focus:ring-1 focus:ring-indigo-500"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-xxs font-semibold text-slate-500 dark:text-slate-400">
                  {isRtl ? "الاسم بالكامل (عربي)" : "Physician Full Name (AR)"}
                </label>
                <input 
                  type="text" 
                  value={nameAr}
                  onChange={(e) => setNameAr(e.target.value)}
                  placeholder="مثال: د. عبد الباري المنفي"
                  className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xxs font-semibold text-slate-500 dark:text-slate-400">
                  {isRtl ? "التخصص الطبي *" : "Medical Specialty *"}
                </label>
                {specialtiesStatus === "permission-denied" && (
                  <p className="text-[10px] text-red-500 font-semibold mb-1 animate-pulse">
                    {isRtl ? "⚠️ فشل الوصول إلى قائمة التخصصات (تم رفض الإذن)" : "⚠️ Access denied to physicianSpecialties (Permission Denied)"}
                  </p>
                )}
                {specialtiesStatus === "empty" && (
                  <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/40 mb-1.5 space-y-1.5">
                    <p className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold animate-pulse">
                      {isRtl ? "⚠️ قائمة التخصصات فارغة. يرجى تهيئتها أولاً." : "⚠️ Specialty registry is empty. Please contact your admin."}
                    </p>
                    {(currentUser?.role === Role.SUPER_ADMIN || currentUser?.role === Role.ADMIN || currentUser?.role === Role.SYSTEM_ADMINISTRATOR || currentUser?.role === Role.MEDICAL_MANAGER) && onNavigate && (
                      <button
                        type="button"
                        onClick={() => onNavigate("master-specialties")}
                        className="px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white text-[9px] font-bold rounded-md shadow-xs cursor-pointer transition-colors"
                      >
                        {isRtl ? "الذهاب لتهيئة تخصصات الأطباء ↗" : "Go to Physician Specialties Admin Page ↗"}
                      </button>
                    )}
                  </div>
                )}
                <PhysicianSpecialtySelector
                  value={specialty}
                  valueType="name"
                  onChange={(val) => setSpecialty(val as string)}
                  lang={lang}
                  currentUser={currentUser}
                  allowRegistration={true}
                  required={true}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xxs font-semibold text-slate-500 dark:text-slate-400">
                  {isRtl ? "تصنيف الطبيب الميداني *" : "Target Classification (KPI) *"}
                </label>
                <select 
                  value={classification}
                  onChange={(e) => setClassification(e.target.value)}
                  className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="A">{isRtl ? "تصنيف (A) - تكرار زيارات عالي" : "Class A (Highest Core Priority)"}</option>
                  <option value="B">{isRtl ? "تصنيف (B) - تكرار زيارات متوسط" : "Class B (Moderate/Standard Target)"}</option>
                  <option value="C">{isRtl ? "تصنيف (C) - تكرار منخفض" : "Class C (Low/Reactive Targeting)"}</option>
                </select>
              </div>
            </div>
          </div>

          {/* Promotion Group Selection */}
          <div className="space-y-4 pt-4 border-t border-slate-50 dark:border-slate-800/50">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <BookOpen size={13} className="text-indigo-500" />
              {isRtl ? "المجموعات الترويجية والمنتجات" : "Product Promotion Groups Selection"}
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xxs font-semibold text-slate-500 dark:text-slate-400 block">
                  {isRtl ? "المجموعة الترويجية الرئيسية *" : "Primary Promotion Group Focus *"}
                </label>
                <select 
                  value={primaryGroup ? primaryGroup.id : ""}
                  onChange={(e) => {
                    const pg = promotionGroups.find(g => g.id === e.target.value);
                    setPrimaryGroup(pg || null);
                  }}
                  className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent focus:ring-1 focus:ring-indigo-500"
                  required
                >
                  <option value="">{isRtl ? "اختر المجموعة الرئيسية..." : "Select Primary Group Focus..."}</option>
                  {promotionGroups.map(g => (
                    <option key={g.id} value={g.id}>{g.name} {g.nameAr ? `(${g.nameAr})` : ""}</option>
                  ))}
                </select>
                {hasActiveProductsWarning && (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold mt-1 animate-pulse">
                    Warning: Selected Primary Promotion Group has no active products. Complete product catalog setup before assigning representatives.
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xxs font-semibold text-slate-500 dark:text-slate-400 block">
                  {isRtl ? "المجموعات الترويجية المستهدفة" : "Target Promotion Groups (Optional)"}
                </label>
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 max-h-32 overflow-y-auto space-y-1.5 bg-transparent text-xs">
                  {promotionGroups.length === 0 ? (
                    <p className="text-xxs text-slate-400 italic">{isRtl ? "لا توجد مجموعات" : "No promotion groups configured."}</p>
                  ) : (
                    promotionGroups.filter(g => g.id !== primaryGroup?.id).map(g => {
                      const isChecked = targetGroups.some(tg => tg.id === g.id);
                      return (
                        <label key={g.id} className="flex items-center gap-2 cursor-pointer font-medium text-slate-700 dark:text-slate-300">
                          <input 
                            type="checkbox" 
                            checked={isChecked}
                            onChange={() => {
                              if (isChecked) {
                                setTargetGroups(targetGroups.filter(tg => tg.id !== g.id));
                              } else {
                                setTargetGroups([...targetGroups, g]);
                              }
                            }}
                            className="rounded text-indigo-600 focus:ring-indigo-500"
                          />
                          <span>{g.name} {g.nameAr ? `(${g.nameAr})` : ""}</span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Territory & Region */}
          <div className="space-y-4 pt-4 border-t border-slate-50 dark:border-slate-800/50">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Award size={13} className="text-indigo-500" />
              {isRtl ? "تحديد الإقليم والمنطقة" : "Territory and Regional Demographics"}
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xxs font-semibold text-slate-500 dark:text-slate-400">
                  {isRtl ? "الإقليم الجغرافي *" : "Operational Region *"}
                </label>
                <select 
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="West">{isRtl ? "المنطقة الغربية (طرابلس وضواحيها)" : "West Region (Tripoli & Surrounding)"}</option>
                  <option value="East">{isRtl ? "المنطقة الشرقية (بنغازي وضواحيها)" : "East Region (Benghazi & Surrounding)"}</option>
                  <option value="South">{isRtl ? "المنطقة الجنوبية (سبها وضواحيها)" : "South Region (Sabha & Fezzan)"}</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xxs font-semibold text-slate-500 dark:text-slate-400">
                  {isRtl ? "اسم المنطقة الجغرافية (المربع الميداني) *" : "Assigned Field Territory *"}
                </label>
                <input 
                  type="text" 
                  value={territory}
                  onChange={(e) => setTerritory(e.target.value)}
                  placeholder="e.g. Venecia Benghazi West zone"
                  className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent focus:ring-1 focus:ring-indigo-500"
                  required
                />
              </div>
            </div>
          </div>

          {/* Address and GPS Coordinates */}
          <div className="space-y-4 pt-4 border-t border-slate-50 dark:border-slate-800/50">
            <div className="flex justify-between items-center">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <MapPin size={13} className="text-indigo-500" />
                {isRtl ? "العنوان والموقع الجغرافي" : "Clinic Address & Geotag Verification"}
              </h3>
            </div>

            <div className="space-y-1">
              <label className="text-xxs font-semibold text-slate-500 dark:text-slate-400">
                {isRtl ? "عنوان العيادة أو المستشفى *" : "Clinical Facility Address *"}
              </label>
              <input 
                type="text" 
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="e.g. H2O CLINIC / AL-MAA AL-SHAFI"
                className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent focus:ring-1 focus:ring-indigo-500"
                required
              />
            </div>

            <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 rounded-xl text-xs text-blue-700 dark:text-blue-300 flex items-start gap-2">
              <Info className="w-4 h-4 shrink-0 mt-0.5 text-blue-500" />
              <span>
                {isRtl
                  ? "لم يتم التحقق من الموقع بعد. ستحدد أول زيارة ميدانية الموقع الجغرافي المعتمد للعميل."
                  : "Location not yet verified. The first field visit will establish the customer’s global GPS location."}
              </span>
            </div>
          </div>

          {/* Form Actions */}
          <div className="pt-4 border-t border-slate-50 dark:border-slate-800/50 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => onNavigate && onNavigate("field-physician-list")}
              className="px-4 py-2 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
            >
              {isRtl ? "إلغاء" : "Cancel"}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition-all cursor-pointer shadow-md inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <div className="h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>{isRtl ? "جاري التسجيل..." : "Registering..."}</span>
                </>
              ) : (
                <>
                  <UserPlus size={15} />
                  <span>{isRtl ? "إتمام التسجيل" : "Onboard Physician"}</span>
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
