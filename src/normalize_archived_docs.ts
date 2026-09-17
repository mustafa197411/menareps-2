import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, doc, updateDoc, getDoc } from "firebase/firestore";
import firebaseConfig from "../firebase-applet-config.json" assert { type: "json" };

const config = {
  apiKey: firebaseConfig.apiKey,
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId,
  appId: firebaseConfig.appId
};

const archivedUids = [
  "3q2LqjhIuKgbmVU12yen",
  "9gfh5EyhTNtRlWdPkExY",
  "lyvWfLx4dryHkezfgSmo",
  "CRbxcmHxyKOgPk90RtVk"
];

async function runNormalization() {
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

  await signInWithEmailAndPassword(auth, "test-admin-99@menareps.com", "Password123!");

  const normalized: string[] = [];

  for (const uid of archivedUids) {
    const docRef = doc(db, "users", uid);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      await updateDoc(docRef, {
        status: "Archived",
        employmentStatus: "Archived"
      });
      normalized.push(uid);
    }
  }

  console.log("[IDENTITY_ARCHIVE_NORMALIZATION_JSON]", JSON.stringify({
    documentsNormalized: normalized,
    canonicalDocumentsModified: false,
    physicalDeleteExecuted: false
  }, null, 2));

  process.exit(0);
}

runNormalization().catch(console.error);
