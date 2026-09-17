export type SessionAccessMode =
  | "INITIALIZING"
  | "AUTHENTICATION_REQUIRED"
  | "AUTHENTICATED"
  | "SANDBOX";

export function isExplicitSandboxEnabled(input: {
  isDevelopment: boolean;
  sandboxRequested: boolean;
}): boolean {
  return input.isDevelopment && input.sandboxRequested;
}

export function resolveSessionAccessMode(input: {
  authReady: boolean;
  hasFirebaseUser: boolean;
  explicitSandboxEnabled: boolean;
}): SessionAccessMode {
  if (!input.authReady) return "INITIALIZING";
  if (input.hasFirebaseUser) return "AUTHENTICATED";
  if (input.explicitSandboxEnabled) return "SANDBOX";
  return "AUTHENTICATION_REQUIRED";
}
