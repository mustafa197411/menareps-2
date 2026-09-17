import firebaseConfig from "./firebase-applet-config.json" with { type: "json" };
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, collection, getDocs, doc, getDoc } from "firebase/firestore";

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

  const dirSnap = await getDocs(collection(db, "deliveryOfficerDirectory"));
  console.log("Delivery officer directory count:", dirSnap.size);
  dirSnap.forEach(d => console.log("Dir Doc:", d.id, "=>", JSON.stringify(d.data())));

  const uDoc = await getDoc(doc(db, "users", "m6Fh80WOI1P4gEBNihu6lnSMoWd2"));
  console.log("User doc m6Fh80WOI1P4gEBNihu6lnSMoWd2 exists:", uDoc.exists());
  if (uDoc.exists()) {
    console.log("User doc data:", JSON.stringify(uDoc.data(), null, 2));
  }
}

run().catch(console.error).then(() => process.exit(0));
