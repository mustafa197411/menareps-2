import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, doc, getDoc, collection, getDocs } from "firebase/firestore";
import firebaseConfig from "../firebase-applet-config.json" assert { type: "json" };

const config = {
  apiKey: firebaseConfig.apiKey,
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId,
  appId: firebaseConfig.appId
};

const exactPairs = [
  { email: "ooo@esnad.local", archivedId: "3q2LqjhIuKgbmVU12yen", canonicalId: "shAfOPlabRM2l011GpkqxqxMxiq1" },
  { email: "delivey@esnad.local", archivedId: "9gfh5EyhTNtRlWdPkExY", canonicalId: "m6Fh80WOI1P4gEBNihu6lnSMoWd2" },
  { email: "fo@esand.local", archivedId: "lyvWfLx4dryHkezfgSmo", canonicalId: "B1LhUX154pSAa0zC4iVaHTxzHnO2" },
  { email: "store@esnad.local", archivedId: "CRbxcmHxyKOgPk90RtVk", canonicalId: "RkpHdgEgzkW80wjSgCC98ObQCw12" }
];

async function runPart1() {
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

  await signInWithEmailAndPassword(auth, "test-admin-99@menareps.com", "Password123!");

  const verifiedPairs: any[] = [];
  let allValid = true;

  for (const p of exactPairs) {
    const archSnap = await getDoc(doc(db, "users", p.archivedId));
    const canSnap = await getDoc(doc(db, "users", p.canonicalId));

    const archData = archSnap.data() || {};
    const canData = canSnap.data() || {};

    const isValid = Boolean(
      archSnap.exists() &&
      canSnap.exists() &&
      archData.active === false &&
      archData.loginAllowed === false &&
      archData.identityStatus === "ARCHIVED_DUPLICATE" &&
      archData.duplicateOfUid === p.canonicalId &&
      canData.active === true &&
      canData.loginAllowed === true &&
      (canData.authLinked === true || canData.hasAuthenticated === true) &&
      canSnap.id === p.canonicalId
    );

    if (!isValid) allValid = false;

    verifiedPairs.push({
      email: p.email,
      archivedDocumentId: p.archivedId,
      canonicalDocumentId: p.canonicalId,
      archivedActive: archData.active ?? null,
      archivedLoginAllowed: archData.loginAllowed ?? null,
      archivedIsOperational: archData.isOperational ?? null,
      archivedIdentityStatus: archData.identityStatus || "",
      archivedDuplicateOfUid: archData.duplicateOfUid || "",
      canonicalActive: canData.active ?? null,
      canonicalAuthLinked: canData.authLinked ?? null,
      canonicalHasAuthenticated: canData.hasAuthenticated ?? null,
      canonicalUidField: canData.uid || canSnap.id,
      canonicalDocumentIdMatchesUid: canSnap.id === p.canonicalId,
      validHistoricalPair: isValid
    });
  }

  console.log("[IDENTITY_LIVE_PAIR_VERIFICATION_JSON]", JSON.stringify({
    pairs: verifiedPairs
  }, null, 2));

  if (!allValid) {
    console.error("Part 1 Verification failed. Halting.");
    process.exit(1);
  }

  process.exit(0);
}

runPart1().catch(console.error);
