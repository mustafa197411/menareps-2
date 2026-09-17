import { getFirebaseAdminServices } from "./firebaseAdmin";
import dotenv from "dotenv";

dotenv.config();

async function runTest() {
  console.log("==================================================================");
  console.log("MENAREPS 2.0 - DIRECT FIREBASE ADMIN SDK DIAGNOSTIC TEST");
  console.log("==================================================================");

  try {
    const services = getFirebaseAdminServices();
    const db = services.db;

    const testUids = [
      "GQynj6LObmfQPz6PbNR9poANfXv1", // Expected Super Admin UID
      "nonexistent-uid-test-12345"    // Nonexistent UID
    ];

    for (const uid of testUids) {
      console.log(`\n[TEST] Attempting Admin SDK read for path: users/${uid}...`);
      try {
        const userDoc = await db.collection("users").doc(uid).get();
        if (userDoc.exists) {
          const data = userDoc.data();
          console.log(`[SUCCESS] Document read SUCCEEDED.`);
          console.log(`[DATA] Profile:`, JSON.stringify(data, null, 2));
          console.log(`[ROLE] Returned role: ${data?.role || "undefined"}`);
        } else {
          console.log(`[NOT_FOUND] Document does not exist (Expected not-found behavior).`);
        }
      } catch (err: any) {
        console.error(`[FAILURE] Admin SDK read failed with error:`);
        console.error(`Code: ${err.code}`);
        console.error(`Message: ${err.message}`);
        console.error(`Status: ${err.status}`);
      }
    }
  } catch (err: any) {
    console.error("Initialization error:", err.message || err);
  }
  console.log("\n==================================================================");
}

runTest();
