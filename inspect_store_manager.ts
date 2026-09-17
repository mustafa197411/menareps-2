import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, collection, getDocs, doc, getDoc, query, where, updateDoc } from "firebase/firestore";
import * as fs from "fs";

const config = JSON.parse(fs.readFileSync("firebase-applet-config.json", "utf8"));

const app = initializeApp(config);
const auth = getAuth(app);
const db = getFirestore(app, "ai-studio-menarepscrmdemos-82d41216-0d5d-449a-a9d4-b65e790e275c");

async function main() {
  try {
    await signInWithEmailAndPassword(auth, "shwayat.mustafa@gmail.com", "Password123!");
  } catch (err) {
    try {
      await signInWithEmailAndPassword(auth, "test-admin-99@menareps.com", "Password123!");
    } catch (err2) {
      console.log("Auth error:", err2);
    }
  }

  console.log("Auth state:", auth.currentUser?.email, auth.currentUser?.uid);

  console.log("=== INSPECTING STORE MANAGER & MANAGER DOCUMENTS ===");
  
  // 1. Get Store Manager doc
  const smDocRef = doc(db, "users", "RkpHdgEgzkW80wjSgCC98ObQCw12");
  const smSnap = await getDoc(smDocRef);
  
  if (smSnap.exists()) {
    console.log("\n--- Store Manager doc found at users/RkpHdgEgzkW80wjSgCC98ObQCw12 ---");
    console.log(JSON.stringify(smSnap.data(), null, 2));
  } else {
    console.log("\n--- Store Manager doc NOT FOUND at users/RkpHdgEgzkW80wjSgCC98ObQCw12 ---");
  }

  // 2. Query all users in collection 'users'
  const usersSnap = await getDocs(collection(db, "users"));
  console.log(`\nTotal users in collection 'users': ${usersSnap.size}`);
  
  usersSnap.docs.forEach((d) => {
    const data = d.data();
    if (
      d.id === "RkpHdgEgzkW80wjSgCC98ObQCw12" ||
      data.email?.toLowerCase().includes("esand") ||
      data.email?.toLowerCase().includes("fm") ||
      data.email?.toLowerCase().includes("store") ||
      data.email?.toLowerCase().includes("wh") ||
      data.email?.toLowerCase().includes("wm") ||
      data.email?.toLowerCase().includes("gm") ||
      data.role?.includes("Store") ||
      data.role?.includes("Finance") ||
      data.role?.includes("Warehouse")
    ) {
      console.log(`\nDoc ID: ${d.id}`);
      console.log(`Email: ${data.email}, Role: ${data.role}, Name: ${data.name}`);
      console.log(`managerId: ${data.managerId}, managerEmail: ${data.managerEmail}`);
      console.log(`active: ${data.active}, status: ${data.status}, employmentStatus: ${data.employmentStatus}`);
    }
  });

  // 3. Query userActivationProfiles
  const actColSnap = await getDocs(collection(db, "userActivationProfiles"));
  console.log(`\nTotal userActivationProfiles: ${actColSnap.size}`);
  actColSnap.docs.forEach((d) => {
    const data = d.data();
    if (d.id.includes("Rkp") || d.id.includes("esand") || data.email?.includes("esand") || data.email?.includes("fm")) {
      console.log(`\nActivation Profile ID: ${d.id}`);
      console.log(JSON.stringify(data, null, 2));
    }
  });
}

main().catch(console.error);
