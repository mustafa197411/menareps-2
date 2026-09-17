import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import firebaseConfig from "../firebase-applet-config.json" assert { type: "json" };

const config = {
  apiKey: firebaseConfig.apiKey,
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId,
  appId: firebaseConfig.appId
};

async function run() {
  console.log("Initializing Client Firebase...");
  const app = initializeApp(config);
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

  const docRef = doc(db, "users", "GQynj6LObmfQPz6PbNR9poANfXv1");
  console.log("Fetching bypass user document...");
  const snap = await getDoc(docRef);
  if (snap.exists()) {
    console.log("Bypass user found:", snap.data());
  } else {
    console.log("Bypass user document does not exist.");
  }
}

run().catch(console.error);
