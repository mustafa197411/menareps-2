import { auth } from "./firebase";

export async function decideAuthorizedSampleRequest(input: { requestId: string; decision: "APPROVED" | "REJECTED"; approvedQuantity?: number; rejectionReason?: string }) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("AUTHENTICATED_SAMPLE_APPROVER_REQUIRED");
  const response = await fetch("/api/samples/approval-decision", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success !== true) throw new Error(result.code || "SAMPLE_APPROVAL_DECISION_FAILED");
  return result;
}
