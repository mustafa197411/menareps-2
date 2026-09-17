import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, collection, getDocs } from "firebase/firestore";
import firebaseConfig from "../firebase-applet-config.json" assert { type: "json" };

const config = {
  apiKey: firebaseConfig.apiKey,
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId,
  appId: firebaseConfig.appId
};

async function findFinanceUsers() {
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

  await signInWithEmailAndPassword(auth, "test-admin-99@menareps.com", "Password123!");

  const usersSnap = await getDocs(collection(db, "users"));
  usersSnap.forEach(d => {
    const u = d.data();
    if ((u.email || "").includes("fo") || (u.email || "").includes("finance")) {
      console.log(`Doc ID: ${d.id} | Email: ${u.email} | Role: ${u.role} | AuthLinked: ${u.authLinked || false} | HasAuth: ${u.hasAuthenticated || false}`);
    }
  });

  process.exit(0);
}

findFinanceUsers().catch(console.error);
