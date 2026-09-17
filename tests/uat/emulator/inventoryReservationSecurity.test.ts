import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, describe, it } from "vitest";

const projectId = "demo-menareps-phase5c";
let environment: Awaited<ReturnType<typeof initializeTestEnvironment>>;

beforeAll(async () => {
  const endpoint = process.env.FIRESTORE_EMULATOR_HOST;
  if (!endpoint) throw new Error("PHASE5B_FIRESTORE_EMULATOR_REQUIRED");
  const [host, port] = endpoint.split(":");
  environment = await initializeTestEnvironment({ projectId, firestore: { host, port: Number(port), rules: readFileSync("firestore.rules", "utf8") } });
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "users", "phase5b-admin"), { id: "phase5b-admin", role: "Admin", active: true, status: "Active", loginAllowed: true });
    await setDoc(doc(context.firestore(), "products", "P1"), { id: "P1", name: "Product", price: 1, stockQuantity: 12, activeReservedQuantity: 3 });
    await setDoc(doc(context.firestore(), "inventoryReservations", "RES_ORDER_P1"), { reservationId: "RES_ORDER_P1", orderId: "ORDER", productId: "P1", status: "ACTIVE" });
    await setDoc(doc(context.firestore(), "inventoryReturnEvents", "RETURN_RES_ORDER_P1"), { eventId: "RETURN_RES_ORDER_P1", orderId: "ORDER", productId: "P1" });
  });
}, 30_000);

afterAll(async () => environment?.cleanup(), 30_000);

describe("Phase 5B backend-only inventory authority", () => {
  it("denies all direct reservation and return-event access", async () => {
    for (const database of [environment.unauthenticatedContext().firestore(), environment.authenticatedContext("phase5b-admin", { role: "Admin" }).firestore()]) {
      await assertFails(getDoc(doc(database, "inventoryReservations", "RES_ORDER_P1")));
      await assertFails(setDoc(doc(database, "inventoryReservations", "FORGED"), { status: "ACTIVE", totalReservedQuantity: 999 }));
      await assertFails(updateDoc(doc(database, "inventoryReservations", "RES_ORDER_P1"), { status: "CONSUMED" }));
      await assertFails(deleteDoc(doc(database, "inventoryReservations", "RES_ORDER_P1")));
      await assertFails(getDoc(doc(database, "inventoryReturnEvents", "RETURN_RES_ORDER_P1")));
      await assertFails(setDoc(doc(database, "inventoryReturnEvents", "FORGED"), { totalReturnedQuantity: 999 }));
      await assertFails(updateDoc(doc(database, "inventoryReturnEvents", "RETURN_RES_ORDER_P1"), { totalReturnedQuantity: 999 }));
      await assertFails(deleteDoc(doc(database, "inventoryReturnEvents", "RETURN_RES_ORDER_P1")));
    }
  });

  it("allows ordinary Admin product maintenance but forbids reservation-balance tampering", async () => {
    const database = environment.authenticatedContext("phase5b-admin", { role: "Admin" }).firestore();
    await assertSucceeds(updateDoc(doc(database, "products", "P1"), { price: 2 }));
    await assertFails(updateDoc(doc(database, "products", "P1"), { activeReservedQuantity: 0 }));
    await assertFails(updateDoc(doc(database, "products", "P1"), { stockQuantity: 0, activeReservedQuantity: 0 }));
    await assertFails(setDoc(doc(database, "products", "FORGED"), { id: "FORGED", stockQuantity: 12, activeReservedQuantity: 10 }));
    await assertSucceeds(setDoc(doc(database, "products", "SAFE"), { id: "SAFE", stockQuantity: 12, activeReservedQuantity: 0 }));
  });

  it("allows Admin SDK/backend context to apply authoritative balances", async () => {
    await environment.withSecurityRulesDisabled(async context => {
      await assertSucceeds(updateDoc(doc(context.firestore(), "products", "P1"), { activeReservedQuantity: 0 }));
      await assertSucceeds(setDoc(doc(context.firestore(), "inventoryReservations", "BACKEND"), { status: "ACTIVE" }));
    });
  });
});
