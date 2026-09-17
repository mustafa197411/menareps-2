import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, collection, getDocs } from "firebase/firestore";
import firebaseConfig from "../firebase-applet-config.json" assert { type: "json" };
import * as fs from "fs";

const config = {
  apiKey: firebaseConfig.apiKey,
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId,
  appId: firebaseConfig.appId
};

async function run() {
  const logLines: string[] = [];
  function log(msg: string) {
    console.log(msg);
    logLines.push(msg);
  }

  log("Initializing Client Firebase...");
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

  log("Signing in as Admin...");
  await signInWithEmailAndPassword(auth, "test-admin-99@menareps.com", "Password123!");
  log("Successfully signed in!");

  // 1. Inspect importHistory
  log("\n--- IMPORT HISTORY ---");
  try {
    const impSnap = await getDocs(collection(db, "importHistory"));
    log(`Total importHistory items: ${impSnap.size}`);
    impSnap.forEach(doc => {
      const data = doc.data();
      log(` - Doc: ${doc.id} | module: ${data.module} | fileName: ${data.fileName} | status: ${data.status} | recordCount: ${data.recordCount || 0} | importedBy: ${data.importedBy} | importedAt: ${data.importedAt}`);
    });
  } catch (e: any) {
    log(`Failed to fetch importHistory: ${e.message || e}`);
  }

  // 2. Inspect transactionHistory
  log("\n--- TRANSACTION HISTORY ---");
  try {
    const txsSnap = await getDocs(collection(db, "transactionHistory"));
    log(`Total transactionHistory items: ${txsSnap.size}`);
    txsSnap.forEach(doc => {
      const data = doc.data();
      log(` - Doc: ${doc.id} | module: ${data.module || data.template} | status: ${data.status} | rows: ${data.rowCount || data.rowsCount || 0} | type: ${data.type || data.importMode || "N/A"} | isTestData: ${data.isTestData || false}`);
    });
  } catch (e: any) {
    log(`Failed to fetch transactionHistory: ${e.message || e}`);
  }

  // 3. Inspect all pharmacies
  log("\n--- PHARMACIES PREVIEW ---");
  try {
    const pharSnap = await getDocs(collection(db, "pharmacies"));
    log(`Total pharmacies in DB: ${pharSnap.size}`);
    let matchCount = 0;
    pharSnap.forEach(doc => {
      const d = doc.data();
      matchCount++;
      log(` - Pharmacy ID: ${doc.id} | Name: ${d.name} | Area: ${d.area || d.territory} | AreaId: ${d.areaId} | BatchId: ${d.importBatchId || "N/A"} | isTestData: ${d.isTestData || false}`);
    });
    log(`Total pharmacies processed: ${matchCount}`);
  } catch (e: any) {
    log(`Failed to fetch pharmacies: ${e.message || e}`);
  }

  fs.writeFileSync("src/inspect-imports-output.txt", logLines.join("\n"));
  log("\nOutput written to src/inspect-imports-output.txt successfully!");
}

run().catch(e => {
  const errStr = e.stack || String(e);
  console.error(errStr);
  fs.writeFileSync("src/inspect-imports-output.txt", `CRASHED:\n${errStr}`);
});
