import { getFirebaseAdminServices } from "./server/firebaseAdmin";
import { getReadiness } from "./src/lib/userPolicyEngine";
import { User, Role } from "./src/types";

async function run() {
  console.log("=== STARTING FIRESTORE CERTIFICATION PROBE ===");
  const { db } = getFirebaseAdminServices();
  
  // 1. Find User by email
  const userSnapshot = await db.collection("users")
    .where("email", "==", "medtajura@esnad.local")
    .get();

  if (userSnapshot.empty) {
    console.log("User medtajura@esnad.local NOT FOUND in 'users' collection.");
    return;
  }

  const userDoc = userSnapshot.docs[0];
  const userData = { id: userDoc.id, ...userDoc.data() } as User;
  console.log(`\n--- users/${userDoc.id} ---`);
  console.log(JSON.stringify(userData, null, 2));

  // 2. Fetch all users to resolve manager and run complete getReadiness
  const allUsersSnapshot = await db.collection("users").get();
  const allUsers = allUsersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as User));

  // 3. Query userTerritoryAssignments
  const territorySnapshot = await db.collection("userTerritoryAssignments")
    .where("userId", "==", userDoc.id)
    .get();
  const territories = territorySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  console.log(`\n--- userTerritoryAssignments (${territories.length}) ---`);
  console.log(JSON.stringify(territories, null, 2));

  // 4. Query userProductAssignments
  const productSnapshot = await db.collection("userProductAssignments")
    .where("userId", "==", userDoc.id)
    .get();
  const products = productSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  console.log(`\n--- userProductAssignments (${products.length}) ---`);
  console.log(JSON.stringify(products, null, 2));

  // 5. Manager resolution
  let managerUser: User | null = null;
  if (userData.managerId) {
    managerUser = allUsers.find(u => u.id === userData.managerId) || null;
  } else if (userData.managerEmail) {
    const normEmail = userData.managerEmail.toLowerCase().trim();
    managerUser = allUsers.find(u => u.email?.toLowerCase().trim() === normEmail) || null;
  }

  console.log(`\n--- Manager Details ---`);
  if (managerUser) {
    console.log(`Manager UID: ${managerUser.id}`);
    console.log(`Manager Name: ${managerUser.name}`);
    console.log(`Manager Email: ${managerUser.email}`);
    console.log(`Manager Role: ${managerUser.role}`);
    console.log(`Manager Active: ${managerUser.active}`);
  } else {
    console.log("No Manager resolved in users list.");
  }

  // 6. Readiness Evaluation
  const readiness = getReadiness(userData, allUsers);
  console.log(`\n--- Readiness Evaluation ---`);
  console.log(`Status: ${readiness.status}`);
  console.log(`Reasons: ${JSON.stringify(readiness.reasons)}`);
  
  console.log("\n=== PROBE COMPLETE ===");
}

run().catch(err => {
  console.error("Probe failed:", err);
});
