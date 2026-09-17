import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, updateDoc, deleteDoc } from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import fs from "fs";

interface ClassificationResult {
  docId: string;
  title: string;
  category: string;
  docData: any;
}

export async function runResourceCutoverAuditAndCleanup(autoClean = false, customDatabaseId?: string) {
  const cfg = JSON.parse(fs.readFileSync("./firebase-applet-config.json", "utf8"));
  const app = initializeApp(cfg);
  const auth = getAuth(app);
  const targetDbId = customDatabaseId || cfg.firestoreDatabaseId;
  const db = (targetDbId && targetDbId !== "(default)" && targetDbId !== "default") 
    ? getFirestore(app, targetDbId) 
    : getFirestore(app);

  await signInWithEmailAndPassword(auth, "test-admin-99@menareps.com", "Password123!");

  const snap = await getDocs(collection(db, "academicResources"));

  const realUploaded: ClassificationResult[] = [];
  const legacyReal: ClassificationResult[] = [];
  const mockSeeded: ClassificationResult[] = [];
  const orphanedMetadata: ClassificationResult[] = [];
  const unknown: ClassificationResult[] = [];

  snap.forEach((docSnap) => {
    const data = docSnap.data();
    const docId = docSnap.id;
    const item: ClassificationResult = {
      docId,
      title: data.titleEn || data.title || "Untitled",
      category: data.category || "Uncategorized",
      docData: data
    };

    // Check if real uploaded
    const hasDownloadUrl = Boolean(data.downloadUrl && String(data.downloadUrl).startsWith("http"));
    const hasStoragePath = Boolean(data.storagePath && String(data.storagePath).length > 0);
    const hasUploader = Boolean(data.uploadedByUid);
    const isComplete = data.uploadStatus === "COMPLETE";

    if (hasDownloadUrl && hasStoragePath && hasUploader && isComplete) {
      if (Array.isArray(data.productIds) && data.resourceScope) {
        realUploaded.push(item);
      } else {
        legacyReal.push(item);
      }
    } else if (!hasDownloadUrl && !hasStoragePath) {
      mockSeeded.push(item);
    } else if (hasStoragePath && !hasDownloadUrl) {
      orphanedMetadata.push(item);
    } else {
      unknown.push(item);
    }
  });

  console.log("=== ACADEMIC RESOURCES CLASSIFICATION DRY RUN REPORT ===");
  console.log(`Total Records Audited: ${snap.size}`);
  console.log(`- REAL_UPLOADED: ${realUploaded.length}`);
  console.log(`- LEGACY_REAL: ${legacyReal.length}`);
  console.log(`- MOCK_SEEDED / INVALID: ${mockSeeded.length}`);
  console.log(`- ORPHANED_METADATA: ${orphanedMetadata.length}`);
  console.log(`- UNKNOWN: ${unknown.length}`);

  if (mockSeeded.length > 0) {
    console.log("\nDetails of MOCK_SEEDED records to be cleaned:");
    mockSeeded.forEach(m => {
      console.log(`  * ID: ${m.docId} | Title: "${m.title}" | Category: ${m.category}`);
    });
  }

  if (autoClean && mockSeeded.length > 0) {
    console.log("\nExecuting cleanup of MOCK_SEEDED records...");
    for (const item of mockSeeded) {
      const ref = doc(db, "academicResources", item.docId);
      await deleteDoc(ref);
      console.log(`  [DELETED] Removed mock document ${item.docId}`);
    }
    console.log("Cleanup complete!");
  }

  return {
    total: snap.size,
    realUploaded,
    legacyReal,
    mockSeeded,
    orphanedMetadata,
    unknown
  };
}

if (process.argv.includes("--run")) {
  const doClean = process.argv.includes("--clean");
  runResourceCutoverAuditAndCleanup(doClean).then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
