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
  await signInWithEmailAndPassword(auth, "test-admin-99@menareps.com", "Password123!");
  console.log("Admin authenticated!");

  const snap = await getDocs(collection(db, "orders"));
  console.log("Total orders in Firestore:", snap.size);

  const assignedOrders = [];
  const allOrdersSummary = [];

  snap.forEach((docSnap) => {
    const data = docSnap.data();
    const id = docSnap.id;
    const delUid = data.deliveryOfficerUid || data.deliveryOfficerId || data.assignedDeliveryOfficerUid;
    allOrdersSummary.push({
      id,
      displayNumber: data.displayNumber || data.orderNumber || id,
      status: data.status,
      stage: data.stage,
      deliveryOfficerUid: data.deliveryOfficerUid || null,
      assignedDeliveryOfficerUid: data.assignedDeliveryOfficerUid || null,
      deliveryOfficerId: data.deliveryOfficerId || null,
      deliveryOfficerName: data.deliveryOfficerName || null
    });

    if (delUid) {
      assignedOrders.push({
        id,
        path: docSnap.ref.path,
        data
      });
    }
  });

  console.log("Assigned orders count:", assignedOrders.length);
  console.log("All orders summary:", JSON.stringify(allOrdersSummary, null, 2));

  for (const o of assignedOrders) {
    console.log("--- ASSIGNED ORDER ---");
    console.log("Path:", o.path);
    console.log("Full Data:", JSON.stringify(o.data, null, 2));
  }
}

run().catch(console.error).then(() => process.exit(0));
