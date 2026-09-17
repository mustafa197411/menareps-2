import fs from "node:fs";
import { assertFails, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";

const projectId = "demo-menareps-uat";
const environment = await initializeTestEnvironment({ projectId, firestore: { host: "127.0.0.1", port: 8089, rules: fs.readFileSync("firestore.rules", "utf8") } });
try {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "users", "synthetic-sales-rep"), { id: "synthetic-sales-rep", role: "Sales Representative", active: true, employmentStatus: "Active", loginAllowed: true, isDeleted: false });
  });
  const representative = environment.authenticatedContext("synthetic-sales-rep").firestore();
  await assertFails(setDoc(doc(representative, "orders", "FORGED-ORDER"), { id: "FORGED-ORDER", pharmacyId: "PHARMACY-X", salesRepUid: "synthetic-sales-rep", total: 1, status: "PENDING_FINANCE_REVIEW", stage: "FINANCE_REVIEW" }));
  console.log("WP98_ORDER_DIRECT_CREATE_DENIED=PASS");
} finally {
  await environment.cleanup();
}
