import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, collection, getDocs } from "firebase/firestore";
import firebaseConfig from "../firebase-applet-config.json" assert { type: "json" };
import * as fs from "fs";
import * as path from "path";

const config = {
  apiKey: firebaseConfig.apiKey,
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId,
  appId: firebaseConfig.appId
};

async function run() {
  const logLines: string[] = [];
  function log(msg: string) {
    console.log(msg);
    logLines.push(msg);
  }

  log("Initializing Client Firebase...");
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

  log("Signing in as Admin...");
  await signInWithEmailAndPassword(auth, "test-admin-99@menareps.com", "Password123!");
  log("Logged in successfully! Fetching data...\n");

  // 1. Fetch Countries
  log("=== COUNTRIES ===");
  const countriesSnap = await getDocs(collection(db, "countries"));
  countriesSnap.forEach(doc => {
    log(`Country ID: ${doc.id} => ${JSON.stringify(doc.data())}`);
  });

  // 2. Fetch Districts
  log("\n=== DISTRICTS ===");
  const districtsSnap = await getDocs(collection(db, "districts"));
  districtsSnap.forEach(doc => {
    log(`District ID: ${doc.id} => ${JSON.stringify(doc.data())}`);
  });

  // 3. Fetch Cities
  log("\n=== CITIES ===");
  const citiesSnap = await getDocs(collection(db, "cities"));
  citiesSnap.forEach(doc => {
    log(`City ID: ${doc.id} => ${JSON.stringify(doc.data())}`);
  });

  // 4. Fetch Areas
  log("\n=== AREAS ===");
  const areasSnap = await getDocs(collection(db, "areas"));
  log(`Total Areas in Firestore: ${areasSnap.size}`);
  areasSnap.forEach(doc => {
    const d = doc.data();
    log(`Area ID: ${doc.id} => ${JSON.stringify(d)}`);
  });

  // 5. Fetch Users (especially medtajura@esnad.local)
  log("\n=== USERS MATCHING medtajura@esnad.local ===");
  const usersSnap = await getDocs(collection(db, "users"));
  usersSnap.forEach(doc => {
    const d = doc.data();
    if ((d.email || "").toLowerCase().includes("medtajura")) {
      log(`User ID: ${doc.id} => ${JSON.stringify(d)}`);
    }
  });

  // 6. Fetch userTerritoryAssignments
  log("\n=== TERRITORY ASSIGNMENTS ===");
  const terrSnap = await getDocs(collection(db, "userTerritoryAssignments"));
  terrSnap.forEach(doc => {
    const d = doc.data();
    log(`Assignment ID: ${doc.id} => ${JSON.stringify(d)}`);
  });

  // 7. Fetch userProductAssignments
  log("\n=== PRODUCT ASSIGNMENTS ===");
  const prodSnap = await getDocs(collection(db, "userProductAssignments"));
  prodSnap.forEach(doc => {
    const d = doc.data();
    log(`Product Assignment ID: ${doc.id} => ${JSON.stringify(d)}`);
  });

  // 8. Fetch sample Physicians and Pharmacies in Tajoura/Tajura
  log("\n=== PHYSICIANS IN TAJOURA/TAJURA ===");
  const physSnap = await getDocs(collection(db, "physicians"));
  physSnap.forEach(doc => {
    const d = doc.data();
    const area = (d.area || d.areaName || d.territory || "").toUpperCase();
    if (area.includes("TAJ") || (d.areaId && d.areaId.includes("taj"))) {
      log(`Physician ID: ${doc.id} => Name: ${d.name} | Area: ${d.area} | AreaName: ${d.areaName} | AreaId: ${d.areaId} | City: ${d.city} | CityName: ${d.cityName} | District: ${d.district} | Country: ${d.country} | Territory: ${d.territory}`);
    }
  });

  log("\n=== PHARMACIES IN TAJOURA/TAJURA ===");
  const pharSnap = await getDocs(collection(db, "pharmacies"));
  pharSnap.forEach(doc => {
    const d = doc.data();
    const area = (d.area || d.areaName || d.territory || "").toUpperCase();
    if (area.includes("TAJ") || (d.areaId && d.areaId.includes("taj"))) {
      log(`Pharmacy ID: ${doc.id} => Name: ${d.name} | Area: ${d.area} | AreaName: ${d.areaName} | AreaId: ${d.areaId} | City: ${d.city} | CityName: ${d.cityName} | District: ${d.district} | Country: ${d.country} | Territory: ${d.territory}`);
    }
  });

  const outputPath = path.join(process.cwd(), "src", "diagnostics-output.txt");
  fs.writeFileSync(outputPath, logLines.join("\n"), "utf-8");
  console.log(`Wrote diagnostics to ${outputPath}`);
  process.exit(0);
}

run().catch(console.error);
