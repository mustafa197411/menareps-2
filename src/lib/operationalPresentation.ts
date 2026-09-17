export type OperationalPresentation = {
  tone: "loading" | "success" | "warning" | "danger" | "neutral";
  label: "Loading" | "Operational" | "Pending" | "Incomplete" | "Inactive" | "Suspended" | "Blocked" | "Terminated";
  definitiveFailure: boolean;
};

/** Keeps hydration states distinct from definitive account/readiness failures. */
export function getOperationalPresentation(
  status: string | undefined,
  reasons: string[] = []
): OperationalPresentation {
  if (status === "Pending" || reasons.includes("LOADING_MANAGER")) {
    return { tone: "loading", label: "Loading", definitiveFailure: false };
  }
  if (status === "Operational") {
    return { tone: "success", label: "Operational", definitiveFailure: false };
  }
  if (status === "Inactive") {
    return { tone: "neutral", label: "Inactive", definitiveFailure: true };
  }
  if (status === "Suspended") {
    return { tone: "danger", label: "Suspended", definitiveFailure: true };
  }
  if (status === "Blocked") {
    return { tone: "danger", label: "Blocked", definitiveFailure: true };
  }
  if (status === "Terminated") {
    return { tone: "danger", label: "Terminated", definitiveFailure: true };
  }
  return { tone: "warning", label: "Incomplete", definitiveFailure: true };
}
