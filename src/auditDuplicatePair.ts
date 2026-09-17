import { db } from "./lib/firebase";
import { collection, query, where, getDocs, doc, getDoc } from "firebase/firestore";

async function auditDuplicatePair() {
  const tempId = "8WcRqPV7usVACmB2cjUJ";
  const canonicalId = "zGjIWE215ZdPiRG1OWLZh6DJCvP2";

  console.log("=== AUDITING DUPLICATE PAIR ===");
  console.log(`Temp ID: ${tempId}`);
  console.log(`Canonical ID: ${canonicalId}\n`);

  // 1. Get both user documents
  const tempSnap = await getDoc(doc(db, "users", tempId));
  const canonicalSnap = await getDoc(doc(db, "users", canonicalId));

  console.log("Temp Document Exists:", tempSnap.exists());
  if (tempSnap.exists()) {
    console.log("Temp Document Data:", tempSnap.data());
  }

  console.log("Canonical Document Exists:", canonicalSnap.exists());
  if (canonicalSnap.exists()) {
    console.log("Canonical Document Data:", canonicalSnap.data());
  }

  const collectionsToAudit = [
    { name: "userTerritoryAssignments", field: "userId" },
    { name: "userProductAssignments", field: "userId" },
    { name: "medicalPlannerVisits", field: "repId" },
    { name: "physicianVisits", field: "repId" },
    { name: "pharmacyVisits", field: "repId" },
    { name: "detailingMaterialUsage", field: "repId" },
    { name: "detailingPageAnalytics", field: "repId" },
    { name: "auditLogs", field: "userId" },
    { name: "notifications", field: "userId" },
    { name: "sampleInventory", field: "userId" },
    { name: "sampleTransactions", field: "userId" }
  ];

  for (const item of collectionsToAudit) {
    try {
      const qTemp = query(collection(db, item.name), where(item.field, "==", tempId));
      const snapTemp = await getDocs(qTemp);

      const qCanon = query(collection(db, item.name), where(item.field, "==", canonicalId));
      const snapCanon = await getDocs(qCanon);

      console.log(`Collection [${item.name}]: Temp ID references = ${snapTemp.size}, Canonical ID references = ${snapCanon.size}`);
      if (snapTemp.size > 0) {
        console.log(`  Temp IDs found in ${item.name}:`, snapTemp.docs.map(d => d.id));
      }
    } catch (err) {
      console.warn(`Could not query ${item.name}:`, err);
    }
  }

  // Also check userActivationProfiles
  try {
    const qAct = query(collection(db, "userActivationProfiles"), where("email", "==", "rep1@example.com"));
    const snapAct = await getDocs(qAct);
    console.log(`userActivationProfiles for rep1@example.com: ${snapAct.size}`);
    snapAct.docs.forEach(d => console.log("  Activation Profile:", d.id, d.data()));
  } catch (err) {
    console.warn("Could not query userActivationProfiles:", err);
  }

  process.exit(0);
}

auditDuplicatePair().catch(err => {
  console.error("Audit error:", err);
  process.exit(1);
});
