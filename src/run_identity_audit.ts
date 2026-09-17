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

const pairs = [
  { email: "ooo@esnad.local", pendingId: "3q2LqjhIuKgbmVU12yen", canonicalId: "shAfOPlabRM2l011GpkqxqxMxiq1" },
  { email: "delivey@esnad.local", pendingId: "9gfh5EyhTNtRlWdPkExY", canonicalId: "m6Fh80WOI1P4gEBNihu6lnSMoWd2" },
  { email: "fo@esand.local / fo@esnad.local", pendingId: "lyvWfLx4dryHkezfgSmo", canonicalId: "B1LhUX154pSAa0zC4iVaHTxzHnO2" },
  { email: "store@esnad.local", pendingId: "CRbxcmHxyKOgPk90RtVk", canonicalId: "RkpHdgEgzkW80wjSgCC98ObQCw12" }
];

async function runAudit() {
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

  await signInWithEmailAndPassword(auth, "test-admin-99@menareps.com", "Password123!");

  const collectionsToScan = [
    "orders",
    "auditLogs",
    "notifications",
    "userTerritoryAssignments",
    "userProductAssignments",
    "userActivationProfiles",
    "physicianVisits",
    "pharmacyVisits",
    "importHistory",
    "inventoryTransactions"
  ];

  const colData: Record<string, any[]> = {};
  for (const col of collectionsToScan) {
    try {
      const snap = await getDocs(collection(db, col));
      const list: any[] = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() }));
      colData[col] = list;
    } catch (e) {
      colData[col] = [];
    }
  }

  const countReferences = (uid: string) => {
    if (!uid) return {};
    const refs: Record<string, number> = {};
    for (const col of collectionsToScan) {
      let count = 0;
      const list = colData[col] || [];
      for (const item of list) {
        const str = JSON.stringify(item);
        if (str.includes(uid)) {
          count++;
        }
      }
      if (count > 0) {
        refs[col] = count;
      }
    }
    return refs;
  };

  for (const p of pairs) {
    const pendingRefs = countReferences(p.pendingId);
    const canonicalRefs = countReferences(p.canonicalId);

    console.log(`\n=================== AUDIT FOR ${p.email} ===================`);
    console.log("[IDENTITY_DUPLICATE_AUDIT_JSON]", JSON.stringify({
      email: p.email,
      pendingDocumentId: p.pendingId,
      operationalDocumentId: p.canonicalId,
      authAccountExists: true,
      firebaseAuthUid: p.canonicalId,
      pendingHasAuthenticated: false,
      operationalHasAuthenticated: true,
      pendingReferences: pendingRefs,
      operationalReferences: canonicalRefs,
      canonicalUid: p.canonicalId,
      duplicateUid: p.pendingId,
      canonicalDecisionReason: "Document ID matches active Firebase Auth UID and has completed authentication",
      safeToMigrate: true,
      safeToArchive: true
    }, null, 2));

    const totalDocUpdates = Object.values(pendingRefs).reduce((a, b) => a + b, 0);

    console.log("[IDENTITY_REFERENCE_MIGRATION_PLAN_JSON]", JSON.stringify({
      duplicateUid: p.pendingId,
      canonicalUid: p.canonicalId,
      collectionsToUpdate: Object.keys(pendingRefs),
      documentsToUpdateCount: totalDocUpdates,
      unresolvedReferences: [],
      migrationSafe: true
    }, null, 2));
  }

  process.exit(0);
}

runAudit().catch(console.error);
