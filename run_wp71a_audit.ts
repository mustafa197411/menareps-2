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

  console.log("\n=== CHECKING USER ACTIVATION PROFILES ===");
  const actSnap = await getDocs(collection(db, "userActivationProfiles"));
  actSnap.forEach(d => {
    const data = d.data();
    if (data.email && (data.email.includes("fo") || data.email.includes("ooo") || data.email.includes("esand"))) {
      console.log(`Activation Profile ID: ${d.id}`);
      console.log(JSON.stringify(data, null, 2));
    }
  });

  console.log("\n=== CHECKING USER TERRITORY ASSIGNMENTS ===");
  const terrSnap = await getDocs(collection(db, "userTerritoryAssignments"));
  terrSnap.forEach(d => {
    const data = d.data();
    if (data.userId === "B1LhUX154pSAa0zC4iVaHTxzHnO2" || data.userId === "lyvWfLx4dryHkezfgSmo" || data.userId === "MbE6J5DfRpkZ39M16UeO" || data.userId === "aRSKSRDzldSeL7P9kPShjwCYday1" || data.userEmail?.includes("fo@esand.local") || data.userEmail?.includes("ooo@esand.local")) {
      console.log(`Territory Assignment ID: ${d.id}`);
      console.log(JSON.stringify(data, null, 2));
    }
  });

  console.log("\n=== CHECKING ORDERS ASSIGNED/REVIEWED ===");
  const ordersSnap = await getDocs(collection(db, "orders"));
  ordersSnap.forEach(d => {
    const data = d.data();
    if (JSON.stringify(data).includes("fo@esand.local") || JSON.stringify(data).includes("ooo@esand.local") || JSON.stringify(data).includes("B1LhUX154pSAa0zC4iVaHTxzHnO2") || JSON.stringify(data).includes("lyvWfLx4dryHkezfgSmo") || JSON.stringify(data).includes("MbE6J5DfRpkZ39M16UeO")) {
      console.log(`Order ID: ${d.id}`);
      console.log(JSON.stringify(data, null, 2));
    }
  });

  console.log("\n=== CHECKING AUDIT LOGS / REFERENCES ===");
  const auditSnap = await getDocs(collection(db, "auditLedger"));
  auditSnap.forEach(d => {
    const data = d.data();
    if (JSON.stringify(data).includes("fo@esand.local") || JSON.stringify(data).includes("ooo@esand.local")) {
      console.log(`Audit ID: ${d.id}`);
      console.log(JSON.stringify(data, null, 2));
    }
  });

  // Try signing in as fo@esand.local and ooo@esand.local to get their Auth UIDs
  console.log("\n=== SIGNING IN AS FO & OOO TO CONFIRM AUTH UID ===");
  try {
    const foCredential = await signInWithEmailAndPassword(auth, "fo@esand.local", "Password123!");
    console.log(`fo@esand.local Auth UID: ${foCredential.user.uid}`);
  } catch (e: any) {
    console.log("fo@esand.local signin with Password123! error:", e.message);
    try {
      const foCredential = await signInWithEmailAndPassword(auth, "fo@esand.local", "123456");
      console.log(`fo@esand.local Auth UID (with 123456): ${foCredential.user.uid}`);
    } catch (e2: any) {
      console.log("fo@esand.local signin with 123456 error:", e2.message);
    }
  }

  try {
    const oooCredential = await signInWithEmailAndPassword(auth, "ooo@esand.local", "Password123!");
    console.log(`ooo@esand.local Auth UID: ${oooCredential.user.uid}`);
  } catch (e: any) {
    console.log("ooo@esand.local signin with Password123! error:", e.message);
    try {
      const oooCredential = await signInWithEmailAndPassword(auth, "ooo@esand.local", "123456");
      console.log(`ooo@esand.local Auth UID (with 123456): ${oooCredential.user.uid}`);
    } catch (e2: any) {
      console.log("ooo@esand.local signin with 123456 error:", e2.message);
    }
  }
}

run().catch(console.error).then(() => process.exit(0));
