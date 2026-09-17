const admin = require("firebase-admin");
const firebaseConfig = require("./firebase-applet-config.json");

if (!admin.apps.length) {
  admin.initializeApp({
    projectId: firebaseConfig.projectId
  });
}

const db = admin.firestore();
// Use the named database if needed
const namedDb = admin.app().firestore(firebaseConfig.firestoreDatabaseId);

async function check() {
  console.log("Checking named database:", firebaseConfig.firestoreDatabaseId);
  const userDoc = await namedDb.collection("users").doc("cQt7jjLOaHPgBmGCWzdjZm3pojo2").get();
  console.log("User doc exists:", userDoc.exists);
  if (userDoc.exists) {
    console.log("User data:", JSON.stringify(userDoc.data(), null, 2));
  }

  const knownDoc = await namedDb.collection("pharmacies").doc("PHM-1784317568015-676").get();
  console.log("PHM-1784317568015-676 exists:", knownDoc.exists);
  if (knownDoc.exists) {
    console.log("Known doc data:", JSON.stringify(knownDoc.data(), null, 2));
  }

  const areaSnap = await namedDb.collection("pharmacies").where("areaId", "==", "LY-WEST-TRE2").get();
  console.log("Area query (LY-WEST-TRE2) count:", areaSnap.size);
  areaSnap.forEach(doc => console.log(doc.id, doc.data()));

  const allSnap = await namedDb.collection("pharmacies").get();
  console.log("Total pharmacies count in database:", allSnap.size);
  allSnap.forEach(doc => {
    const d = doc.data();
    console.log(doc.id, "areaId:", JSON.stringify(d.areaId), "territory:", JSON.stringify(d.territory), "name:", d.name);
  });
}

check().catch(console.error).then(() => process.exit(0));
