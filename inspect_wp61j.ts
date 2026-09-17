import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, collection, getDocs, doc, getDoc, query, where } from "firebase/firestore";
import firebaseConfig from "./firebase-applet-config.json" assert { type: "json" };

const config = {
  apiKey: firebaseConfig.apiKey,
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId,
  appId: firebaseConfig.appId
};

async function runAudit() {
  console.log("=== STARTING WP6.1J CLIENT AUTHENTICATED AUDIT ===");
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

  await signInWithEmailAndPassword(auth, "test-user1@esnad.local", "123456");
  console.log("Signed in successfully as test-user1@esnad.local");

  // 1. Audit Pharmacies in assigned area LY-WEST-TRE2 and LY-WEST-TRE3
  console.log("\n--- PHARMACIES IN LY-WEST-TRE2 ---");
  const p1Snap = await getDocs(query(collection(db, "pharmacies"), where("areaId", "==", "LY-WEST-TRE2")));
  console.log("Pharmacies in LY-WEST-TRE2 count:", p1Snap.size);
  p1Snap.forEach(d => {
    const data = d.data();
    console.log("Pharmacy:", d.id, "| Name:", data.name || data.nameEn, "| areaId:", data.areaId, "| verifiedGpsStatus:", data.verifiedGpsStatus, "| verifiedGps:", JSON.stringify(data.verifiedGps));
  });

  console.log("\n--- PHARMACIES IN LY-WEST-TRE3 ---");
  const p2Snap = await getDocs(query(collection(db, "pharmacies"), where("areaId", "==", "LY-WEST-TRE3")));
  console.log("Pharmacies in LY-WEST-TRE3 count:", p2Snap.size);
  p2Snap.forEach(d => {
    const data = d.data();
    console.log("Pharmacy:", d.id, "| Name:", data.name || data.nameEn, "| areaId:", data.areaId, "| verifiedGpsStatus:", data.verifiedGpsStatus, "| verifiedGps:", JSON.stringify(data.verifiedGps));
  });

  // 2. Audit pharmacyVisits for test-user1
  console.log("\n--- VISITS FOR test-user1 ---");
  const vSnap = await getDocs(query(collection(db, "pharmacyVisits"), where("repId", "==", "cQt7jjLOaHPgBmGCWzdjZm3pojo2")));
  console.log("Total pharmacyVisits for rep count:", vSnap.size);
  vSnap.forEach(d => console.log("Visit:", d.id, "| status:", d.data().status, "| pharmacyId:", d.data().pharmacyId, "| orderId:", d.data().orderId));

  // 3. Audit orders for test-user1
  console.log("\n--- ORDERS FOR test-user1 ---");
  const oSnap = await getDocs(query(collection(db, "orders"), where("salesRep", "==", "cQt7jjLOaHPgBmGCWzdjZm3pojo2")));
  console.log("Total orders for rep count:", oSnap.size);
  oSnap.forEach(d => console.log("Order:", d.id, "| total:", d.data().total, "| notes:", d.data().notes, "| status:", d.data().status));

  // 4. Audit Countries
  console.log("\n--- COUNTRIES ---");
  const cSnap = await getDocs(collection(db, "countries"));
  cSnap.forEach(d => console.log("Country:", d.id, JSON.stringify(d.data(), null, 2)));

  console.log("\n=== AUDIT COMPLETE ===");
}

runAudit().catch(console.error);
