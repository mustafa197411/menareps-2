import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import firebaseConfig from "../firebase-applet-config.json" assert { type: "json" };

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

  console.log("Signing in...");
  await signInWithEmailAndPassword(auth, "test-admin-99@menareps.com", "Password123!");
  console.log("Signed in successfully.");

  const pIds = ["PROD-2609", "PROD-2589", "PROD-9229"];
  for (const pid of pIds) {
    const snap = await getDoc(doc(db, "products", pid));
    if (snap.exists()) {
      console.log(`Product ${pid} details:`, JSON.stringify(snap.data(), null, 2));
    } else {
      console.log(`Product ${pid} does not exist`);
    }
  }

  const userSnap = await getDoc(doc(db, "users", "TXiVgAk78XSViCB5uSSmuuxfY9n2"));
  const user = userSnap.data();
  if (user) {
    console.log("Does representative have PROD-2609?", user.products.includes("PROD-2609"));
    console.log("Does representative have PROD-2589?", user.products.includes("PROD-2589"));
    console.log("Does representative have PROD-9229?", user.products.includes("PROD-9229"));
    // Print all representative products that might have these sub-strings
    console.log("Representative products containing 'Acne' or 'Sunscreen' or 'Hyperpigmentation':");
    const filtered = user.products.filter((p: string) => 
      p.toLowerCase().includes("acne") || 
      p.toLowerCase().includes("sunscreen") || 
      p.toLowerCase().includes("hyperpig")
    );
    console.log(JSON.stringify(filtered, null, 2));
  }
}

run().catch(console.error);
