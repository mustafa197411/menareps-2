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

async function run() {
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

  console.log("Signing in...");
  await signInWithEmailAndPassword(auth, "test-admin-99@menareps.com", "Password123!");
  console.log("Signed in successfully.");

  console.log("\n=== ALL KEY MESSAGES ===");
  const kmSnap = await getDocs(collection(db, "keyMessages"));
  kmSnap.forEach(doc => {
    const k = doc.data();
    console.log(`Key Message ID: ${doc.id}`);
    console.log(`  Title: ${k.title || k.titleEn}`);
    console.log(`  Brand: ${k.brandName || k.brand}`);
    console.log(`  ProductId: ${k.productId || k.productSku}`);
    console.log(`  DetailingSequence: ${k.detailingSequence || k.sequence}`);
    console.log(`  IsDeleted: ${k.isDeleted}`);
    console.log(`  IsApproved: ${k.isApproved}`);
    console.log(`  TargetSpecialties: ${JSON.stringify(k.targetSpecialtyNames || k.targetSpecialtyIds)}`);
  });

  console.log("\n=== ALL ACADEMIC RESOURCES ===");
  const arSnap = await getDocs(collection(db, "academicResources"));
  arSnap.forEach(doc => {
    const ar = doc.data();
    console.log(`Resource ID: ${doc.id}`);
    console.log(`  Title: ${ar.title}`);
    console.log(`  Brand: ${ar.brand}`);
    console.log(`  ProductId: ${ar.productId}`);
    console.log(`  Category: ${ar.category}`);
    console.log(`  IsDeleted: ${ar.isDeleted}`);
    console.log(`  URL: ${ar.url}`);
  });

  console.log("\n=== ALL SAMPLE ALLOCATIONS ===");
  const saSnap = await getDocs(collection(db, "sampleAllocations"));
  saSnap.forEach(doc => {
    const sa = doc.data();
    console.log(`Allocation ID: ${doc.id}`);
    console.log(`  RepId: ${sa.repId}`);
    console.log(`  RepEmail: ${sa.repEmail || sa.repName}`);
    console.log(`  ProductId: ${sa.productId}`);
    console.log(`  ProductName: ${sa.productName}`);
    console.log(`  AllocatedQty: ${sa.allocatedQuantity || sa.allocatedQty}`);
    console.log(`  DistributedQty: ${sa.distributedQuantity || sa.distributedQty}`);
    console.log(`  RemainingQty: ${sa.remainingQuantity || sa.remainingQty}`);
  });

  console.log("\n=== ALL SAMPLE INVENTORY ===");
  const siSnap = await getDocs(collection(db, "sampleInventory"));
  siSnap.forEach(doc => {
    const si = doc.data();
    console.log(`Inventory ID: ${doc.id}`);
    console.log(`  SampleId: ${si.sampleId}`);
    console.log(`  Name: ${si.name}`);
    console.log(`  Brand: ${si.brand}`);
    console.log(`  Qty: ${si.qty}`);
    console.log(`  Available: ${si.available}`);
  });
}

run().catch(console.error);
