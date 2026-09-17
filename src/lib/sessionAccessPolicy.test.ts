import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { isExplicitSandboxEnabled, resolveSessionAccessMode } from "./sessionAccessPolicy";

describe("production session access policy", () => {
  it("requires authentication after unauthenticated production initialization", () => {
    expect(resolveSessionAccessMode({
      authReady: true,
      hasFirebaseUser: false,
      explicitSandboxEnabled: false,
    })).toBe("AUTHENTICATION_REQUIRED");
  });

  it("does not infer sandbox from an unauthenticated session", () => {
    expect(isExplicitSandboxEnabled({ isDevelopment: false, sandboxRequested: false })).toBe(false);
    expect(resolveSessionAccessMode({
      authReady: true,
      hasFirebaseUser: false,
      explicitSandboxEnabled: false,
    })).not.toBe("SANDBOX");
  });

  it("prevents production flags from enabling sandbox", () => {
    expect(isExplicitSandboxEnabled({ isDevelopment: false, sandboxRequested: true })).toBe(false);
  });

  it("preserves an explicitly requested development sandbox", () => {
    const explicitSandboxEnabled = isExplicitSandboxEnabled({ isDevelopment: true, sandboxRequested: true });
    expect(resolveSessionAccessMode({ authReady: true, hasFirebaseUser: false, explicitSandboxEnabled })).toBe("SANDBOX");
  });

  it("preserves the authenticated canonical session path", () => {
    expect(resolveSessionAccessMode({
      authReady: true,
      hasFirebaseUser: true,
      explicitSandboxEnabled: false,
    })).toBe("AUTHENTICATED");
  });

  it("keeps production sandbox and impersonation controls behind the explicit policy", () => {
    const app = fs.readFileSync("src/App.tsx", "utf8");
    expect(app).toContain('id="production-authentication-gate"');
    expect(app).toContain('sessionAccessMode === "SANDBOX"');
    expect(app).toContain("{isSandbox && (");
    expect(app).not.toContain("const isSandbox = authReady && !firebaseUser");
  });
});
