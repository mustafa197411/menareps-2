import fs from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { deleteObject, getBytes, ref, uploadBytes } from "firebase/storage";

const projectId = "demo-menareps-wp77";
const testEnv = await initializeTestEnvironment({
  projectId,
  firestore: { host: "127.0.0.1", port: 8089, rules: fs.readFileSync("firestore.rules", "utf8") },
  storage: { host: "127.0.0.1", port: 9199, rules: fs.readFileSync("storage.rules", "utf8") },
});

let passed = 0; let failed = 0;
async function check(name: string, action: () => Promise<unknown>) {
  try { await action(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}`, error); }
}

await testEnv.withSecurityRulesDisabled(async context => {
  const db = context.firestore();
  for (const user of [
    { id: "product-manager", role: "Product Manager", active: true },
    { id: "admin-generic", role: "Admin", active: true },
    { id: "medical-rep", role: "Medical Representative", active: true },
    { id: "inactive-admin", role: "Admin", active: false },
    { id: "legacy-identity", role: "Medical Representative", active: true },
  ]) await setDoc(doc(db, "users", user.id), user);
});

const bytes = new Uint8Array([37, 80, 68, 70]);
const objectPath = (id: string) => `resources/PG-1/RES-${id}/v1/${id}.pdf`;
const storage = (uid?: string) => uid ? testEnv.authenticatedContext(uid).storage() : testEnv.unauthenticatedContext().storage();
const upload = (uid: string | undefined, id: string, metadata = { contentType: "application/pdf" }) => uploadBytes(ref(storage(uid), objectPath(id)), bytes, metadata);

await check("unauthenticated upload denied", () => assertFails(upload(undefined, "unauth")));
await check("generic active Product Manager upload allowed", () => assertSucceeds(upload("product-manager", "pm")));
await check("generic active Admin upload allowed", () => assertSucceeds(upload("admin-generic", "admin")));
await check("Medical Representative upload denied", () => assertFails(upload("medical-rep", "rep")));
await check("inactive privileged profile upload denied", () => assertFails(upload("inactive-admin", "inactive")));
await check("legacy identity receives no identity-based privilege", () => assertFails(upload("legacy-identity", "legacy")));
await check("invalid executable content type denied", () => assertFails(upload("product-manager", "exe", { contentType: "application/x-msdownload" })));
await check("authenticated user reads an authorized resource", () => assertSucceeds(getBytes(ref(storage("medical-rep"), objectPath("pm")))));
await check("unauthenticated resource read denied", () => assertFails(getBytes(ref(storage(), objectPath("pm")))));
await check("uploader deletes canonical resource", () => assertSucceeds(deleteObject(ref(storage("product-manager"), objectPath("pm")))));
await check("non-uploader delete denied", () => assertFails(deleteObject(ref(storage("medical-rep"), objectPath("admin")))));
await check("all writes outside canonical resources path denied", () => assertFails(uploadBytes(ref(storage("product-manager"), "other/file.pdf"), bytes, { contentType: "application/pdf" })));

await testEnv.cleanup();
console.log(`WP77 Storage Rules: ${passed}/${passed + failed} passed`);
if (failed) process.exitCode = 1;
