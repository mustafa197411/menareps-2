import { getFirebaseAdminServices } from "./server/firebaseAdmin";

async function main() {
  const { db } = getFirebaseAdminServices();

  console.log("=== FIRESTORE USER DOCUMENTS ===");
  const usersSnap = await db.collection("users").get();
  usersSnap.docs.forEach((doc) => {
    const data = doc.data();
    if (data.email && (data.email.includes("fo") || data.email.includes("ooo") || data.email.includes("esand.local") || data.role?.includes("Finance") || data.role?.includes("Order"))) {
      console.log(`Doc ID: ${doc.id}`);
      console.log(JSON.stringify(data, null, 2));
      console.log("-----------------------------------------");
    }
  });

  console.log("\n=== USER ACTIVATION PROFILES ===");
  const actSnap = await db.collection("userActivationProfiles").get();
  actSnap.docs.forEach((doc) => {
    const data = doc.data();
    if (doc.id.includes("esand") || doc.id.includes("fo") || doc.id.includes("ooo")) {
      console.log(`Activation ID: ${doc.id}`);
      console.log(JSON.stringify(data, null, 2));
      console.log("-----------------------------------------");
    }
  });
}

main().catch(console.error);
