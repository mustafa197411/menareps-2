import firebaseConfig from "./firebase-applet-config.json" assert { type: "json" };
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, collection, getDocs, query, where, doc, getDoc } from "firebase/firestore";

const config = {
  apiKey: firebaseConfig.apiKey,
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId,
  appId: firebaseConfig.appId
};

const app = getApps().length === 0 ? initializeApp(config) : getApp();
const auth = getAuth(app);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function run() {
  await signInWithEmailAndPassword(auth, "test-admin-99@menareps.com", "Password123!");

  console.log("\n=== FO DOCUMENT 1: B1LhUX154pSAa0zC4iVaHTxzHnO2 ===");
  const doc1 = await getDoc(doc(db, "users", "B1LhUX154pSAa0zC4iVaHTxzHnO2"));
  console.log("Exists:", doc1.exists(), JSON.stringify(doc1.data(), null, 2));

  console.log("\n=== FO DOCUMENT 2: lyvWfLx4dryHkezfgSmo ===");
  const doc2 = await getDoc(doc(db, "users", "lyvWfLx4dryHkezfgSmo"));
  console.log("Exists:", doc2.exists(), JSON.stringify(doc2.data(), null, 2));

  console.log("\n=== FO DOCUMENT AT AUTH UID: aRSKSRDzldSeL7P9kPShjwCYday1 ===");
  const doc3 = await getDoc(doc(db, "users", "aRSKSRDzldSeL7P9kPShjwCYday1"));
  console.log("Exists:", doc3.exists(), JSON.stringify(doc3.data(), null, 2));

  console.log("\n=== OOO DOCUMENT: MbE6J5DfRpkZ39M16UeO ===");
  const oooDoc = await getDoc(doc(db, "users", "MbE6J5DfRpkZ39M16UeO"));
  console.log("Exists:", oooDoc.exists(), JSON.stringify(oooDoc.data(), null, 2));

  // Check all users for ooo@esand.local
  const oooQuery = query(collection(db, "users"), where("email", "==", "ooo@esand.local"));
  const oooSnap = await getDocs(oooQuery);
  console.log(`\n=== OOO QUERY COUNT: ${oooSnap.size} ===`);
  oooSnap.forEach(d => console.log(d.id, "=>", JSON.stringify(d.data(), null, 2)));

  // Check userActivationProfiles for ooo@esand.local
  const oooAct = await getDoc(doc(db, "userActivationProfiles", "ooo-esand-local"));
  console.log("\n=== OOO ACTIVATION PROFILE ===");
  console.log("Exists:", oooAct.exists(), JSON.stringify(oooAct.data(), null, 2));

  // Check userActivationProfiles for fo@esand.local
  const foAct = await getDoc(doc(db, "userActivationProfiles", "fo-esand-local"));
  console.log("\n=== FO ACTIVATION PROFILE ===");
  console.log("Exists:", foAct.exists(), JSON.stringify(foAct.data(), null, 2));
}

run().catch(console.error).then(() => process.exit(0));
