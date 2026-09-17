import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, doc, getDoc, updateDoc } from "firebase/firestore";
import * as fs from "fs";

const config = JSON.parse(fs.readFileSync("firebase-applet-config.json", "utf8"));

const app = initializeApp(config);
const auth = getAuth(app);
const db = getFirestore(app, "ai-studio-menarepscrmdemos-82d41216-0d5d-449a-a9d4-b65e790e275c");

async function main() {
  await signInWithEmailAndPassword(auth, "test-admin-99@menareps.com", "Password123!");
  console.log("Authenticated as Admin");

  const smDocRef = doc(db, "users", "RkpHdgEgzkW80wjSgCC98ObQCw12");
  const smSnap = await getDoc(smDocRef);

  if (!smSnap.exists()) {
    console.error("Store manager doc RkpHdgEgzkW80wjSgCC98ObQCw12 not found!");
    process.exit(1);
  }

  const currentData = smSnap.data();
  console.log("Current Store Manager doc data:", currentData);

  // Canonical manager ID for fm@esand.local (Finance Manager Hisham) is DWiCv6fkv0AKfLRUSi02
  const canonicalManagerId = "DWiCv6fkv0AKfLRUSi02";
  const canonicalManagerEmail = "fm@esand.local";

  await updateDoc(smDocRef, {
    managerId: canonicalManagerId,
    managerEmail: canonicalManagerEmail,
    updatedAt: new Date().toISOString(),
    updatedBy: auth.currentUser?.uid || "SYSTEM"
  });

  console.log(`Updated users/RkpHdgEgzkW80wjSgCC98ObQCw12 with managerId: ${canonicalManagerId}`);

  // Re-read document to verify
  const updatedSnap = await getDoc(smDocRef);
  console.log("Updated Store Manager doc data:", updatedSnap.data());
  process.exit(0);
}

main().catch((err) => {
  console.error("Error repairing store manager profile:", err);
  process.exit(1);
});
