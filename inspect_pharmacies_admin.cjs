const { Firestore } = require('@google-cloud/firestore');

const db = new Firestore({
  projectId: 'gen-lang-client-0698936227',
  databaseId: 'ai-studio-menarepscrmdemos-82d41216-0d5d-449a-a9d4-b65e790e275c'
});

async function main() {
  console.log("=== INSPECTING NAMED DATABASE ===");
  console.log("Project:", 'gen-lang-client-0698936227');
  console.log("Database:", 'ai-studio-menarepscrmdemos-82d41216-0d5d-449a-a9d4-b65e790e275c');

  const knownDoc = await db.collection('pharmacies').doc('PHM-1784317568015-676').get();
  console.log("Document PHM-1784317568015-676 exists:", knownDoc.exists);
  if (knownDoc.exists) {
    const data = knownDoc.data();
    console.log("Data:", JSON.stringify({
      id: data.id,
      name: data.name,
      areaId: data.areaId,
      areaIdType: typeof data.areaId,
      areaIdLength: data.areaId ? data.areaId.length : 0,
      areaIdCharacterCodes: data.areaId ? Array.from(data.areaId).map(c => c.charCodeAt(0)) : [],
      active: data.active,
      status: data.status,
      isDeleted: data.isDeleted
    }, null, 2));
  }

  const userDoc = await db.collection('users').doc('cQt7jjLOaHPgBmGCWzdjZm3pojo2').get();
  console.log("User cQt7jjLOaHPgBmGCWzdjZm3pojo2 exists:", userDoc.exists);
  if (userDoc.exists) {
    console.log("User data:", JSON.stringify(userDoc.data(), null, 2));
  }

  const querySnap = await db.collection('pharmacies').where('areaId', '==', 'LY-WEST-TRE2').get();
  console.log("Admin Query where('areaId', '==', 'LY-WEST-TRE2') size:", querySnap.size);
  querySnap.forEach(doc => {
    console.log(doc.id, "=>", doc.data().name, "areaId:", doc.data().areaId);
  });

  const allSnap = await db.collection('pharmacies').get();
  console.log("Total pharmacies in DB:", allSnap.size);
  allSnap.forEach(doc => {
    const d = doc.data();
    console.log(doc.id, "=> name:", d.name, "| areaId:", JSON.stringify(d.areaId), "| territory:", JSON.stringify(d.territory));
  });
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
