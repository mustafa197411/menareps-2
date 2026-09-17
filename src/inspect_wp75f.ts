import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, doc, getDoc, collection, getDocs } from "firebase/firestore";
import firebaseConfig from "../firebase-applet-config.json" assert { type: "json" };

const config = {
  apiKey: firebaseConfig.apiKey,
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId,
  appId: firebaseConfig.appId
};

async function run() {
  console.log("Initializing Client Firebase...");
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

  console.log("Signing in as shwayat.mustafa@gmail.com...");
  const userCredential = await signInWithEmailAndPassword(auth, "shwayat.mustafa@gmail.com", "123456");
  console.log("Successfully signed in as Super Admin!");

  // PART 1: Audit target order
  const orderId = "ORD_PV2_cQt7jjLOaHPgBmGCWzdjZm3pojo2_pv_draft_1785354660157_125qw";
  const orderRef = doc(db, "orders", orderId);
  const orderSnap = await getDoc(orderRef);

  if (orderSnap.exists()) {
    const data = orderSnap.data();
    console.log("\n[WP75F_TRANSITION_PERSISTENCE_JSON]");
    console.log(JSON.stringify({
      orderId,
      databaseId: firebaseConfig.firestoreDatabaseId,
      statusInFirestore: data.status,
      stageInFirestore: data.stage,
      financeApprovedAt: data.financeApprovedAt || null,
      financeApprovedByUid: data.financeApprovedByUid || null,
      updatedAt: data.updatedAt || null,
      actualPersistenceCertified: data.status !== "PENDING_FINANCE_REVIEW"
    }, null, 2));
  } else {
    console.log(`Order ${orderId} not found directly, checking recent orders in collection...`);
    const snap = await getDocs(collection(db, "orders"));
    console.log(`Total orders in DB: ${snap.size}`);
    snap.forEach(d => {
      console.log(`Order: ${d.id} => status: ${d.data().status}`);
    });
  }

  // Audit delivery identities in users collection
  console.log("\nAuditing Delivery Officer Users...");
  const userSnap = await getDocs(collection(db, "users"));
  userSnap.forEach(d => {
    const u = d.data();
    if (u.email === "delivey@esnad.local" || d.id === "9gfh5EyhTNtRlWdPkExY" || d.id === "m6Fh80WOI1P4gEBNihu6lnSMoWd2") {
      console.log(`User Doc ID: ${d.id} | Email: ${u.email} | Name: ${u.name || u.fullName} | Active: ${u.active} | authLinked: ${u.authLinked} | lastLoginAt: ${u.lastLoginAt}`);
    }
  });
}

run().catch(console.error);
