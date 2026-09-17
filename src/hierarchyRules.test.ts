import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import * as fs from "node:fs";

const PROJECT_ID = "menareps-hierarchy-rules-test";
const HOST = "127.0.0.1";
const PORT = 8089;
const canonicalManagerRoles = [
  "General Manager",
  "Regional Manager",
  "Country Manager",
  "Sales & Marketing Manager",
  "Sales Manager",
  "Area Sales Manager",
  "Medical Manager",
  "Marketing Manager",
] as const;
const restrictedNonHierarchyRoles = [
  "Product Manager",
  "Finance Officer",
  "Warehouse Manager",
  "Store Manager",
] as const;

const env = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    rules: fs.readFileSync("firestore.rules", "utf8"),
    host: HOST,
    port: PORT,
  },
});

const users = [
  { id: "admin", email: "test-admin-99@menareps.com", role: "Admin", active: true },
  { id: "gm", email: "gm@example.com", role: "General Manager", active: true },
  { id: "mspr", email: "mspr@example.com", role: "Medical Supervisor", active: true, managerId: "gm" },
  { id: "mmgr", email: "mmgr@example.com", role: "Medical Manager", active: true, managerId: "gm" },
  { id: "mspr-report", email: "mspr-report@example.com", role: "Medical Representative", active: true, managerId: "mspr" },
  { id: "mmgr-report", email: "mmgr-report@example.com", role: "Medical Supervisor", active: true, managerId: "mmgr" },
  { id: "gm-report", email: "gm-report@example.com", role: "Country Manager", active: true, managerId: "gm" },
  { id: "rep", email: "rep@example.com", role: "Medical Representative", active: true, managerId: "mspr" },
  { id: "other-manager", email: "other-manager@example.com", role: "Sales Manager", active: true },
  { id: "other-report", email: "other-report@example.com", role: "Sales Representative", active: true, managerId: "other-manager" },
  ...canonicalManagerRoles.flatMap((role, index) => [
    { id: `role-manager-${index}`, email: `role-manager-${index}@example.com`, role, active: true },
    { id: `role-report-${index}`, email: `role-report-${index}@example.com`, role: "Medical Representative", active: true, managerId: `role-manager-${index}` },
  ]),
  ...restrictedNonHierarchyRoles.flatMap((role, index) => [
    { id: `restricted-manager-${index}`, email: `restricted-manager-${index}@example.com`, role, active: true },
    { id: `restricted-report-${index}`, email: `restricted-report-${index}@example.com`, role: "Medical Representative", active: true, managerId: `restricted-manager-${index}` },
  ]),
];

function actorDb(uid: string, email: string) {
  return env.authenticatedContext(uid, { email }).firestore();
}

function directReports(db: ReturnType<typeof actorDb>, managerId: string) {
  return getDocs(query(collection(db, "users"), where("managerId", "==", managerId)));
}

let failures = 0;
async function check(name: string, operation: () => Promise<unknown>) {
  try {
    await operation();
    console.log(`[PASS] ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`[FAIL] ${name}`, error);
  }
}

try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    for (const user of users) {
      await setDoc(doc(context.firestore(), "users", user.id), user);
    }
  });

  const msprDb = actorDb("mspr", "mspr@example.com");
  const mmgrDb = actorDb("mmgr", "mmgr@example.com");
  const gmDb = actorDb("gm", "gm@example.com");
  const adminDb = actorDb("admin", "test-admin-99@menareps.com");
  const repDb = actorDb("rep", "rep@example.com");
  const otherManagerDb = actorDb("other-manager", "other-manager@example.com");
  const unauthenticatedDb = env.unauthenticatedContext().firestore();

  await check("ALLOW MSPR queries its own direct reports", () => assertSucceeds(directReports(msprDb, "mspr")));
  await check("ALLOW Medical Manager queries its own direct reports (classification)", () => assertSucceeds(directReports(mmgrDb, "mmgr")));
  await check("ALLOW GM queries its own direct reports", () => assertSucceeds(directReports(gmDb, "gm")));
  await check("ALLOW Admin retains unrestricted users visibility", () => assertSucceeds(getDocs(collection(adminDb, "users"))));
  await check("ALLOW direct get of a legitimate subordinate", () => assertSucceeds(getDoc(doc(msprDb, "users", "mspr-report"))));
  for (const [index, role] of canonicalManagerRoles.entries()) {
    const roleManagerDb = actorDb(`role-manager-${index}`, `role-manager-${index}@example.com`);
    await check(`ALLOW canonical manager classification: ${role}`, () =>
      assertSucceeds(directReports(roleManagerDb, `role-manager-${index}`)),
    );
  }
  for (const [index, role] of restrictedNonHierarchyRoles.entries()) {
    const restrictedDb = actorDb(`restricted-manager-${index}`, `restricted-manager-${index}@example.com`);
    await check(`DENY restricted operational hierarchy classification: ${role}`, () =>
      assertFails(directReports(restrictedDb, `restricted-manager-${index}`)),
    );
  }

  await check("DENY MSPR queries Medical Manager's reports", () => assertFails(directReports(msprDb, "mmgr")));
  await check("DENY representative queries MSPR's reports", () => assertFails(directReports(repDb, "mspr")));
  await check("DENY representative performs unbounded users list", () => assertFails(getDocs(collection(repDb, "users"))));
  await check("DENY supervisor performs unbounded users list", () => assertFails(getDocs(collection(msprDb, "users"))));
  await check("DENY supervisor queries arbitrary unrelated managerId", () => assertFails(directReports(msprDb, "other-manager")));
  await check("DENY unauthenticated users query", () => assertFails(directReports(unauthenticatedDb, "mspr")));
  await check("DENY unrelated manager enumerates another branch", () => assertFails(directReports(otherManagerDb, "mspr")));
  await check("DENY unrelated manager directly gets another branch subordinate", () => assertFails(getDoc(doc(otherManagerDb, "users", "mspr-report"))));
} finally {
  await env.cleanup();
}

if (failures > 0) {
  process.exitCode = 1;
} else {
  console.log("Hierarchy rules authorization matrix passed.");
}
