import React, { useState, useEffect, useMemo } from "react";
import { 
  CheckCircle, 
  XCircle, 
  Clock, 
  Sliders, 
  HelpCircle, 
  User, 
  DollarSign, 
  FileCheck2, 
  AlertTriangle,
  FileCheck,
  ShieldCheck,
  Plus,
  X,
  AlertCircle
} from "lucide-react";
import { collection, onSnapshot, doc, setDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { decorateRecord } from "../../lib/firebaseSync";
import { PhysicianSpecialty, AuditLog } from "../../types";
import { saveAuditLogRecord } from "../../lib/firestoreService";
import { useSpecialties } from "../../utils/specialtyService";
import PhysicianSpecialtySelector from "../PhysicianSpecialtySelector";

interface MarketingApprovalsProps {
  currentUser: any;
  lang: "en" | "ar";
}

interface Sponsorship {
  id: string;
  doctorName: string;
  doctorNameAr: string;
  specialty: string;
  specialtyAr: string;
  eventTitle: string;
  eventTitleAr: string;
  sponsorshipType: "Registration Fee" | "Travel & Lodging" | "Speaker Honorarium";
  sponsorshipTypeAr: string;
  amount: number;
  status: "Pending" | "Approved" | "Declined";
  dateFiled: string;
}

export default function MarketingApprovals({ currentUser, lang }: MarketingApprovalsProps) {
  const isRtl = lang === "ar";
  const [sponsorships, setSponsorships] = useState<Sponsorship[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState("");
  const { specialties: specialtiesList } = useSpecialties();

  // Add Sponsorship Form State
  const [docName, setDocName] = useState("");
  const [docNameAr, setDocNameAr] = useState("");
  const [specialty, setSpecialty] = useState("Cardiology");
  const [eventTitle, setEventTitle] = useState("");
  const [eventTitleAr, setEventTitleAr] = useState("");
  const [sType, setSType] = useState<"Registration Fee" | "Travel & Lodging" | "Speaker Honorarium">("Registration Fee");
  const [amountVal, setAmountVal] = useState("");

  // 1. Listen for real-time KOL sponsorships
  useEffect(() => {
    const unsubSponsorships = onSnapshot(collection(db, "kolSponsorships"), (snapshot) => {
      const list: Sponsorship[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        if (!data.isDeleted) {
          list.push({ id: doc.id, ...data } as Sponsorship);
        }
      });
      setSponsorships(list);
    }, (err) => {
      console.warn("[MarketingApprovals] Firestore subscription failed:", err);
    });

    return () => {
      unsubSponsorships();
    };
  }, []);

  // 2. Audit log helper
  const logAudit = async (action: string, details: string) => {
    const logId = `AL-${Math.floor(1000 + Math.random() * 9000)}`;
    const auditRecord: AuditLog = {
      id: logId,
      timestamp: new Date().toISOString().replace("T", " ").substring(0, 19) + " UTC",
      userId: currentUser?.id || "unknown",
      userName: currentUser?.name || "Anonymous",
      userRole: currentUser?.role,
      action,
      entityType: "MarketingApproval",
      entityName: "KOL Sponsorships",
      details
    };

    try {
      await saveAuditLogRecord(auditRecord);
    } catch (e) {
      console.error("Audit log failed:", e);
    }
  };

  const handleApprove = async (id: string, name: string) => {
    try {
      await setDoc(doc(db, "kolSponsorships", id), { status: "Approved" }, { merge: true });
      await logAudit("Approve", `Approved academic sponsorship proposal ${id} for clinician: ${name}`);
    } catch (e) {
      console.error(e);
    }
  };

  const handleDecline = async (id: string, name: string) => {
    try {
      await setDoc(doc(db, "kolSponsorships", id), { status: "Declined" }, { merge: true });
      await logAudit("Decline", `Declined academic sponsorship proposal ${id} for clinician: ${name}`);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSubmitProposal = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!docName.trim() || !eventTitle.trim() || !amountVal.trim()) {
      setFormError(isRtl ? "يرجى تعبئة الحقول الأساسية المطلوبة." : "Please fill in all mandatory core fields.");
      return;
    }

    const spoId = `SPO-${Math.floor(300 + Math.random() * 699)}`;
    const payload = {
      id: spoId,
      doctorName: docName,
      doctorNameAr: docNameAr || docName,
      specialty,
      specialtyAr: specialty === "Cardiology" ? "أمراض القلب" : specialty === "Pediatrics" ? "طب الأطفال" : "جراحة العظام",
      eventTitle,
      eventTitleAr: eventTitleAr || eventTitle,
      sponsorshipType: sType,
      sponsorshipTypeAr: sType === "Registration Fee" ? "رسوم التسجيل" : sType === "Travel & Lodging" ? "السفر والإقامة" : "مكافأة متحدث",
      amount: parseFloat(amountVal) || 200,
      status: "Pending",
      dateFiled: new Date().toISOString().split("T")[0],
      isDeleted: false
    };

    const decorated = decorateRecord(payload, currentUser?.id || "system", "create");

    try {
      await setDoc(doc(db, "kolSponsorships", spoId), decorated);
      setShowForm(false);
      await logAudit("Create", `Filed new KOL scientific sponsorship proposal for ${docName}: $${amountVal}`);
      
      // Reset form
      setDocName("");
      setDocNameAr("");
      setEventTitle("");
      setEventTitleAr("");
      setAmountVal("");
    } catch (err) {
      console.error(err);
      setFormError(isRtl ? "فشل الاتصال بقاعدة البيانات." : "Failed to record the proposal in Firestore.");
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      
      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-950 flex items-center justify-center text-violet-600 dark:text-violet-400">
              <ShieldCheck size={22} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                {isRtl ? "إقرار رعاية الأطباء والامتثال" : "Sponsorship Audits & Compliance"}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {isRtl ? "مراجعة وتدقيق طلبات تمويل حضور المؤتمرات الطبية للأطباء الكبار ومكافآت المحاضرين" : "Verify clinical roundtable funding, medical congress registration, and flight/lodging sponsorships."}
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={() => {
            setFormError("");
            setShowForm(!showForm);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[10px] rounded-xl shadow-sm transition-colors cursor-pointer self-start sm:self-center"
        >
          {showForm ? <X size={12} /> : <Plus size={12} />}
          <span>{showForm ? (isRtl ? "إلغاء التقديم" : "Cancel Proposal") : (isRtl ? "تقديم طلب رعاية علمية" : "File Sponsorship Request")}</span>
        </button>
      </div>

      {/* Compliance Guidelines warning box */}
      <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200/80 p-4 rounded-2xl flex items-start gap-3.5 text-xs text-amber-800 dark:text-amber-400">
        <AlertTriangle size={18} className="shrink-0 text-amber-500 mt-0.5" />
        <div className="space-y-1 leading-relaxed">
          <strong className="font-bold block">{isRtl ? "لوائح الرقابة والامتثال الدولية (IFPMA / PhRMA):" : "International Code of Marketing Practices Compliance (IFPMA / PhRMA):"}</strong>
          <span>
            {isRtl 
              ? "يمنع تقديم مبالغ نقدية أو هدايا عينية ترفيهية للأطباء بصورة مستقلة. يجب أن تكون أي رعاية مبررة علمياً لحضور مؤتمر معتمد، مع وجود توقيع رسمي وخطاب قبول من اللجنة المنظمة للمؤتمر."
              : "Direct cash awards, personal gifts, or entertainment allowances are strictly forbidden. Sponsorship is restricted exclusively to recognized medical educational conventions and academic panels, verified by invitation letters."
            }
          </span>
        </div>
      </div>

      {/* Submit Form collapse */}
      {showForm && (
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-5 rounded-2xl shadow-xs space-y-4">
          <div className="border-b pb-2">
            <h3 className="text-xs font-bold text-slate-900 dark:text-white">{isRtl ? "تفاصيل اقتراح رعاية الطبيب العلمية" : "Clinician Academic Sponsorship Proposal"}</h3>
          </div>

          {formError && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/20 text-rose-600 rounded-xl text-xxs flex items-center gap-2">
              <AlertCircle size={14} />
              <span>{formError}</span>
            </div>
          )}

          <form onSubmit={handleSubmitProposal} className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">{isRtl ? "اسم الطبيب المستهدف (EN) *" : "Physician Name (EN) *"}</label>
              <input 
                type="text"
                value={docName}
                onChange={(e) => setDocName(e.target.value)}
                placeholder="e.g. Dr. Salem Al-Hadi"
                className="w-full bg-slate-50 dark:bg-slate-800/40 rounded-xl p-2.5"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">{isRtl ? "اسم الطبيب بالعربية" : "Physician Name (Arabic)"}</label>
              <input 
                type="text"
                value={docNameAr}
                onChange={(e) => setDocNameAr(e.target.value)}
                dir="rtl"
                placeholder="د. سالم الهادي..."
                className="w-full bg-slate-50 dark:bg-slate-800/40 rounded-xl p-2.5"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">{isRtl ? "التخصص الطبي" : "Physician Specialty"}</label>
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

            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">{isRtl ? "نوع تمويل الرعاية" : "Sponsorship Coverage Type"}</label>
              <select
                value={sType}
                onChange={(e) => setSType(e.target.value as any)}
                className="w-full bg-slate-50 dark:bg-slate-800/40 rounded-xl p-2.5 font-bold"
              >
                <option value="Registration Fee">Registration Fee</option>
                <option value="Travel & Lodging">Travel & Lodging</option>
                <option value="Speaker Honorarium">Speaker Honorarium</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">{isRtl ? "عنوان المؤتمر العلمي (EN) *" : "Scientific Event Title (EN) *"}</label>
              <input 
                type="text"
                value={eventTitle}
                onChange={(e) => setEventTitle(e.target.value)}
                placeholder="e.g. International Cardiology Congress 2026, Dubai"
                className="w-full bg-slate-50 dark:bg-slate-800/40 rounded-xl p-2.5"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">{isRtl ? "عنوان المؤتمر العلمي بالعربية" : "Scientific Event Title (Arabic)"}</label>
              <input 
                type="text"
                value={eventTitleAr}
                onChange={(e) => setEventTitleAr(e.target.value)}
                dir="rtl"
                placeholder="المؤتمر الدولي لأمراض القلب ٢٠٢٦، دبي..."
                className="w-full bg-slate-50 dark:bg-slate-800/40 rounded-xl p-2.5"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">{isRtl ? "المبلغ المقترح بالدولار (USD) *" : "Requested Budget ($ USD) *"}</label>
              <input 
                type="number"
                value={amountVal}
                onChange={(e) => setAmountVal(e.target.value)}
                placeholder="e.g. 1200"
                className="w-full bg-slate-50 dark:bg-slate-800/40 rounded-xl p-2.5 font-mono"
              />
            </div>

            <div className="sm:col-span-2 flex justify-end gap-2 pt-3 border-t">
              <button 
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 py-2 border rounded-xl font-bold text-slate-500"
              >
                {isRtl ? "إلغاء" : "Cancel"}
              </button>
              <button 
                type="submit"
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold"
              >
                {isRtl ? "إرسال الطلب للمراجعة والتدقيق" : "Submit to Compliance Queue"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Main Approval Queue Grid */}
      <div className="space-y-4">
        <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300">
          {isRtl ? "طلبات الرعاية النشطة قيد المراجعة والتدقيق" : "Sponsorship Proposals Compliance Audits"}
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {sponsorships.map((spo) => (
            <div 
              key={spo.id} 
              className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-5 rounded-2xl shadow-xxs flex flex-col justify-between space-y-4 hover:border-indigo-50 transition-colors"
            >
              <div className="space-y-3">
                
                {/* ID and Status badge */}
                <div className="flex justify-between items-center text-[10px]">
                  <span className="font-mono text-slate-400 font-bold">{spo.id} • {spo.dateFiled}</span>
                  <span className={`px-2.5 py-0.5 rounded-full font-bold ${
                    spo.status === "Approved"
                      ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400"
                      : spo.status === "Declined"
                      ? "bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400"
                      : "bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400"
                  }`}>
                    {spo.status === "Approved" ? (isRtl ? "معتمد وممول" : "Approved") : spo.status === "Declined" ? (isRtl ? "مرفوض" : "Declined") : (isRtl ? "قيد المراجعة" : "Pending Audit")}
                  </span>
                </div>

                {/* Doc detail & convention */}
                <div className="space-y-1">
                  <h4 className="font-bold text-slate-950 dark:text-white text-xs leading-snug">
                    {isRtl ? spo.doctorNameAr : spo.doctorName}
                  </h4>
                  <p className="text-[10px] text-slate-400 font-bold uppercase">
                    {isRtl ? spo.specialtyAr : spo.specialty} • {isRtl ? spo.sponsorshipTypeAr : spo.sponsorshipType}
                  </p>
                </div>

                <div className="bg-slate-50 dark:bg-slate-950/60 p-3 rounded-xl border border-slate-100 dark:border-slate-850 text-xxs text-slate-600 dark:text-slate-400">
                  <span className="block font-bold text-slate-400 uppercase tracking-wide mb-0.5">{isRtl ? "المؤتمر العلمي المستهدف" : "Target Scientific Convention"}</span>
                  {isRtl ? spo.eventTitleAr : spo.eventTitle}
                </div>
              </div>

              {/* Action row with amount */}
              <div className="pt-3 border-t border-slate-50 dark:border-slate-850 flex items-center justify-between">
                <div>
                  <span className="text-xxs text-slate-400 block">{isRtl ? "قيمة الدعم المالي المقترح" : "Required funding"}</span>
                  <span className="text-sm font-extrabold text-indigo-600 dark:text-indigo-400 font-mono">${spo.amount}</span>
                </div>

                {spo.status === "Pending" && (
                  <div className="flex items-center gap-1.5">
                    <button 
                      onClick={() => handleDecline(spo.id, spo.doctorName)}
                      className="px-2.5 py-1 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 text-xxs font-bold border border-transparent rounded-lg cursor-pointer"
                    >
                      {isRtl ? "رفض" : "Decline"}
                    </button>
                    <button 
                      onClick={() => handleApprove(spo.id, spo.doctorName)}
                      className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xxs font-bold rounded-lg cursor-pointer shadow-xs"
                    >
                      {isRtl ? "اعتماد" : "Approve"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {sponsorships.length === 0 && (
            <div className="col-span-full py-12 text-center text-xs text-slate-400 border border-dashed rounded-2xl bg-slate-50/50 dark:bg-slate-900/30">
              {isRtl ? "لا توجد طلبات رعاية أو تمويل أطباء حالياً." : "No key opinion leader sponsorships or travel funding requests are currently active."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
