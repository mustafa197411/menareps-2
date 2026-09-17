import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, doc, deleteDoc, getDoc, getDocs, collection, query, where } from "firebase/firestore";
import firebaseConfig from "./firebase-applet-config.json" assert { type: "json" };

const config = {
  apiKey: firebaseConfig.apiKey,
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId,
  appId: firebaseConfig.appId
};

async function run() {
  console.log("=== REMOVING JORDAN ASSIGNMENT FOR TEST-USER1 ===");
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

  // Try signing in as admin or test-user1
  try {
    await signInWithEmailAndPassword(auth, "shwayat.mustafa@esnad.local", "123456");
    console.log("Signed in as shwayat.mustafa@esnad.local");
  } catch (e) {
    console.log("Could not sign in as shwayat, trying admin@esnad.local...");
    try {
      await signInWithEmailAndPassword(auth, "admin@esnad.local", "123456");
    } catch (e2) {
      console.log("Signing in as test-user1@esnad.local");
      await signInWithEmailAndPassword(auth, "test-user1@esnad.local", "123456");
    }
  }

  const targetDocId = "TA_cQt7jjLOaHPgBmGCWzdjZm3pojo2_A-678641";
  console.log("Attempting to delete document:", targetDocId);
  try {
    await deleteDoc(doc(db, "userTerritoryAssignments", targetDocId));
    console.log("SUCCESSFULLY DELETED Jordan assignment:", targetDocId);
  } catch (err: any) {
    console.error("Deletion failed:", err.message);
  }

  // Audit remaining assignments for test-user1
  const uid = "cQt7jjLOaHPgBmGCWzdjZm3pojo2";
  const q = query(collection(db, "userTerritoryAssignments"), where("userId", "==", uid));
  const qSnap = await getDocs(q);
  console.log("Remaining userTerritoryAssignments count:", qSnap.size);
  qSnap.forEach(d => {
    console.log("Assignment:", d.id, "| territoryName:", d.data().territoryName, "| countryId:", d.data().countryId, "| status:", d.data().status);
  });
}

run().catch(console.error);
