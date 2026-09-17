import { describe, expect, it } from "vitest";
import { connectFirebaseEmulatorsIfApproved } from "../../../src/lib/firebaseEmulatorGuard";

const services = { auth: null as never, db: null as never, storage: null as never };

describe("MENAREPS production-isolation guard", () => {
  it("does nothing when emulator mode is disabled", () => {
    expect(connectFirebaseEmulatorsIfApproved({ ...services, enabled: false, projectId: "menareps-crm-production-5046c" })).toBe(false);
  });
  it("rejects every non-demo project before connecting", () => {
    expect(() => connectFirebaseEmulatorsIfApproved({ ...services, enabled: true, projectId: "menareps-crm-production-5046c" })).toThrow("exact demo-menareps-uat");
  });
  it.each([
    ["authEndpoint", "https://identitytoolkit.googleapis.com"],
    ["firestoreHost", "firestore.googleapis.com:443"],
    ["storageHost", "storage.googleapis.com:443"],
  ] as const)("rejects non-loopback %s", (field, value) => {
    expect(() => connectFirebaseEmulatorsIfApproved({ ...services, enabled: true, projectId: "demo-menareps-uat", [field]: value })).toThrow("Refusing non-local");
  });
});
