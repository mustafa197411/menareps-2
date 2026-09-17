import firebaseConfig from "./firebase-applet-config.json" with { type: "json" };
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
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
const auth = getAuth(app);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function run() {
  await signInWithEmailAndPassword(auth, "test-admin-99@menareps.com", "Password123!");
  console.log("Admin authenticated!");

  const uDoc = await getDoc(doc(db, "users", "cQt7jjLOaHPgBmGCWzdjZm3pojo2"));
  console.log("User doc cQt7jjLOaHPgBmGCWzdjZm3pojo2 exists:", uDoc.exists());
  if (uDoc.exists()) {
    console.log("cQt7jjLOaHPgBmGCWzdjZm3pojo2 data:", JSON.stringify(uDoc.data(), null, 2));
  } else {
    console.log("No user document found with ID cQt7jjLOaHPgBmGCWzdjZm3pojo2!");
  }

  const qUser = query(collection(db, "users"), where("email", "==", "test-user1@esnad.local"));
  const uSnap = await getDocs(qUser);
  console.log("User query count for test-user1@esnad.local:", uSnap.size);
  uSnap.forEach(d => console.log(d.id, "=>", JSON.stringify(d.data(), null, 2)));

  const knownDoc = await getDoc(doc(db, "pharmacies", "PHM-1784317568015-676"));
  console.log("PHM-1784317568015-676 exists:", knownDoc.exists());
  if (knownDoc.exists()) {
    const data = knownDoc.data();
    console.log("Data:", JSON.stringify({
      id: data.id,
      name: data.name,
      areaId: data.areaId,
      areaIdType: typeof data.areaId,
      areaIdLength: data.areaId ? data.areaId.length : 0,
      areaIdCharacterCodes: data.areaId ? Array.from(data.areaId).map(c => c.charCodeAt(0)) : [],
      active: data.active,
      status: data.status,
      isDeleted: data.isDeleted
    }, null, 2));
  }
}

run().catch(console.error).then(() => process.exit(0));
