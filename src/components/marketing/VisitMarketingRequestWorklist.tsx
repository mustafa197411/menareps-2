import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import type { User } from "../../types";
import { auth } from "../../lib/firebase";
import {
  queryVisitMarketingRequests,
  transitionVisitMarketingRequest,
} from "../../lib/visitMarketingRequestClient";
import type { CanonicalVisitMarketingRequest } from "../../lib/visitMarketingRequestPolicy";
import {
  presentationActionsForVisitMarketingRequest,
  visitMarketingRequestActionRequiresText,
  type VisitMarketingRequestGovernedAction,
} from "../../lib/visitMarketingRequestPresentation";

interface Props {
  currentUser: User;
  lang: "en" | "ar";
}

const ROUTE_BY_ACTION: Record<VisitMarketingRequestGovernedAction, "supervisor-approve" | "supervisor-reject" | "final-approve" | "final-reject" | "execute" | "cancel"> = {
  SUPERVISOR_APPROVE: "supervisor-approve",
  SUPERVISOR_REJECT: "supervisor-reject",
  FINAL_APPROVE: "final-approve",
  FINAL_REJECT: "final-reject",
  EXECUTE: "execute",
  CANCEL: "cancel",
};

const LABELS: Record<VisitMarketingRequestGovernedAction, string> = {
  SUPERVISOR_APPROVE: "Supervisor Approve",
  SUPERVISOR_REJECT: "Supervisor Reject",
  FINAL_APPROVE: "Final Approve",
  FINAL_REJECT: "Final Reject",
  EXECUTE: "Confirm Execution",
  CANCEL: "Cancel Request",
};

const ACTION_TEST_ID: Record<VisitMarketingRequestGovernedAction, string> = {
  SUPERVISOR_APPROVE: "supervisor-approve",
  SUPERVISOR_REJECT: "supervisor-reject",
  FINAL_APPROVE: "final-approve",
  FINAL_REJECT: "final-reject",
  EXECUTE: "execute",
  CANCEL: "cancel",
};

function actorUid(user: User): string {
  return String(user.uid || user.id || "").trim();
}

