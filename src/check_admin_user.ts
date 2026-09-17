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

async function checkAdminUser() {
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

  const cred = await signInWithEmailAndPassword(auth, "test-admin-99@menareps.com", "Password123!");
  console.log("Auth UID:", cred.user.uid);
  console.log("Auth Email:", cred.user.email);

  const userSnap = await getDoc(doc(db, "users", cred.user.uid));
  if (userSnap.exists()) {
    console.log("User Doc Data:", userSnap.data());
  } else {
    console.log("No user doc found for UID:", cred.user.uid);
  }

  process.exit(0);
}

checkAdminUser().catch(console.error);
