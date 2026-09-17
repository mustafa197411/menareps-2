import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import firebaseConfig from "../firebase-applet-config.json" assert { type: "json" };

async function run() {
  console.log("Initializing Firebase Admin...");
  const app = initializeApp({
    projectId: firebaseConfig.projectId
  });

  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
  console.log("Database initialized successfully!");

  // 1. Inspect physicianSpecialties
  console.log("\n--- PHYSICIAN SPECIALTIES ---");
  const specsSnap = await db.collection("physicianSpecialties").get();
  console.log(`Total physicianSpecialties documents: ${specsSnap.size}`);
  let activeSpecsCount = 0;
  const specList: any[] = [];
  specsSnap.forEach(doc => {
    const data = doc.data();
    if (data.isActive !== false && !data.isDeleted) {
      activeSpecsCount++;
    }
    specList.push({ id: doc.id, ...data });
  });
  console.log(`Active specialties count: ${activeSpecsCount}`);
  specList.sort((a,b) => a.id.localeCompare(b.id)).forEach(spec => {
    console.log(` - ID: ${spec.id} | Name: ${spec.name} | Arabic: ${spec.nameAr || "N/A"} | IsActive: ${spec.isActive} | isDeleted: ${spec.isDeleted || false}`);
  });

  // 2. Inspect products
  console.log("\n--- REPRESENTATIVE PRODUCTS (original import) ---");
  const productsSnap = await db.collection("products").get();
  console.log(`Total products documents in 'products' collection: ${productsSnap.size}`);
  
  let activeProductsCount = 0;
  let inactiveProductsCount = 0;
  let missingProductsCount = 0;
  let uatProductsCount = 0;
  
  const productList: any[] = [];
  productsSnap.forEach(doc => {
    const data = doc.data();
    productList.push({ id: doc.id, ...data });
    const isActive = data.isActive !== false && data.active !== false;
    if (isActive) {
      activeProductsCount++;
    } else {
      inactiveProductsCount++;
    }
    if (data.isTestData) {
      uatProductsCount++;
    }
  });

  console.log(`Active Products: ${activeProductsCount}`);
  console.log(`Inactive Products: ${inactiveProductsCount}`);
  console.log(`UAT Products: ${uatProductsCount}`);

  console.log("\nRepresentative products details (First 10 records):");
  productList.slice(0, 10).forEach((p, idx) => {
    console.log(`[${idx + 1}] ID: ${p.id} | Name: ${p.name} | SKU: ${p.sku || p.SKU || "N/A"} | Active: ${p.active} | IsActive: ${p.isActive} | isTestData: ${p.isTestData || false} | importBatchId: ${p.importBatchId || "N/A"} | createdAt: ${p.createdAt || p.created || "N/A"}`);
  });

  // 3. Inspect transactionHistory
  console.log("\n--- TRANSACTION HISTORY SUMMARY ---");
  const txsSnap = await db.collection("transactionHistory").limit(10).get();
  console.log(`Total transactionHistory items: ${txsSnap.size}`);
  txsSnap.forEach(doc => {
    const data = doc.data();
    console.log(` - Doc: ${doc.id} | module: ${data.module || data.template} | status: ${data.status} | rows: ${data.rowCount || data.rowsCount || 0} | type: ${data.type || data.importMode || "N/A"} | isTestData: ${data.isTestData || false}`);
  });
}

run().catch(console.error);
