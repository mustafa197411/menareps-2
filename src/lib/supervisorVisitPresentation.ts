import type { SupervisorIdentityPresentation } from "../types";

const LABELS: Record<string, { en:string; ar:string }> = {
  ACKNOWLEDGED:{en:"Acknowledged",ar:"تم الإقرار"},
  DISAGREE_REQUEST_REVIEW:{en:"Disagree — Request Review",ar:"عدم الموافقة — طلب مراجعة"},
  KEEP_UNCHANGED:{en:"Keep Appraisal Unchanged",ar:"الإبقاء على التقييم دون تغيير"},
  REVISE:{en:"Revise Appraisal",ar:"تعديل التقييم"},
  ACKNOWLEDGE_REVISED_APPRAISAL:{en:"Acknowledge Revised Appraisal",ar:"الإقرار بالتقييم المعدل"},
  MAINTAIN_DISAGREEMENT:{en:"Maintain Disagreement",ar:"الاستمرار في عدم الموافقة"},
  INITIAL_DRAFT:{en:"Initial Draft",ar:"المسودة الأولية"},
  INITIAL_REPRESENTATIVE_REVIEW:{en:"Initial Representative Review",ar:"المراجعة الأولية للمندوب"},
  SUPERVISOR_DISAGREEMENT_REVIEW:{en:"Supervisor Disagreement Review",ar:"مراجعة المشرف للاعتراض"},
  REVISION_DRAFT:{en:"Revision Draft",ar:"مسودة التعديل"},
  FINAL_REPRESENTATIVE_REVIEW:{en:"Final Representative Review",ar:"المراجعة النهائية للمندوب"},
  SUPERVISOR_FINAL_REVIEW:{en:"Supervisor Final Review",ar:"المراجعة النهائية للمشرف"},
  FINALIZED:{en:"Finalized",ar:"نهائي"},
  DRAFT:{en:"Draft",ar:"مسودة"},
  PENDING_CONFIRMATION:{en:"Pending Confirmation",ar:"بانتظار التأكيد"},
  REPRESENTATIVE_REVIEWED:{en:"Representative Reviewed",ar:"تمت مراجعة المندوب"},
  SIGNED_OFF:{en:"Signed Off",ar:"معتمد"},
  COMPLETED:{en:"Completed",ar:"مكتمل"},
  VOID:{en:"Void",ar:"ملغى"},
  SCHEDULED:{en:"Scheduled",ar:"مجدول"},
  IN_PROGRESS:{en:"In Progress",ar:"قيد التنفيذ"},
  CANCELLED:{en:"Cancelled",ar:"ملغى"},
  "Medical Supervisor":{en:"Medical Supervisor",ar:"مشرف طبي"},
  "Sales Supervisor":{en:"Sales Supervisor",ar:"مشرف مبيعات"},
  "Coaching Session":{en:"Coaching Session",ar:"جلسة توجيه"},
  "Joint Field Visit":{en:"Joint Field Visit",ar:"زيارة ميدانية مشتركة"},
  "Performance Follow-up":{en:"Performance Follow-up",ar:"متابعة الأداء"},
  "Dual Audit":{en:"Dual Audit",ar:"تدقيق مزدوج"},
};

export function supervisorPresentationLabel(value:string|null|undefined, lang:"en"|"ar") {
  if (!value) return "—";
  return LABELS[value]?.[lang] || value.replaceAll("_"," ").toLowerCase().replace(/(^|\s)\S/g, letter => letter.toUpperCase());
}

export function supervisorIdentityPresentation(identity:SupervisorIdentityPresentation|undefined,lang:"en"|"ar"){
  const name=identity?.resolved&&identity.name.trim()?identity.name:(lang==="ar"?"مشرف غير معروف":"Unknown supervisor");
  const role=identity?.resolved&&identity.role?supervisorPresentationLabel(identity.role,lang):"—";
  return `${name} • ${role}`;
}

export function supervisorHistoryErrorMessage(code:string|undefined, lang:"en"|"ar") {
  const denied = code === "SUPERVISOR_ROLE_DENIED" || code === "SUPERVISOR_HISTORY_SCOPE_DENIED" || code === "CUSTOMER_HISTORY_SCOPE_DENIED" || code === "OPERATIONAL_SCOPE_DENIED";
  if (denied) return lang === "ar" ? "ليس لديك صلاحية لعرض سجل زيارات المشرف لهذا الطبيب." : "You are not authorized to view supervisor visit history for this physician.";
  return lang === "ar" ? "تعذر تحميل سجل زيارات المشرف." : "Unable to load supervisor visit history.";
}
