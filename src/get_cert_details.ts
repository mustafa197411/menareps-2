import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, collection, getDocs, query, where, doc, getDoc } from "firebase/firestore";
import firebaseConfig from "../firebase-applet-config.json" assert { type: "json" };
import { getReadiness } from "./lib/userPolicyEngine";
import { User, Role } from "./types";

const config = {
  apiKey: firebaseConfig.apiKey,
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId,
  appId: firebaseConfig.appId
};

async function run() {
  console.log("=== FIRESTORE DATA COLLECTION AND CERTIFICATION ===");
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

  // Sign in as Admin to read collections
  await signInWithEmailAndPassword(auth, "test-admin-99@menareps.com", "Password123!");
  console.log("Admin Authenticated Successfully.");

  // 1. Fetch User Record
  console.log("\n--- TEST USER PROFILE ---");
  const usersRef = collection(db, "users");
  const userQuery = query(usersRef, where("email", "==", "test-user@esnad.local"));
  const userSnap = await getDocs(userQuery);
  if (userSnap.empty) {
    console.log("test-user@esnad.local not found!");
    return;
  }
  const userDoc = userSnap.docs[0];
  const uid = userDoc.id;
  const userData = { id: uid, ...userDoc.data() } as User;
  console.log(`- Document Path: users/${uid}`);
  console.log(`- Email: ${userData.email}`);
  console.log(`- Canonical Role: ${userData.role}`);
  console.log(`- assignmentSyncStatus: ${userData.assignmentSyncStatus}`);
  console.log(`- Active Area IDs: ${JSON.stringify(userData.areaIds)}`);
  console.log(`- Primary Promotion Group ID: ${userData.primaryPromotionGroupId}`);
  console.log(`- Manager ID: ${userData.managerId}`);
  console.log(`- Manager Email: ${userData.managerEmail}`);

  // Fetch Manager Profile
  if (userData.managerId) {
    const mgrDoc = await getDoc(doc(db, "users", userData.managerId));
    if (mgrDoc.exists()) {
      console.log(`- Manager UID: ${mgrDoc.id}`);
      console.log(`- Manager Email: ${mgrDoc.data().email}`);
      console.log(`- Manager Role: ${mgrDoc.data().role}`);
    }
  }

  // 2. Fetch User Territory Assignments
  console.log("\n--- ACTIVE AREA ASSIGNMENTS ---");
  const terrRef = collection(db, "userTerritoryAssignments");
  const terrQuery = query(terrRef, where("userId", "==", uid));
  const terrSnap = await getDocs(terrQuery);
  terrSnap.forEach(d => {
    const data = d.data();
    console.log(`- [${d.id}]: Territory ID: ${data.territoryId} | Status: ${data.status} | Name: ${data.territoryName}`);
  });

  // 3. Fetch User Product Assignments
  console.log("\n--- ACTIVE PRODUCT ASSIGNMENTS ---");
  const prodRef = collection(db, "userProductAssignments");
  const prodQuery = query(prodRef, where("userId", "==", uid));
  const prodSnap = await getDocs(prodQuery);
  prodSnap.forEach(d => {
    const data = d.data();
    console.log(`- [${d.id}]: Product ID: ${data.productId} | Group: ${data.productGroupId} | Status: ${data.status}`);
  });

  // 4. Evaluate Readiness
  console.log("\n--- READINESS EVALUATION ---");
  const allUsersSnap = await getDocs(usersRef);
  const allUsers = allUsersSnap.docs.map(d => ({ id: d.id, ...d.data() } as User));
  const readiness = getReadiness(userData, allUsers);
  console.log(`- Readiness Status: ${readiness.status}`);
  console.log(`- Readiness Reasons: ${JSON.stringify(readiness.reasons)}`);

  // 5. Pharmacy Scope Verification
  console.log("\n--- PHARMACY SCOPE VERIFICATION ---");
  // Query PHM-TAJOURA-A
  const tajuraDoc = await getDoc(doc(db, "pharmacies", "PHM-TAJOURA-A"));
  if (tajuraDoc.exists()) {
    console.log("- PHM-TAJOURA-A exists.");
    console.log("  Data:", JSON.stringify(tajuraDoc.data(), null, 2));
  } else {
    console.log("- PHM-TAJOURA-A does not exist in Firestore!");
  }

  // Query PHM-JANZOUR-B
  const janzourDoc = await getDoc(doc(db, "pharmacies", "PHM-JANZOUR-B"));
  if (janzourDoc.exists()) {
    console.log("- PHM-JANZOUR-B exists.");
    console.log("  Data:", JSON.stringify(janzourDoc.data(), null, 2));
  } else {
    console.log("- PHM-JANZOUR-B does not exist in Firestore.");
  }

  // 6. Query Pharmacy Visits, Orders, Payments, Stock Requests, Planner Visits, Audit Logs for user
  console.log("\n--- PHARMACY VISITS FOR THIS USER ---");
  const visitsQuery = query(collection(db, "pharmacyVisits"), where("repId", "==", uid));
  const visitsSnap = await getDocs(visitsQuery);
  console.log(`Total visits written: ${visitsSnap.size}`);
  visitsSnap.forEach(d => {
    console.log(`- [${d.id}]:`, JSON.stringify(d.data(), null, 2));
  });

  console.log("\n--- ORDERS FOR THIS USER ---");
  const ordersQuery = query(collection(db, "orders"), where("repId", "==", uid));
  const ordersSnap = await getDocs(ordersQuery);
  console.log(`Total orders written: ${ordersSnap.size}`);
  ordersSnap.forEach(d => {
    console.log(`- [${d.id}]:`, JSON.stringify(d.data(), null, 2));
  });

  console.log("\n--- SALES PLANNER VISITS FOR THIS USER ---");
  const plannerQuery = query(collection(db, "salesPlannerVisits"), where("repId", "==", uid));
  const plannerSnap = await getDocs(plannerQuery);
  console.log(`Total planner visits: ${plannerSnap.size}`);
  plannerSnap.forEach(d => {
    console.log(`- [${d.id}]:`, JSON.stringify(d.data(), null, 2));
  });

  console.log("\n--- AUDIT LOGS FOR THIS USER ---");
  const auditQuery = query(collection(db, "auditLogs"), where("userId", "==", uid));
  const auditSnap = await getDocs(auditQuery);
  console.log(`Total audit logs: ${auditSnap.size}`);
  auditSnap.forEach(d => {
    console.log(`- [${d.id}]:`, JSON.stringify(d.data(), null, 2));
  });

  console.log("\n--- ALL DONE ---");
}

run().catch(console.error);
