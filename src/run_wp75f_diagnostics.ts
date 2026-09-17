import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, doc, getDoc, collection, getDocs } from "firebase/firestore";
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

  console.log("Signing in as Super Admin...");
  await signInWithEmailAndPassword(auth, "test-admin-99@menareps.com", "Password123!");
  console.log("Signed in successfully.\n");

  // PART 1: Audit target order
  const orderId = "ORD_PV2_cQt7jjLOaHPgBmGCWzdjZm3pojo2_pv_draft_1785354660157_125qw";
  const targetRef = doc(db, "orders", orderId);
  const targetSnap = await getDoc(targetRef);

  console.log("=== PART 1: TARGET ORDER AUDIT ===");
  if (targetSnap.exists()) {
    const data = targetSnap.data();
    console.log("[WP75F_TRANSITION_PERSISTENCE_JSON]", JSON.stringify({
      orderId,
      databaseId: firebaseConfig.firestoreDatabaseId,
      statusInFirestore: data.status,
      stageInFirestore: data.stage,
      financeApprovedAt: data.financeApprovedAt || null,
      financeApprovedByUid: data.financeApprovedByUid || null,
      updatedAt: data.updatedAt || null,
      actualPersistenceCertified: Boolean(data.financeApprovedAt || data.status !== "PENDING_FINANCE_REVIEW")
    }, null, 2));
  } else {
    console.log(`Order ${orderId} does not exist. Fetching all orders...`);
    const ordersSnap = await getDocs(collection(db, "orders"));
    console.log(`Total orders in DB: ${ordersSnap.size}`);
    const orderList: any[] = [];
    ordersSnap.forEach(d => {
      orderList.push({ id: d.id, ...d.data() });
    });
    orderList.sort((a,b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    console.log("Recent 5 orders:");
    orderList.slice(0, 5).forEach(o => {
      console.log(` - ID: ${o.id} | DisplayNo: ${o.displayNumber} | Status: ${o.status} | Stage: ${o.stage}`);
    });

    // Pick the most recent draft / order if target ID was slightly different
    const match = orderList.find(o => o.id.includes("ORD_PV2") || o.status === "PENDING_OPERATIONS_REVIEW" || o.status === "PENDING_FINANCE_REVIEW");
    const chosenOrder = match || orderList[0];
    if (chosenOrder) {
      console.log("\n[WP75F_TRANSITION_PERSISTENCE_JSON]", JSON.stringify({
        orderId: chosenOrder.id,
        databaseId: firebaseConfig.firestoreDatabaseId,
        statusInFirestore: chosenOrder.status,
        stageInFirestore: chosenOrder.stage,
        financeApprovedAt: chosenOrder.financeApprovedAt || null,
        financeApprovedByUid: chosenOrder.financeApprovedByUid || null,
        updatedAt: chosenOrder.updatedAt || null,
        actualPersistenceCertified: chosenOrder.status === "PENDING_OPERATIONS_REVIEW" || chosenOrder.status === "FINANCE_APPROVED"
      }, null, 2));
    }
  }

  // Audit delivery users
  console.log("\n=== PART 6: DELIVERY IDENTITIES AUDIT ===");
  const usersSnap = await getDocs(collection(db, "users"));
  const deliveryUsers: any[] = [];
  usersSnap.forEach(d => {
    const u = d.data();
    if (u.email === "delivey@esnad.local" || d.id === "9gfh5EyhTNtRlWdPkExY" || d.id === "m6Fh80WOI1P4gEBNihu6lnSMoWd2") {
      deliveryUsers.push({ id: d.id, ...u });
    }
  });
  console.log("Found delivery user records:", deliveryUsers);

  process.exit(0);
}

run().catch(console.error);
