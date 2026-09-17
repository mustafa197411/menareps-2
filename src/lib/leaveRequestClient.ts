import type { User as FirebaseUser } from "firebase/auth";
import type { LeaveRequestMutation } from "../../server/leaveRequestMutationService";

export async function mutateLeaveRequest(user: Pick<FirebaseUser, "getIdToken">, request: LeaveRequestMutation, fetchImplementation: typeof fetch = fetch): Promise<{ success: boolean; code?: string; requestId?: string }> {
  const token = await user.getIdToken();
  const response = await fetchImplementation("/api/leave-requests/mutate", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(request) });
  const result = await response.json();
  if (!response.ok || !result?.success) { const error = new Error("Leave request operation failed") as Error & { code?: string }; error.code = result?.code || `HTTP_${response.status}`; throw error; }
  return result;
}
