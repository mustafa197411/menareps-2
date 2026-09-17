import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, describe, it } from "vitest";

const projectId = "menareps-offers-phase2-emulator";
let environment: Awaited<ReturnType<typeof initializeTestEnvironment>>;

beforeAll(async () => {
  const endpoint = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8089";
  const [host, port] = endpoint.split(":");
  environment = await initializeTestEnvironment({ projectId, firestore: { host, port: Number(port), rules: readFileSync("firestore.rules", "utf8") } });
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "offers", "OFFER-EMULATOR"), { id: "OFFER-EMULATOR", schemaVersion: 1, revision: 1 });
  });
}, 30_000);
afterAll(async () => environment?.cleanup(), 30_000);

describe("Offer administration Firestore boundary", () => {
  it("denies unauthenticated list, read, create, update and delete", async () => {
    const database = environment.unauthenticatedContext().firestore();
    await assertFails(getDocs(collection(database, "offers")));
    await assertFails(getDoc(doc(database, "offers", "OFFER-EMULATOR")));
    await assertFails(setDoc(doc(database, "offers", "DIRECT-CREATE"), { id: "DIRECT-CREATE" }));
    await assertFails(updateDoc(doc(database, "offers", "OFFER-EMULATOR"), { revision: 2 }));
    await assertFails(deleteDoc(doc(database, "offers", "OFFER-EMULATOR")));
  });

  it("denies direct client access even for authenticated Admin", async () => {
    const database = environment.authenticatedContext("synthetic-admin", { role: "Admin" }).firestore();
    await assertFails(getDocs(collection(database, "offers")));
    await assertFails(getDoc(doc(database, "offers", "OFFER-EMULATOR")));
    await assertFails(setDoc(doc(database, "offers", "DIRECT-ADMIN"), { id: "DIRECT-ADMIN" }));
    await assertFails(updateDoc(doc(database, "offers", "OFFER-EMULATOR"), { revision: 2 }));
    await assertFails(deleteDoc(doc(database, "offers", "OFFER-EMULATOR")));
  });

  it("allows the emulator backend/Admin context to persist authoritative documents", async () => {
    await environment.withSecurityRulesDisabled(async context => {
      const reference = doc(context.firestore(), "offers", "BACKEND-OFFER");
      await assertSucceeds(setDoc(reference, { id: "BACKEND-OFFER", schemaVersion: 1, revision: 1 }));
      await assertSucceeds(getDoc(reference));
    });
  });
});
