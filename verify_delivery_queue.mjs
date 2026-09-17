import firebaseConfig from "./firebase-applet-config.json" with { type: "json" };
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, collection, getDocs, query, where } from "firebase/firestore";

const config = {
  apiKey: firebaseConfig.apiKey,
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId,
  storageBucket: firebaseConfig.storageBucket,
  messagingSenderId: firebaseConfig.messagingSenderId,
  appId: firebaseConfig.appId
};

const app = getApps().length === 0 ? initializeApp(config) : getApp();
const auth = getAuth(app);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function run() {
  console.log("=== STARTING DELIVERY QUEUE UAT & SCOPED QUERY VERIFICATION ===");

  // 1. Authenticate as Delivery Officer
  const userCred = await signInWithEmailAndPassword(auth, "delivey@esnad.local", "123456");
  const authUid = userCred.user.uid;
  console.log("Delivery Officer authenticated! Auth UID:", authUid);

  if (authUid !== "m6Fh80WOI1P4gEBNihu6lnSMoWd2") {
    throw new Error(`CRITICAL: Auth UID ${authUid} does not match canonical UID m6Fh80WOI1P4gEBNihu6lnSMoWd2!`);
  }

  // 2. Execute Scoped Firestore Query as Delivery Officer
  const q = query(collection(db, "orders"), where("deliveryOfficerUid", "==", authUid));
  const snap = await getDocs(q);

  console.log(`Scoped query successful! Found ${snap.size} assigned order(s) for Delivery Officer.`);

  const fetchedOrders = [];
  snap.forEach((d) => {
    fetchedOrders.push({
      id: d.id,
      path: d.ref.path,
      data: d.data()
    });
  });

  for (const o of fetchedOrders) {
    console.log("-----------------------------------------");
    console.log("Assigned Order Doc Path:", o.path);
    console.log("Order Display Number:", o.data.displayNumber || o.data.orderNumber || o.id);
    console.log("Status:", o.data.status);
    console.log("DeliveryOfficerUid:", o.data.deliveryOfficerUid);
    console.log("DeliveryAssignmentStatus:", o.data.deliveryAssignmentStatus);
  }

  console.log("=== VERIFICATION COMPLETED SUCCESSFULLY ===");
}

run().catch(console.error).then(() => process.exit(0));
