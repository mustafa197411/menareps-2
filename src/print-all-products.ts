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
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

  await signInWithEmailAndPassword(auth, "test-admin-99@menareps.com", "Password123!");

  const productsSnap = await getDocs(collection(db, "products"));
  let out = "ID | SKU | Name | IsActive (data.isActive) | Active (data.active) | rawData\n";
  out += "=========================================================================\n";

  const products: any[] = [];
  productsSnap.forEach(doc => {
    const data = doc.data();
    products.push({ id: doc.id, ...data });
  });

  products.sort((a, b) => {
    const numA = parseInt(a.id) || 0;
    const numB = parseInt(b.id) || 0;
    return numA - numB;
  });

  products.forEach(p => {
    out += `${p.id} | ${p.sku || p.SKU || "N/A"} | ${p.name} | ${p.isActive !== undefined ? p.isActive : "N/A"} | ${p.active !== undefined ? p.active : "N/A"}\n`;
  });

  fs.writeFileSync("products-inspection.txt", out);
  console.log("Written products-inspection.txt successfully!");
  process.exit(0);
}

run().catch(console.error);
