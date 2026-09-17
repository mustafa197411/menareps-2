import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, deleteField, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const projectId = "demo-financial-authority";
let environment: Awaited<ReturnType<typeof initializeTestEnvironment>>;
const actors = [
  { uid: "synthetic-rep", role: "Sales Representative" },
  { uid: "synthetic-finance", role: "Finance Officer" },
  { uid: "synthetic-admin", role: "Admin" },
  { uid: "synthetic-super", role: "Super Admin" },
];
const monetaryCollections = ["customerLedgerEntries", "customerFinancialProfiles", "paymentCollections", "paymentAllocations", "payments"];
const record = { pharmacyId: "synthetic-pharmacy", areaId: "synthetic-area", representativeUid: "synthetic-rep", createdByUid: "synthetic-rep", amount: 10, status: "Submitted" };
const client = (uid: string) => environment.authenticatedContext(uid).firestore();

beforeAll(async () => {
  const endpoint = process.env.FIRESTORE_EMULATOR_HOST;
  if (!endpoint || !/^(127\.0\.0\.1|localhost):\d+$/.test(endpoint)) throw new Error("LOCAL_FIRESTORE_EMULATOR_REQUIRED");
  const [host, port] = endpoint.split(":");
  environment = await initializeTestEnvironment({ projectId, firestore: { host, port: Number(port), rules: readFileSync("firestore.rules", "utf8") } });
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const actor of actors) await setDoc(doc(db, "users", actor.uid), { ...actor, active: true, status: "Active", areaIds: ["synthetic-area"] });
    await setDoc(doc(db, "pharmacies", "synthetic-pharmacy"), { id: "synthetic-pharmacy", name: "Synthetic Pharmacy", areaId: "synthetic-area", outstandingBalance: 10 });
    await setDoc(doc(db, "pharmacies", "synthetic-no-balance"), { id: "synthetic-no-balance", name: "Synthetic Pharmacy" });
    await setDoc(doc(db, "orders", "synthetic-draft"), { id: "synthetic-draft", salesRepUid: "synthetic-rep", status: "DRAFT", paidStatus: "Unpaid", paidAmount: 0, total: 10 });
    await setDoc(doc(db, "orders", "synthetic-delivered"), { id: "synthetic-delivered", salesRepUid: "synthetic-rep", status: "DELIVERED", paidStatus: "Paid", paidAmount: 10 });
    for (const collection of monetaryCollections) {
      await setDoc(doc(db, collection, "synthetic-existing"), record);
      await setDoc(doc(db, collection, "synthetic-verified"), { ...record, status: "Verified" });
    }
  });
}, 30_000);
afterAll(async () => environment?.cleanup());

