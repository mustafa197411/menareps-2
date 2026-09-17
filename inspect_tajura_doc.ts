import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import firebaseConfig from "./firebase-applet-config.json" assert { type: "json" };

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

  await signInWithEmailAndPassword(auth, "test-user1@esnad.local", "123456");

  const phmDoc = await getDoc(doc(db, "pharmacies", "PHM-TAJOURA-A"));
  if (phmDoc.exists()) {
    console.log("PHM-TAJOURA-A Data:", JSON.stringify(phmDoc.data(), null, 2));
  } else {
    console.log("PHM-TAJOURA-A does not exist");
  }
}

run().catch(console.error);
