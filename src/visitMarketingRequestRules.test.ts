import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

const projectId = "demo-menareps-wp83";
if (!process.env.FIRESTORE_EMULATOR_HOST?.startsWith("127.0.0.1:")) throw new Error("FIRESTORE_EMULATOR_LOOPBACK_REQUIRED");
const env = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8089 } });
await env.clearFirestore();
await env.withSecurityRulesDisabled(async context => {
  const db = context.firestore();
  await setDoc(doc(db, "users/REP-SYNTHETIC"), { role: "Medical Representative", active: true, status: "Active" });
  await setDoc(doc(db, "users/SUP-SYNTHETIC"), { role: "Medical Supervisor", active: true, status: "Active" });
  await setDoc(doc(db, "users/ADMIN-SYNTHETIC"), { role: "Admin", active: true, status: "Active" });
  await setDoc(doc(db, "visitMarketingRequests/VMR-SYNTHETIC"), { id: "VMR-SYNTHETIC", creatorUid: "REP-SYNTHETIC", status: "PENDING_SUPERVISOR" });
  await setDoc(doc(db, "visitMarketingRequestAudit/VMRA-SYNTHETIC"), { id: "VMRA-SYNTHETIC", requestId: "VMR-SYNTHETIC", actorUid: "REP-SYNTHETIC" });
});

const actorDb = (uid: string) => env.authenticatedContext(uid).firestore();
let passed = 0;
async function denied(label: string, operation: Promise<unknown>) { await assertFails(operation); passed++; console.log(`[PASS] ${label}`); }

await denied("representative cannot directly create canonical request", setDoc(doc(actorDb("REP-SYNTHETIC"), "visitMarketingRequests/VMR-FORGED"), { creatorUid: "REP-SYNTHETIC" }));
await denied("representative cannot directly update canonical request", updateDoc(doc(actorDb("REP-SYNTHETIC"), "visitMarketingRequests/VMR-SYNTHETIC"), { status: "APPROVED" }));
await denied("Supervisor cannot directly approve canonical request", updateDoc(doc(actorDb("SUP-SYNTHETIC"), "visitMarketingRequests/VMR-SYNTHETIC"), { status: "PENDING_FINAL_APPROVAL" }));
await denied("Admin cannot bypass backend transition authority", updateDoc(doc(actorDb("ADMIN-SYNTHETIC"), "visitMarketingRequests/VMR-SYNTHETIC"), { status: "APPROVED" }));
await denied("manager cannot directly mark a request executed", updateDoc(doc(actorDb("ADMIN-SYNTHETIC"), "visitMarketingRequests/VMR-SYNTHETIC"), { status: "EXECUTED", executedByUid: "ADMIN-SYNTHETIC" }));
await denied("representative cannot directly delete canonical request", deleteDoc(doc(actorDb("REP-SYNTHETIC"), "visitMarketingRequests/VMR-SYNTHETIC")));
await denied("representative cannot directly read canonical request", getDoc(doc(actorDb("REP-SYNTHETIC"), "visitMarketingRequests/VMR-SYNTHETIC")));
await denied("representative cannot create audit event", setDoc(doc(actorDb("REP-SYNTHETIC"), "visitMarketingRequestAudit/VMRA-FORGED"), { requestId: "VMR-SYNTHETIC" }));
await denied("Admin cannot edit immutable audit event", updateDoc(doc(actorDb("ADMIN-SYNTHETIC"), "visitMarketingRequestAudit/VMRA-SYNTHETIC"), { actorUid: "ADMIN-SYNTHETIC" }));
await denied("Admin cannot delete immutable audit event", deleteDoc(doc(actorDb("ADMIN-SYNTHETIC"), "visitMarketingRequestAudit/VMRA-SYNTHETIC")));

console.log(`Visit Marketing Request rules tests passed: ${passed}/10`);
await env.cleanup();
