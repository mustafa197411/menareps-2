import fs from "node:fs";
import { assertFails, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc } from "firebase/firestore";

const projectId = "demo-menareps-uat";
const environment = await initializeTestEnvironment({ projectId, firestore: { host: "127.0.0.1", port: 8089, rules: fs.readFileSync("firestore.rules", "utf8") } });
try {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "users", "synthetic-sales-rep"), { id: "synthetic-sales-rep", role: "Sales Representative", active: true, employmentStatus: "Active", loginAllowed: true, isDeleted: false });
    await setDoc(doc(context.firestore(), "pharmacies", "PH1"), { id: "PH1", name: "Synthetic", territory: "C / D / CI / A", region: "D", address: "Address", outstandingBalance: 0, active: true, status: "Active", areaId: "A" });
  });
  const representative = environment.authenticatedContext("synthetic-sales-rep").firestore();
  await assertFails(setDoc(doc(representative, "pharmacyVisits", "FORGED"), { id: "FORGED", repId: "synthetic-sales-rep", pharmacyId: "PH1", status: "COMPLETED", createdAt: new Date().toISOString() }));
  await assertFails(setDoc(doc(representative, "businessDocumentSequences", "ZZ_PV_2030"), { lastSequence: 999 }));
  await assertFails(setDoc(doc(representative, "auditLogs", "FORGED"), { userId: "another-user", action: "Pharmacy Visit Completed", timestamp: new Date().toISOString() }));
  await assertFails(updateDoc(doc(representative, "pharmacies", "PH1"), { outstandingBalance: 999999 }));
  console.log("WP102_DIRECT_COMPLETION_MUTATIONS_DENIED=4/4_PASS");
} finally {
  await environment.cleanup();
}