describe("Backend-owned financial authority", () => {
  for (const actor of actors) describe(actor.role, () => {
    for (const collection of monetaryCollections) {
      it(`${collection}: denies create, update and delete`, async () => {
        const db = client(actor.uid);
        await assertFails(setDoc(doc(db, collection, `forged-${actor.uid}`), { ...record, createdByUid: actor.uid, representativeUid: actor.uid, role: "Super Admin", source: "BACKEND" }));
        await assertFails(updateDoc(doc(db, collection, "synthetic-existing"), { amount: 100, outstandingBalance: 0 }));
        await assertFails(deleteDoc(doc(db, collection, "synthetic-existing")));
      });
    }
    it("denies certification forgery", async () => {
      await assertFails(updateDoc(doc(client(actor.uid), "customerFinancialProfiles", "synthetic-existing"), { projectionSource: "customerLedgerEntries", projectionVersion: 1, marketId: "synthetic-market", currencyCode: "TST" }));
    });
    it("denies Verified creation, verification and rewriting verified payments", async () => {
      const db = client(actor.uid);
      await assertFails(setDoc(doc(db, "paymentCollections", `verified-${actor.uid}`), { ...record, status: "Verified" }));
      await assertFails(updateDoc(doc(db, "paymentCollections", "synthetic-existing"), { status: "Verified" }));
      await assertFails(updateDoc(doc(db, "paymentCollections", "synthetic-verified"), { amount: 20, status: "Corrected" }));
      await assertFails(deleteDoc(doc(db, "paymentCollections", "synthetic-verified")));
      await assertFails(setDoc(doc(db, "payments", `PAY_legacy-${actor.uid}`), { ...record, status: "COLLECTED", source: "BACKEND" }));
    });
    it("preserves authorized financial and historical reads", async () => {
      for (const collection of monetaryCollections.filter(name => name !== "paymentAllocations")) await assertSucceeds(getDoc(doc(client(actor.uid), collection, "synthetic-existing")));
    });
    it("denies Order projection forgery and deletion", async () => {
      const db = client(actor.uid);
      for (const patch of [{ paidStatus: "Paid" }, { paidAmount: 10 }, { paidStatus: "Paid", paidAmount: 10 }, { paymentStatus: "Paid" }, { payments: [{ amount: 10 }] }, { paidAmount: deleteField() }]) {
        await assertFails(updateDoc(doc(db, "orders", "synthetic-draft"), patch));
      }
      for (const id of ["synthetic-draft", "synthetic-delivered"]) await assertFails(deleteDoc(doc(db, "orders", id)));
    });
    it("denies Pharmacy balance mutation or nonzero initialization", async () => {
      const db = client(actor.uid);
      await assertFails(updateDoc(doc(db, "pharmacies", "synthetic-pharmacy"), { outstandingBalance: 0 }));
      await assertFails(updateDoc(doc(db, "pharmacies", "synthetic-pharmacy"), { outstandingBalance: deleteField() }));
      await assertFails(updateDoc(doc(db, "pharmacies", "synthetic-no-balance"), { outstandingBalance: 10 }));
      for (const balance of [10, -10, "0", null]) await assertFails(setDoc(doc(db, "pharmacies", `new-${actor.uid}`), { name: "Synthetic Pharmacy", outstandingBalance: balance }));
    });
  });
  it("preserves owning representative non-financial Draft edits", async () => {
    await assertSucceeds(updateDoc(doc(client("synthetic-rep"), "orders", "synthetic-draft"), { notes: "Operational revision", total: 12 }));
    await assertFails(updateDoc(doc(client("synthetic-rep"), "orders", "synthetic-delivered"), { notes: "Untrusted revision" }));
  });
  it.each([
    { name: "paidStatus introduction", field: "paidStatus", initial: {}, patch: { paidStatus: "Paid" } },
    { name: "paidAmount introduction", field: "paidAmount", initial: {}, patch: { paidAmount: 10 } },
    { name: "paidStatus removal", field: "paidStatus", initial: { paidStatus: "Unpaid" }, patch: { paidStatus: deleteField() } },
    { name: "paymentStatus change", field: "paymentStatus", initial: { paymentStatus: "Unpaid" }, patch: { paymentStatus: "Paid" } },
    { name: "paymentStatus removal", field: "paymentStatus", initial: { paymentStatus: "Unpaid" }, patch: { paymentStatus: deleteField() } },
    { name: "payments change", field: "payments", initial: { payments: [] }, patch: { payments: [{ amount: 10 }] } },
    { name: "payments removal", field: "payments", initial: { payments: [] }, patch: { payments: deleteField() } },
  ])("denies $name on an otherwise editable Draft", async ({ name, field, initial, patch }) => {
    const id = `synthetic-${name.replaceAll(" ", "-")}`;
    await environment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "orders", id), {
        id, salesRepUid: "synthetic-rep", status: "DRAFT", total: 10, ...initial,
      });
    });
    const ref = doc(client("synthetic-rep"), "orders", id);
    const before = (await assertSucceeds(getDoc(ref))).data()!;
    expect(Object.hasOwn(before, field)).toBe(Object.hasOwn(initial, field));
    // Same authenticated owner and same Draft: only the protected field differs.
    await assertSucceeds(updateDoc(ref, { notes: "Permitted operational edit" }));
    await assertFails(updateDoc(ref, patch));
    const after = (await assertSucceeds(getDoc(ref))).data()!;
    expect(after.notes).toBe("Permitted operational edit");
    expect(Object.hasOwn(after, field)).toBe(Object.hasOwn(before, field));
    expect(after[field]).toEqual(before[field]);
  });
  it.each(["synthetic-admin", "synthetic-super"])("preserves legitimate Pharmacy maintenance for %s", async uid => {
    const db = client(uid);
    await assertSucceeds(updateDoc(doc(db, "pharmacies", "synthetic-pharmacy"), { name: "Updated Synthetic Pharmacy" }));
    await assertSucceeds(updateDoc(doc(db, "pharmacies", "synthetic-no-balance"), { name: "Updated Synthetic Pharmacy" }));
    await assertSucceeds(setDoc(doc(db, "pharmacies", `zero-${uid}`), { name: "Synthetic Pharmacy", outstandingBalance: 0 }));
    await assertSucceeds(setDoc(doc(db, "pharmacies", `absent-${uid}`), { name: "Synthetic Pharmacy" }));
  });
  it("preserves trusted backend writes outside client Rules", async () => {
    await environment.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      for (const collection of monetaryCollections) {
        const ref = doc(db, collection, "synthetic-backend");
        await assertSucceeds(setDoc(ref, record));
        await assertSucceeds(updateDoc(ref, { amount: 20 }));
        await assertSucceeds(deleteDoc(ref));
      }
      await assertSucceeds(updateDoc(doc(db, "orders", "synthetic-delivered"), { paidStatus: "Partially Paid", paidAmount: 5 }));
    });
  });
});
