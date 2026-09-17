import { initializeApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc, collection, getDocs } from "firebase/firestore";
import firebaseConfig from "../firebase-applet-config.json" assert { type: "json" };

const config = {
  apiKey: firebaseConfig.apiKey,
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId,
  appId: firebaseConfig.appId
};

async function run() {
  console.log("Initializing Client Firebase...");
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

  const email = "test-admin-99@menareps.com";
  const password = "Password123!";
  let uid = "";

  console.log(`Attempting to register user: ${email}...`);
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    uid = cred.user.uid;
    console.log(`Successfully registered user! UID: ${uid}`);
  } catch (err: any) {
    if (err.code === "auth/email-already-in-use") {
      console.log("Email already registered. Signing in instead...");
      const cred = await signInWithEmailAndPassword(auth, email, password);
      uid = cred.user.uid;
      console.log(`Successfully signed in! UID: ${uid}`);
    } else {
      throw err;
    }
  }

  // Check if profile exists, if not write it
  const userDocRef = doc(db, "users", uid);
  const profileSnap = await getDoc(userDocRef);
  
  if (!profileSnap.exists()) {
    console.log("Writing Super Admin profile...");
    const profileData = {
      id: uid,
      name: "Test Super Admin",
      email: email,
      role: "Super Admin",
      isActive: true,
      active: true,
      isTestData: true
    };
    await setDoc(userDocRef, profileData);
    console.log("Super Admin profile created successfully!");
  } else {
    console.log("Super Admin profile already exists:", profileSnap.data());
  }

  // 1. Inspect physicianSpecialties
  console.log("\n--- PHYSICIAN SPECIALTIES ---");
  const specsSnap = await getDocs(collection(db, "physicianSpecialties"));
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
  console.log("\n--- PRODUCTS ANALYSIS ---");
  const productsSnap = await getDocs(collection(db, "products"));
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

  console.log("\nRepresentative products details (First 15 records):");
  productList.slice(0, 15).forEach((p, idx) => {
    console.log(`[${idx + 1}] ID: ${p.id} | Name: ${p.name} | SKU: ${p.sku || p.SKU || "N/A"} | Active: ${p.active} | IsActive: ${p.isActive} | isTestData: ${p.isTestData || false} | importBatchId: ${p.importBatchId || "N/A"} | createdAt: ${p.createdAt || p.created || "N/A"}`);
  });

  // 3. Inspect Promotion Groups
  console.log("\n--- PROMOTION GROUPS ---");
  const groupsSnap = await getDocs(collection(db, "productPromotionGroups"));
  console.log(`Total Promotion Groups: ${groupsSnap.size}`);
  groupsSnap.forEach(doc => {
    const data = doc.data();
    console.log(` - ID: ${doc.id} | Name: ${data.name} | Normalized: ${data.normalizedName}`);
  });

  console.log("\n*** ANALYSIS COMPLETE ***");
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
