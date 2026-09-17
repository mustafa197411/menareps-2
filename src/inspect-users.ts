import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import firebaseConfig from "../firebase-applet-config.json" assert { type: "json" };

async function run() {
  console.log("Initializing Firebase Admin...");
  const app = initializeApp({
    projectId: firebaseConfig.projectId
  });

  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
  console.log("Database initialized. Fetching users...");

  const snap = await db.collection("users").get();
  console.log(`Total users in Firestore: ${snap.size}`);
  snap.forEach(doc => {
    const d = doc.data();
    console.log(`User Document ID: ${doc.id}`);
    console.log(` - Name: ${d.name}`);
    console.log(` - Email: ${d.email}`);
    console.log(` - Role: ${d.role}`);
    console.log(` - Active: ${d.active}`);
    console.log(` - linkedToUid: ${d.linkedToUid}`);
    console.log(` - areaIds: ${JSON.stringify(d.areaIds)}`);
    console.log(` - products: ${JSON.stringify(d.products)}`);
  });

  console.log("\nFetching userTerritoryAssignments...");
  const terrSnap = await db.collection("userTerritoryAssignments").get();
  console.log(`Total assignments: ${terrSnap.size}`);
  terrSnap.forEach(doc => {
    console.log(`Assignment: ${doc.id} => ${JSON.stringify(doc.data())}`);
  });

  console.log("\nFetching userProductAssignments...");
  const prodSnap = await db.collection("userProductAssignments").get();
  console.log(`Total product assignments: ${prodSnap.size}`);
  prodSnap.forEach(doc => {
    console.log(`Product Assignment: ${doc.id} => ${JSON.stringify(doc.data())}`);
  });
}

run().catch(console.error);