export default function VisitMarketingRequestWorklist({ currentUser, lang }: Props) {
  const isRtl = lang === "ar";
  const [requests, setRequests] = useState<CanonicalVisitMarketingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState<{ requestId: string; action: VisitMarketingRequestGovernedAction } | null>(null);
  const [actionText, setActionText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const uid = useMemo(() => actorUid(currentUser), [currentUser.id, currentUser.uid]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await queryVisitMarketingRequests(auth.currentUser);
      setRequests(result.requests);
    } catch (cause) {
      setRequests([]);
      setError(cause instanceof Error ? cause.message : "VISIT_MARKETING_REQUEST_READ_FAILED");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const applyAction = async (requestId: string, action: VisitMarketingRequestGovernedAction, text = "") => {
    setSubmitting(true);
    setError("");
    setConfirmation("");
    try {
      const reason = action === "SUPERVISOR_REJECT" || action === "FINAL_REJECT" || action === "CANCEL" ? text : undefined;
      const comment = action === "EXECUTE" ? text : undefined;
      await transitionVisitMarketingRequest(auth.currentUser, ROUTE_BY_ACTION[action], requestId, reason, comment);
      setConfirmation(isRtl ? "تم تحديث الطلب من خلال الصلاحية المعتمدة." : "Request updated through canonical authority.");
      setPending(null);
      setActionText("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "VISIT_MARKETING_REQUEST_TRANSITION_FAILED");
    } finally {
      setSubmitting(false);
    }
  };

  const beginAction = (requestId: string, action: VisitMarketingRequestGovernedAction) => {
    if (visitMarketingRequestActionRequiresText(action)) {
      setPending({ requestId, action });
      setActionText("");
      setError("");
      return;
    }
    void applyAction(requestId, action);
  };

  const submitTextAction = () => {
    if (!pending) return;
    if (!actionText.trim()) {
      setError(pending.action === "EXECUTE" ? "EXECUTION_NOTE_REQUIRED" : "ACTION_REASON_REQUIRED");
      return;
    }
    void applyAction(pending.requestId, pending.action, actionText.trim());
  };

  return (
    <section id="visit-marketing-request-worklist" data-testid="visit-marketing-request-worklist" className="p-6 max-w-6xl mx-auto space-y-5" dir={isRtl ? "rtl" : "ltr"}>
      <header className="flex items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">{isRtl ? "طلبات تسويق الزيارات" : "Visit Marketing Requests"}</h2>
          <p className="text-xs text-slate-500 mt-1">{isRtl ? "طلبات دعم الزيارات الطبية المعتمدة" : "Governed medical-visit support requests"}</p>
        </div>
        <button data-testid="visit-marketing-request-refresh" onClick={() => void load()} disabled={loading} className="p-2 rounded-lg border disabled:opacity-50" aria-label="Refresh Visit Marketing Requests"><RefreshCw size={16} /></button>
      </header>

      {error && <div data-testid="visit-marketing-request-error" role="alert" className="p-3 rounded-lg border border-rose-200 bg-rose-50 text-xs text-rose-700 flex gap-2"><AlertCircle size={15} />{error}</div>}
      {confirmation && <div data-testid="visit-marketing-request-confirmation" role="status" className="p-3 rounded-lg border border-emerald-200 bg-emerald-50 text-xs text-emerald-700 flex gap-2"><CheckCircle2 size={15} />{confirmation}</div>}
      {loading && <div data-testid="visit-marketing-request-loading" className="text-sm text-slate-500">{isRtl ? "جارٍ التحميل…" : "Loading canonical requests…"}</div>}
      {!loading && !requests.length && !error && <div data-testid="visit-marketing-request-empty" className="rounded-xl border p-8 text-center text-sm text-slate-500">{isRtl ? "لا توجد طلبات ضمن النطاق المصرح." : "No requests are available in the authorized scope."}</div>}

      <div className="space-y-3">
        {requests.map(request => {
          const actions = request.authorizedActions || [];
          return (
            <article key={request.id} data-testid={`visit-marketing-request-card-${request.id}`} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h3 className="font-bold text-sm">{request.requestType}</h3><p className="text-xs text-slate-500 mt-1">{request.description}</p></div>
                <span data-testid={`visit-marketing-request-status-${request.id}`} className="text-[10px] font-bold px-2 py-1 rounded bg-blue-50 text-blue-700">{request.status}</span>
              </div>
              <dl className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-[10px] text-slate-500">
                <div><dt>Representative</dt><dd className="font-mono text-slate-700 dark:text-slate-300">{request.representativeUid}</dd></div>
                <div><dt>Physician</dt><dd className="font-mono text-slate-700 dark:text-slate-300">{request.physicianId}</dd></div>
                <div><dt>Created</dt><dd>{request.createdAt}</dd></div>
                <div><dt>Planned</dt><dd>{request.plannedDate || "—"}</dd></div>
                <div><dt>Urgency</dt><dd>{request.urgency}</dd></div>
                <div><dt>Supervisor review</dt><dd>{request.supervisorReviewedAt || "Pending"}</dd></div>
                <div><dt>Final approval</dt><dd>{request.finalReviewedAt || "Pending"}</dd></div>
                <div><dt>Execution</dt><dd>{request.executedAt || "Pending"}</dd></div>
              </dl>
              {request.executionNote && <p data-testid={`visit-marketing-request-execution-note-${request.id}`} className="text-xs text-emerald-700">{request.executionNote}</p>}
              {actions.length > 0 && <div className="flex flex-wrap gap-2">{actions.map(action => (
                <button key={action} data-testid={`visit-marketing-request-${ACTION_TEST_ID[action]}-${request.id}`} onClick={() => beginAction(request.id, action)} disabled={submitting} className="px-3 py-1.5 text-[10px] font-bold rounded-lg border disabled:opacity-50">{LABELS[action]}</button>
              ))}</div>}
              {pending?.requestId === request.id && (
                <div data-testid={`visit-marketing-request-action-panel-${request.id}`} className="space-y-2 rounded-lg bg-slate-50 dark:bg-slate-950 p-3">
                  <label htmlFor={`visit-marketing-request-action-input-${request.id}`} className="text-xs font-bold">{pending.action === "EXECUTE" ? "Completion note" : "Reason"}</label>
                  <textarea id={`visit-marketing-request-action-input-${request.id}`} data-testid={`visit-marketing-request-action-input-${request.id}`} value={actionText} onChange={event => setActionText(event.target.value)} className="w-full rounded-lg border bg-transparent p-2 text-xs" />
                  <div className="flex gap-2"><button data-testid={`visit-marketing-request-action-confirm-${request.id}`} onClick={submitTextAction} disabled={submitting} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs">Confirm</button><button onClick={() => setPending(null)} className="px-3 py-1.5 rounded-lg border text-xs">Close</button></div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
