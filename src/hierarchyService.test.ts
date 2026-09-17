import { strict as assert } from "node:assert";
import { Role, User } from "./types";
import { resolveSubordinateScope } from "./lib/hierarchyService";

const user = (id: string, role: Role, managerId = "", extra: Partial<User> = {}): User => ({
  id, name: id, email: `${id}@example.com`, role, managerId,
  territory: "Area", region: "District", country: "Libya", district: "West", city: "Tripoli",
  areaIds: [`area-${id}`], active: true, ...extra,
});

const users = [
  user("admin", Role.ADMIN),
  user("gm", Role.GENERAL_MANAGER, "admin"),
  user("medical-manager", Role.MEDICAL_MANAGER, "gm"),
  user("medical-supervisor", Role.MEDICAL_SUPERVISOR, "medical-manager"),
  user("medical-rep", Role.MEDICAL_REP, "medical-supervisor"),
  user("sales-manager", Role.SALES_MANAGER, "gm"),
  user("sales-supervisor", Role.SALES_SUPERVISOR, "sales-manager"),
  user("sales-rep", Role.SALES_REP, "sales-supervisor"),
  user("inactive-manager", Role.COUNTRY_MANAGER, "gm", { active: false }),
  user("active-below-inactive", Role.AREA_SALES_MANAGER, "inactive-manager"),
];

const fetchFrom = (records: User[]) => async (managerUid: string) =>
  records.filter((record) => record.managerId === managerUid);

async function scope(actorId: string, records = users) {
  return resolveSubordinateScope(actorId, {
    actor: records.find((record) => record.id === actorId)!,
    fetchDirectReports: fetchFrom(records),
  });
}

const supervisor = await scope("medical-supervisor");
assert.deepEqual(supervisor.directReportUids, ["medical-rep"]);
assert.deepEqual(supervisor.descendantUids, ["medical-rep"]);
assert.deepEqual(supervisor.allHierarchyUids, ["medical-rep", "medical-supervisor"]);

const medicalManager = await scope("medical-manager");
assert.deepEqual(medicalManager.directReportUids, ["medical-supervisor"]);
assert.deepEqual(medicalManager.descendantUids, ["medical-rep", "medical-supervisor"]);

const gm = await scope("gm");
assert.deepEqual(gm.directReportUids, ["medical-manager", "sales-manager"]);
assert(gm.descendantUids.includes("medical-rep"));
assert(gm.descendantUids.includes("sales-rep"));
assert(gm.descendantUids.includes("active-below-inactive"));
assert(!gm.descendantUids.includes("inactive-manager"));
assert.equal(gm.allHierarchyUsers.find((record) => record.id === "medical-rep")?.country, "Libya");

for (const role of [Role.REGIONAL_MANAGER, Role.COUNTRY_MANAGER, Role.PRODUCT_MANAGER, Role.FINANCE_MANAGER, Role.WAREHOUSE_MANAGER, Role.STORE_MANAGER]) {
  const manager = user(`manager-${role}`, role);
  const report = user(`report-${role}`, Role.MEDICAL_REP, manager.id);
  const result = await scope(manager.id, [manager, report]);
  assert.deepEqual(result.directReportUids, [report.id]);
}

let representativeQueries = 0;
const representative = user("standalone-rep", Role.MEDICAL_REP);
const representativeScope = await resolveSubordinateScope(representative.id, {
  actor: representative,
  fetchDirectReports: async () => { representativeQueries += 1; return []; },
});
assert.equal(representativeQueries, 0);
assert.deepEqual(representativeScope.allHierarchyUids, [representative.id]);

const a = user("a", Role.GENERAL_MANAGER, "b");
const b = user("b", Role.COUNTRY_MANAGER, "a");
let cycleQueries = 0;
const cycle = await resolveSubordinateScope(a.id, {
  actor: a,
  fetchDirectReports: async (managerUid) => {
    cycleQueries += 1;
    return [a, b].filter((record) => record.managerId === managerUid);
  },
});
assert.deepEqual(cycle.descendantUids, ["b"]);
assert.equal(cycleQueries, 2);

const excludeBranch = await resolveSubordinateScope("gm", {
  actor: users.find((record) => record.id === "gm")!,
  inactiveUserPolicy: "exclude-branch",
  fetchDirectReports: fetchFrom(users),
});
assert(!excludeBranch.descendantUids.includes("active-below-inactive"));

console.log("Hierarchy service tests passed.");
