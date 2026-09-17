import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import firebaseConfig from "../firebase-applet-config.json" assert { type: "json" };

async function run() {
  console.log("Initializing Firebase Admin...");
  const app = initializeApp({
    projectId: firebaseConfig.projectId
  });

  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
  console.log("Database initialized successfully!");

  // Let's query products limit 3
  const productsSnap = await db.collection("products").limit(3).get();
  console.log(`Found ${productsSnap.size} products.`);
  productsSnap.forEach(doc => {
    console.log(`Product: ${doc.id} - ${doc.data().name} (${doc.data().brand})`);
  });

  // Let's query areas limit 3
  const areasSnap = await db.collection("areas").limit(3).get();
  console.log(`Found ${areasSnap.size} areas.`);
  areasSnap.forEach(doc => {
    console.log(`Area: ${doc.id} - ${doc.data().name} in City: ${doc.data().cityName}`);
  });
}

run().catch(console.error);
