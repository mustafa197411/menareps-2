import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import firebaseConfig from "../firebase-applet-config.json" assert { type: "json" };

async function inspectRealOrders() {
  const app = initializeApp({
    projectId: firebaseConfig.projectId
  });
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

  const ordersSnap = await db.collection("orders").get();
  console.log(`Total orders in Firestore database (${firebaseConfig.firestoreDatabaseId}): ${ordersSnap.size}`);

  const orders: any[] = [];
  ordersSnap.forEach(doc => {
    orders.push({ id: doc.id, ...doc.data() });
  });

  orders.sort((a,b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  console.log("\n--- ORDERS LIST IN FIRESTORE ---");
  orders.slice(0, 10).forEach(o => {
    console.log(`ID: ${o.id} | DisplayNo: ${o.displayNumber || o.orderNumber || o.id} | Status: ${o.status} | Pharmacy: ${o.pharmacyName || o.pharmacyId} | Total: ${o.totalAmount || o.total}`);
  });
}

inspectRealOrders().catch(console.error);
