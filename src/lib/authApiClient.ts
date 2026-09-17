export interface ClaimActivationResponse {
  success: boolean;
  status: "SUCCESS" | "ACTIVATION_NOT_FOUND" | "ACTIVATION_ALREADY_USED" | "EMAIL_MISMATCH" | "IDENTITY_CONFLICT" | "ACTIVATION_DISABLED" | "ERROR";
  uid?: string;
  email?: string;
  role?: string;
  profileCreated?: boolean;
  activationClaimed?: boolean;
  conflict?: boolean;
  user?: any;
  error?: string;
}

/**
 * Client-side API caller for Phase 3H: Trusted Backend Activation Claim
 */
export async function claimActivationViaBackend(idToken: string): Promise<ClaimActivationResponse> {
  if (!idToken) {
    return {
      success: false,
      status: "ERROR",
      error: "No Firebase ID token provided."
    };
  }

  try {
    const res = await fetch("/api/auth/claim-activation", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${idToken}`
      }
    });

    const data = await res.json();
    return data as ClaimActivationResponse;
  } catch (err: any) {
    console.error("[authApiClient] Network error claiming activation:", err);
    return {
      success: false,
      status: "ERROR",
      error: err.message || "Network error connecting to activation claim service."
    };
  }
}
