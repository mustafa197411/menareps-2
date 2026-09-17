import firebaseConfig from "./firebase-applet-config.json" with { type: "json" };
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, collection, getDocs, query, where, doc, getDoc } from "firebase/firestore";

const config = {
  apiKey: firebaseConfig.apiKey,
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId,
  storageBucket: firebaseConfig.storageBucket,
  messagingSenderId: firebaseConfig.messagingSenderId,
  appId: firebaseConfig.appId
};

const app = getApps().length === 0 ? initializeApp(config) : getApp();
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function check() {
  console.log("Checking databaseId:", firebaseConfig.firestoreDatabaseId);
  const userDoc = await getDoc(doc(db, "users", "cQt7jjLOaHPgBmGCWzdjZm3pojo2"));
  console.log("User doc cQt7jjLOaHPgBmGCWzdjZm3pojo2 exists:", userDoc.exists());
  if (userDoc.exists()) {
    console.log("User data:", JSON.stringify(userDoc.data(), null, 2));
  }

  const knownDoc = await getDoc(doc(db, "pharmacies", "PHM-1784317568015-676"));
  console.log("PHM-1784317568015-676 exists:", knownDoc.exists());
  if (knownDoc.exists()) {
    console.log("Known doc data:", JSON.stringify(knownDoc.data(), null, 2));
  }

  const areaQuery = query(collection(db, "pharmacies"), where("areaId", "==", "LY-WEST-TRE2"));
  const areaSnap = await getDocs(areaQuery);
  console.log("Area query (LY-WEST-TRE2) count:", areaSnap.size);
  areaSnap.forEach(d => console.log(d.id, d.data().areaId, d.data().name));

  const allSnap = await getDocs(collection(db, "pharmacies"));
  console.log("Total pharmacies count in database:", allSnap.size);
  allSnap.forEach(d => {
    const data = d.data();
    console.log(d.id, "areaId:", JSON.stringify(data.areaId), "territory:", JSON.stringify(data.territory), "name:", data.name);
  });
}

check().catch(console.error).then(() => process.exit(0));
