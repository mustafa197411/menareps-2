import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, collection, getDocs, query, where, doc, getDoc, updateDoc, deleteDoc, setDoc } from "firebase/firestore";
import firebaseConfig from "./firebase-applet-config.json" assert { type: "json" };

const config = {
  apiKey: firebaseConfig.apiKey,
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId,
  appId: firebaseConfig.appId
};

async function run() {
  console.log("=== CHECKING AND ALIGNING TEST-USER1 ASSIGNMENTS ===");
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

  await signInWithEmailAndPassword(auth, "test-user1@esnad.local", "123456");
  const uid = "cQt7jjLOaHPgBmGCWzdjZm3pojo2";

  // Check user document
  const userRef = doc(db, "users", uid);
  const userSnap = await getDoc(userRef);
  if (userSnap.exists()) {
    console.log("User Doc Data:", JSON.stringify(userSnap.data(), null, 2));
  }

  // Query userTerritoryAssignments
  const q = query(collection(db, "userTerritoryAssignments"), where("userId", "==", uid));
  const qSnap = await getDocs(q);
  console.log("userTerritoryAssignments count:", qSnap.size);
  qSnap.forEach(d => {
    console.log("Assignment:", d.id, JSON.stringify(d.data(), null, 2));
  });
}

run().catch(console.error);
