import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { getBytes, ref, uploadBytes } from "firebase/storage";
import { afterAll, beforeAll, describe, it } from "vitest";
import { UAT_ENDPOINTS, UAT_PROJECT_ID } from "./constants";
import { assertProductionIsolation } from "./preflight";

const [firestoreHost, firestorePort] = UAT_ENDPOINTS.firestore.split(":");
const [storageHost, storagePort] = UAT_ENDPOINTS.storage.split(":");
let env: Awaited<ReturnType<typeof initializeTestEnvironment>>;
const storage = (uid?: string) => uid ? env.authenticatedContext(uid).storage() : env.unauthenticatedContext().storage();
const path = (name: string) => `resources/PG-A/RES-${name}/v1/${name}.pdf`;

beforeAll(async () => {
  assertProductionIsolation();
  env = await initializeTestEnvironment({
    projectId: UAT_PROJECT_ID,
    firestore: { host: firestoreHost, port: Number(firestorePort), rules: readFileSync("firestore.rules", "utf8") },
    storage: { host: storageHost, port: Number(storagePort), rules: readFileSync("storage.rules", "utf8") },
  });
  await env.withSecurityRulesDisabled(async context => {
    await uploadBytes(ref(context.storage(), path("allowed")), new Uint8Array([37, 80, 68, 70]), { contentType: "application/pdf" });
  });
});
afterAll(async () => env.cleanup());

describe("MENAREPS Storage authorization", () => {
  it("denies direct Firebase uploads even for a formerly privileged role", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70]);
    await assertFails(uploadBytes(ref(storage("uat-product-manager"), path("direct-denied")), bytes, { contentType: "application/pdf" }));
    await assertFails(uploadBytes(ref(storage("uat-medical-rep-west-a"), path("denied")), bytes, { contentType: "application/pdf" }));
  });
  it("denies all direct client reads, including authenticated known-path reads", async () => {
    await assertFails(getBytes(ref(storage(), path("allowed"))));
    await assertFails(getBytes(ref(storage("uat-medical-rep-west-a"), path("allowed"))));
    await assertFails(getBytes(ref(storage("uat-admin"), path("allowed"))));
  });
  it("denies all non-canonical paths", async () => {
    await assertFails(uploadBytes(ref(storage("uat-product-manager"), "uat/outside.pdf"), new Uint8Array([1]), { contentType: "application/pdf" }));
  });
});
