import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { assertProductionIsolation } from "./preflight";
import { UAT_PROJECT_ID, UAT_STORAGE_BUCKET } from "./constants";

export async function resetEmulatorState(): Promise<void> {
  assertProductionIsolation();
  const existing = getApps().find(app => app.name === "menareps-uat-reset");
  const app = existing ?? initializeApp({ projectId: UAT_PROJECT_ID, storageBucket: UAT_STORAGE_BUCKET }, "menareps-uat-reset");
  const auth = getAuth(app);
  let pageToken: string | undefined;
  do {
    let page;
    try {
      page = await auth.listUsers(1000, pageToken);
    } catch (error) {
      const cause = (error as { cause?: { code?: string } }).cause;
      if (cause?.code !== "EPIPE") throw error;
      page = await auth.listUsers(1000, pageToken);
    }
    if (page.users.length) await auth.deleteUsers(page.users.map(user => user.uid));
    pageToken = page.pageToken;
  } while (pageToken);

  const db = getFirestore(app);
  for (const collection of await db.listCollections()) await db.recursiveDelete(collection);

  try {
    await getStorage(app).bucket().deleteFiles({ prefix: "uat/" });
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== 404) throw error;
  }

  if (!existing) await deleteApp(app);
}

if (process.argv[1]?.endsWith("reset.ts")) {
  await resetEmulatorState();
  console.log("MENAREPS_UAT_RESET=PASS");
}
