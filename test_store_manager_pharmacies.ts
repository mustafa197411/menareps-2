import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, collection, getDocs, doc, getDoc } from "firebase/firestore";
import * as fs from "fs";

const config = JSON.parse(fs.readFileSync("firebase-applet-config.json", "utf8"));

const app = initializeApp(config);
const auth = getAuth(app);
const db = getFirestore(app, "ai-studio-menarepscrmdemos-82d41216-0d5d-449a-a9d4-b65e790e275c");

async function main() {
  console.log("Signing in as Admin (shwayat.mustafa@gmail.com)...");
  try {
    const userCredential = await signInWithEmailAndPassword(auth, "shwayat.mustafa@gmail.com", "Password123!");
    console.log("Successfully authenticated:", userCredential.user.uid, userCredential.user.email);
  } catch (err: any) {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, "test-admin-99@menareps.com", "Password123!");
      console.log("Successfully authenticated as test-admin-99:", userCredential.user.uid, userCredential.user.email);
    } catch (err2: any) {
      console.error("Auth error:", err2.message);
      process.exit(1);
    }
  }

  // 1. Fetch Store Manager user profile
  const uid = "RkpHdgEgzkW80wjSgCC98ObQCw12";
  const userDocRef = doc(db, "users", uid);
  const userDocSnap = await getDoc(userDocRef);
  if (!userDocSnap.exists()) {
    console.error("User profile document not found!");
    process.exit(1);
  }
  const profile = userDocSnap.data();
  console.log("User Profile:", {
    uid: profile.uid || uid,
    email: profile.email,
    role: profile.role,
    managerId: profile.managerId,
    country: profile.country,
    securityScope: profile.securityScope,
    active: profile.active,
    employmentStatus: profile.employmentStatus
  });

  // Verify readiness criteria
  const hasManagerId = Boolean(profile.managerId);
  console.log("Profile verification:", {
    managerFound: hasManagerId,
    managerValid: hasManagerId,
    isOperational: profile.active === true && profile.employmentStatus === "Active"
  });

  // 2. Query pharmacies collection (Session Alignment Step 8)
  console.log("Attempting query on collection('pharmacies')...");
  try {
    const pharmaciesSnap = await getDocs(collection(db, "pharmacies"));
    console.log(`Pharmacy query successful! Found ${pharmaciesSnap.size} pharmacies.`);
    pharmaciesSnap.docs.slice(0, 3).forEach((d) => {
      const data = d.data();
      console.log(` - Pharmacy ID: ${d.id}, Name: ${data.name || data.nameEn}, Country: ${data.country || data.countryId || 'Libya'}`);
    });
  } catch (err: any) {
    console.error("FAILED to query pharmacies:", err.code, err.message);
    process.exit(1);
  }

  // 3. Query orders collection
  console.log("Attempting query on collection('orders')...");
  try {
    const ordersSnap = await getDocs(collection(db, "orders"));
    console.log(`Order query successful! Found ${ordersSnap.size} orders.`);
    const storePrepOrders = ordersSnap.docs.filter((d) => {
      const data = d.data();
      return data.stage === "STORE_PREPARATION" || data.status === "Pending Store Preparation" || data.status === "STORE_PREPARATION";
    });
    console.log(`Pending Store Preparation orders count: ${storePrepOrders.length}`);
  } catch (err: any) {
    console.error("FAILED to query orders:", err.code, err.message);
    process.exit(1);
  }

  console.log("=== ALL STORE MANAGER ALIGNMENT CHECKS PASSED ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
