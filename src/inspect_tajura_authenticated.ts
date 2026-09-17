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
  console.log("Initializing Client Firebase SDK...");
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

  console.log("Authenticating as test-admin-99@menareps.com...");
  await signInWithEmailAndPassword(auth, "test-admin-99@menareps.com", "Password123!");
  console.log("Authentication successful!");

  // 1. Fetch medtajura user record
  console.log("\nSearching for test-user@esnad.local in users collection...");
  const usersRef = collection(db, "users");
  const userQuery = query(usersRef, where("email", "==", "test-user@esnad.local"));
  const userSnap = await getDocs(userQuery);

  if (userSnap.empty) {
    console.log("Error: User medtajura@esnad.local not found!");
    return;
  }

  const userDoc = userSnap.docs[0];
  const userUid = userDoc.id;
  const userData = { id: userUid, ...userDoc.data() } as User;
  console.log(`User Document ID: ${userUid}`);
  console.log("User Data:", JSON.stringify(userData, null, 2));

  // 2. Fetch all users to resolve manager list
  console.log("\nFetching all users to resolve managers...");
  const allUsersSnap = await getDocs(usersRef);
  const allUsers = allUsersSnap.docs.map(d => ({ id: d.id, ...d.data() } as User));
  console.log(`Total users found in system: ${allUsers.length}`);

  // 3. Fetch userTerritoryAssignments
  console.log("\nFetching territory assignments for user...");
  const terrRef = collection(db, "userTerritoryAssignments");
  const terrQuery = query(terrRef, where("userId", "==", userUid));
  const terrSnap = await getDocs(terrQuery);
  const assignments = terrSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  console.log(`Territory Assignments (${assignments.length}):`, JSON.stringify(assignments, null, 2));

  // 4. Fetch userProductAssignments
  console.log("\nFetching product assignments for user...");
  const prodRef = collection(db, "userProductAssignments");
  const prodQuery = query(prodRef, where("userId", "==", userUid));
  const prodSnap = await getDocs(prodQuery);
  const prodAssignments = prodSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  console.log(`Product Assignments (${prodAssignments.length}):`, JSON.stringify(prodAssignments, null, 2));

  // 5. Manager resolution
  console.log("\nResolving Manager...");
  let manager: User | null = null;
  if (userData.managerId) {
    manager = allUsers.find(u => u.id === userData.managerId) || null;
  } else if (userData.managerEmail) {
    const norm = userData.managerEmail.toLowerCase().trim();
    manager = allUsers.find(u => u.email?.toLowerCase().trim() === norm) || null;
  }
  
  if (manager) {
    console.log(`Resolved Manager UID: ${manager.id}`);
    console.log(`Resolved Manager Name: ${manager.name}`);
    console.log(`Resolved Manager Email: ${manager.email}`);
    console.log(`Resolved Manager Role: ${manager.role}`);
  } else {
    console.log("No manager resolved!");
  }

  // 6. Readiness status
  console.log("\nEvaluating Readiness...");
  const readiness = getReadiness(userData, allUsers);
  console.log(`Readiness Status: ${readiness.status}`);
  console.log(`Readiness Reasons: ${JSON.stringify(readiness.reasons)}`);

  console.log("\nAll Done!");
}

run().catch(console.error);
