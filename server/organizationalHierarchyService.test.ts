import { strict as assert } from "node:assert";
import {
  OrganizationalHierarchyError,
  OrganizationalHierarchyRepository,
  OrganizationalUser,
  resolveOrganizationalScope,
  isReportingAncestor,
  isEligibleSalesRepresentativeCandidate,
  listReportingDescendantsPage,
  assertHierarchyContinuationCapacity,
  HIERARCHY_CONTINUATION_MAX_BYTES,
  type ReportingDescendantRepository,
  type HierarchyContinuationDocument,
  type HierarchyContinuationSnapshot,
} from "./organizationalHierarchyService";
import { Role } from "../src/types";
import { createFirestoreOrganizationalHierarchyRepository } from "./organizationalHierarchyRepository";
import { FieldPath, type Firestore } from "firebase-admin/firestore";

const u = (id: string, role: string, managerId = "", extra: Partial<OrganizationalUser> = {}): OrganizationalUser => ({
  id, role, managerId, active: true, loginAllowed: true, country: "Libya", ...extra,
});

const tree: OrganizationalUser[] = [
  u("admin", "Admin"),
  u("gm", "General Manager", "admin"),
  u("regional", "Regional Manager", "gm"),
  u("country", "Country Manager", "regional"),
  u("medical-manager", "Medical Manager", "country"),
  u("medical-supervisor", "Medical Supervisor", "medical-manager"),
  u("medical-rep", "Medical Representative", "medical-supervisor"),
  u("medical-sibling-supervisor", "Medical Supervisor", "medical-manager"),
  u("medical-sibling-rep", "Medical Representative", "medical-sibling-supervisor"),
  u("sales-manager", "Sales Manager", "country"),
  u("sales-supervisor", "Sales Supervisor", "sales-manager"),
  u("sales-rep", "Sales Representative", "sales-supervisor"),
  u("tunisia-manager", "Sales Manager", "country", { country: "Tunisia" }),
  u("tunisia-rep", "Sales Representative", "tunisia-manager", { country: "Tunisia" }),
  u("unrelated-manager", "Medical Manager"),
  u("unrelated-rep", "Medical Representative", "unrelated-manager"),
];

function repository(records = tree, permissions: Record<string, Record<string, unknown>> = {}): OrganizationalHierarchyRepository {
  return {
    async getUser(uid) { return records.find((record) => record.id === uid) || null; },
    async getDirectReports(managerUid) { return records.filter((record) => record.managerId === managerUid); },
    async getAllUsers() { return [...records]; },
    async getRolePermissions(role) { return permissions[role] || null; },
  };
}

const resolve = (actorUid: string, request = {}, repo = repository()) =>
  resolveOrganizationalScope(actorUid, { depth: "descendants", includeSelf: true, ...request }, repo);

const supervisor = await resolve("medical-supervisor");
assert.deepEqual(supervisor.directReportUids, ["medical-rep"]);
assert.deepEqual(supervisor.descendantUids, ["medical-rep"]);
assert(!supervisor.descendantUids.includes("medical-sibling-rep"));

const medicalManager = await resolve("medical-manager");
assert(medicalManager.descendantUids.includes("medical-supervisor"));
assert(medicalManager.descendantUids.includes("medical-rep"));
assert(!medicalManager.descendantUids.includes("sales-manager"));

const salesManager = await resolve("sales-manager");
assert.deepEqual(salesManager.descendantUids, ["sales-rep", "sales-supervisor"]);

const gm = await resolve("gm");
assert(gm.descendantUids.includes("medical-rep"));
assert(gm.descendantUids.includes("sales-rep"));

const country = await resolve("country");
assert(country.descendantUids.includes("medical-rep"));
assert(country.descendantUids.includes("sales-rep"));
// Profile/display country strings are not authorization boundaries. Canonical
// territory ancestry is applied by the operational-scope resolver.
assert(country.descendantUids.includes("tunisia-manager"));
assert(country.descendantUids.includes("tunisia-rep"));

const regional = await resolve("regional");
assert(regional.descendantUids.includes("country"));
assert(regional.descendantUids.includes("medical-rep"));

const admin = await resolve("admin");
assert(admin.descendantUids.includes("unrelated-manager"));
assert(admin.descendantUids.includes("tunisia-rep"));

for (const [role, reportRole] of [
  ["Super Admin", "Medical Representative"],
  ["Sales & Marketing Manager", "Marketing Officer"],
  ["Area Sales Manager", "Sales Representative"],
  ["Sales Supervisor", "Sales Representative"],
  ["Marketing Manager", "Marketing Officer"],
] as const) {
  const manager = u(`coverage-${role}`, role);
  const report = u(`coverage-report-${role}`, reportRole, manager.id);
  const coverage = await resolveOrganizationalScope(manager.id, { depth: "descendants" }, repository([manager, report]));
  assert(coverage.descendantUids.includes(report.id), `${role} must use the canonical shared architecture`);
}

for (const role of ["Product Manager", "Finance Manager", "Warehouse Manager", "Store Manager"] as const) {
  const actor = u(`non-hierarchy-${role}`, role);
  const report = u(`non-hierarchy-report-${role}`, "Medical Representative", actor.id);
  await assert.rejects(
    () => resolveOrganizationalScope(actor.id, { depth: "descendants" }, repository([actor, report])),
    (error: OrganizationalHierarchyError) => error.code === "SUBORDINATE_ENUMERATION_DENIED",
  );
}

const inactiveBridge = [
  u("bridge-med-manager", "Medical Manager"),
  u("bridge-med-supervisor", "Medical Supervisor", "bridge-med-manager", { active: false }),
  u("bridge-med-rep", "Medical Representative", "bridge-med-supervisor"),
  u("bridge-sales-manager", "Sales Manager"),
  u("bridge-sales-supervisor", "Sales Supervisor", "bridge-sales-manager", { active: false }),
  u("bridge-sales-rep", "Sales Representative", "bridge-sales-supervisor"),
];
const medicalBridge = await resolve("bridge-med-manager", {}, repository(inactiveBridge));
assert.deepEqual(medicalBridge.descendantUids, []);
const salesBridge = await resolve("bridge-sales-manager", {}, repository(inactiveBridge));
assert.deepEqual(salesBridge.descendantUids, []);

await assert.rejects(() => resolve("medical-rep"), (error: OrganizationalHierarchyError) => error.code === "SUBORDINATE_ENUMERATION_DENIED");
await assert.rejects(
  () => resolveOrganizationalScope("medical-manager", { actorUid: "unrelated-manager" }, repository()),
  (error: OrganizationalHierarchyError) => error.code === "ACTOR_UID_MISMATCH",
);
await assert.rejects(
  () => resolveOrganizationalScope(null, {}, repository()),
  (error: OrganizationalHierarchyError) => error.code === "UNAUTHENTICATED",
);
await assert.rejects(
  () => resolve("medical-manager", {}, repository(tree.map((record) => record.id === "medical-manager" ? { ...record, active: false } : record))),
  (error: OrganizationalHierarchyError) => error.code === "ACTOR_INACTIVE",
);
await assert.rejects(
  () => resolve("medical-manager", {}, repository(tree, { "Medical Manager": { viewTeamData: false } })),
  (error: OrganizationalHierarchyError) => error.code === "HIERARCHY_PERMISSION_DENIED",
);

const a = u("a", "General Manager", "b");
const b = u("b", "Country Manager", "a");
let cycleReads = 0;
const cycleRepo = repository([a, b]);
const cycle = await resolveOrganizationalScope("a", { depth: "descendants" }, {
  ...cycleRepo,
  async getDirectReports(managerUid) { cycleReads += 1; return [a, b].filter((record) => record.managerId === managerUid); },
});
assert.deepEqual(cycle.descendantUids, ["b"]);
assert.equal(cycleReads, 2);

let duplicateReads = 0;
const duplicate = await resolveOrganizationalScope("medical-manager", { depth: "descendants" }, {
  ...repository(),
  async getDirectReports(managerUid) {
    duplicateReads += 1;
    const reports = tree.filter((record) => record.managerId === managerUid);
    return [...reports, ...reports];
  },
});
assert.equal(new Set(duplicate.allHierarchyUids).size, duplicate.allHierarchyUids.length);
assert(duplicateReads > 0);

// Reporting proof uses exact user reads, never visibility or role ranking.
const reportingUser = (id: string, managerId?: string): OrganizationalUser => ({
  id, role: managerId === undefined ? Role.SUPER_ADMIN : Role.SALES_SUPERVISOR, ...(managerId === undefined ? {} : { managerId }),
});
const reportingTree = [
  reportingUser("root"), reportingUser("manager", "root"),
  reportingUser("rep", "manager"), reportingUser("peer", "root"),
  reportingUser("peer-rep", "peer"), reportingUser("other"),
  reportingUser("other-rep", "other"),
];
for (const [ancestor, descendant, expected] of [
  ["root", "manager", true], ["root", "rep", true], ["manager", "rep", true],
  ["rep", "root", false], ["manager", "peer", false],
  ["other", "rep", false], ["root", "root", false], ["other", "root", false],
] as const) {
  const reads: string[] = [];
  assert.equal(await isReportingAncestor(ancestor, descendant, {
    async getUser(uid) { reads.push(uid); return reportingTree.find(user => user.id === uid) || null; },
  }), expected, `${ancestor} above ${descendant}`);
  assert.equal(reads.length, new Set(reads).size, "Each UID is read at most once");
  if (ancestor === descendant) assert.deepEqual(reads, []);
  else assert.equal(reads[0], descendant);
}
const exactReads: string[] = [];
assert.equal(await isReportingAncestor("manager", "rep", {
  async getUser(uid) { exactReads.push(uid); return reportingTree.find(user => user.id === uid) || null; },
}), true);
assert.deepEqual(exactReads, ["rep", "manager", "root"]);

for (const records of [
  [reportingUser("child", "missing")],
  [reportingUser("child", "child")],
  [reportingUser("child", "manager"), reportingUser("manager", "child")],
]) {
  const reads: string[] = [];
  assert.equal(await isReportingAncestor("target", "child", {
    async getUser(uid) {
      assert(!reads.includes(uid), "Repeated UID must terminate before another read");
      reads.push(uid);
      return records.find(user => user.id === uid) || null;
    },
  }), false, "Malformed chains before target proof fail closed");
}
for (const records of [
  [reportingUser("child", "target"), reportingUser("target", "missing")],
  [reportingUser("child", "target"), reportingUser("target", "target")],
  [reportingUser("child", "target"), reportingUser("target", "top"), reportingUser("top", "child")],
]) {
  const reads: string[] = [];
  assert.equal(await isReportingAncestor("target", "child", {
    async getUser(uid) {
      assert(!reads.includes(uid), "Repeated UID must terminate");
      reads.push(uid);
      return records.find(user => user.id === uid) || null;
    },
  }), false, "Malformed hierarchy above creator fails closed");
  assert.deepEqual(reads.slice(0, 2), ["child", "target"]);
}
for (const managerId of ["", null, 7, {}, " target", "target ", " ", "bad/path"]) {
  assert.equal(await isReportingAncestor("target", "child", {
    async getUser() { return { ...reportingUser("child"), managerId } as OrganizationalUser; },
  }), false);
}
assert.equal(await isReportingAncestor("target", "missing", { async getUser() { return null; } }), false);
assert.equal(await isReportingAncestor("target", "child", {
  async getUser() { return reportingUser("wrong-identity", "target"); },
}), false);
assert.equal(await isReportingAncestor("target", "child", {
  async getUser(uid) { return uid === "child" ? reportingUser("child", "target") : reportingUser("wrong-target"); },
}), false);
for (const [ancestor, descendant] of [["", "child"], ["target", " child"], ["bad/path", "child"]]) {
  assert.equal(await isReportingAncestor(ancestor, descendant, {
    async getUser() { assert.fail("Invalid identities must not be queried"); },
  }), false);
}
const readFailure = new Error("synthetic-read-failure");
await assert.rejects(() => isReportingAncestor("target", "child", {
  async getUser() { throw readFailure; },
}), error => error === readFailure);

const visibilityTree = [
  { ...reportingUser("visible-admin"), role: "Admin" },
  { ...reportingUser("branch-manager", "branch-root"), role: "Sales Manager" },
  reportingUser("branch-root"),
  { ...reportingUser("branch-rep", "branch-manager"), role: "Sales Representative" },
];
const visibleScope = await resolveOrganizationalScope("visible-admin", {}, repository(visibilityTree));
assert(visibleScope.descendantUids.includes("branch-rep"));
assert.equal(await isReportingAncestor("visible-admin", "branch-rep", repository(visibilityTree)), false);
assert.equal(await isReportingAncestor("branch-manager", "branch-rep", repository(visibilityTree)), true);
assert.deepEqual(await resolveOrganizationalScope("visible-admin", {}, repository(visibilityTree)), visibleScope);

console.log("Backend organizational hierarchy authorization and reporting ancestry tests passed.");

// Bounded discovery is intentionally separate from organizational visibility.
const candidate = (id: string, managerId?: string, extra: Partial<OrganizationalUser> = {}): OrganizationalUser => ({
  id, role: managerId === undefined ? Role.SUPER_ADMIN : Role.SALES_REP, active: true, ...(managerId === undefined ? {} : { managerId }), ...extra,
});
const request = { rootUid: "ROOT" };
const errorCode = (code: string) => (error: unknown) => error instanceof OrganizationalHierarchyError && error.code === code;

function discoveryRepository(records: OrganizationalUser[]) {
  const states = new Map<string, HierarchyContinuationSnapshot>();
  let revision = 0;
  let reads = 0;
  let emptyQueries = 0;
  const queries: Array<{ manager: string; after?: string; limit: number }> = [];
  const repo: ReportingDescendantRepository = {
    async getUser(uid) {
      const record = records.find(user => user.id === uid) ?? null;
      reads += 1 + (record ? 1 : 0);
      return record;
    },
    async getDirectReportsPage(manager, after, limit) {
      assert(Number.isInteger(limit) && limit > 0 && limit <= 100);
      const result = records.filter(user => user.managerId === manager &&
        (after === undefined || Buffer.compare(Buffer.from(user.id), Buffer.from(after)) > 0))
        .sort((left, right) => Buffer.compare(Buffer.from(left.id), Buffer.from(right.id))).slice(0, limit);
      reads += 1 + result.length;
      if (!result.length) emptyQueries++;
      queries.push({ manager, after, limit });
      return result;
    },
    async getContinuation(token) {
      const stored = states.get(token);
      reads += 1 + (stored ? 1 : 0);
      return stored ? structuredClone(stored) : null;
    },
    async advanceContinuation(current, replacement) {
      if (replacement) assertHierarchyContinuationCapacity(replacement.document);
      if (current && states.get(current.token)?.revision !== current.revision) {
        throw new OrganizationalHierarchyError("HIERARCHY_CONTINUATION_CONFLICT", 409, "Synthetic compare-and-swap conflict");
      }
      if (current) states.delete(current.token);
      if (replacement) states.set(replacement.token, { ...structuredClone(replacement), revision: ++revision });
    },
  };
  return { repo, states, queries, get reads() { return reads; }, get emptyQueries() { return emptyQueries; } };
}

// One record predicate serves discovery and later known-ID validation. Malformed
// enumeration still throws atomically rather than skipping an invalid branch.
for (const [extra, eligible] of [
  [{}, true],
  [{ active: false }, false], [{ loginAllowed: false }, false], [{ isDeleted: true }, false],
  [{ status: "Inactive" }, false], [{ status: "Archived" }, false], [{ status: "Suspended" }, false],
  [{ employmentStatus: "Inactive" }, false], [{ employmentStatus: "Archived" }, false], [{ employmentStatus: "Suspended" }, false],
  [{ accountStatus: "INACTIVE" }, false], [{ role: Role.MEDICAL_REP }, false],
  [{ role: "sales representative" }, false], [{ role: `${Role.SALES_REP} ` }, false],
] as Array<[Partial<OrganizationalUser>, boolean]>) {
  const record = candidate("CANDIDATE", "ROOT", extra);
  const before = structuredClone(record);
  assert.equal(isEligibleSalesRepresentativeCandidate(record, record.id), eligible);
  const fake = discoveryRepository([candidate("ROOT"), record, candidate("LEAF", record.id)]);
  const page = await listReportingDescendantsPage("ACTOR", request, fake.repo);
  assert.equal(page.representatives.some(user => user.id === record.id), eligible);
  assert(page.representatives.some(user => user.id === "LEAF"), "Ineligible intermediaries remain traversable");
  assert.deepEqual(record, before, "Eligibility must not mutate or normalize the user");
}
assert.equal(isEligibleSalesRepresentativeCandidate(null), false);
assert.equal(isEligibleSalesRepresentativeCandidate(candidate("CANDIDATE", "ROOT"), "OTHER"), false);
for (const extra of [
  { id: " bad" }, { managerId: "bad/path" }, { managerId: "CANDIDATE" },
  { active: "true" }, { loginAllowed: 1 }, { status: 1 }, { role: "" },
]) {
  const record = { ...candidate("CANDIDATE", "ROOT"), ...extra } as OrganizationalUser;
  assert.equal(isEligibleSalesRepresentativeCandidate(record), false);
  const fake = discoveryRepository([candidate("ROOT")]);
  fake.repo.getDirectReportsPage = async () => [record];
  await assert.rejects(() => listReportingDescendantsPage("ACTOR", request, fake.repo), errorCode("HIERARCHY_MALFORMED"));
  assert.equal(fake.states.size, 0);
}

const branching = [candidate("ROOT"),
  candidate("A", "ROOT", { active: false }),
  candidate("B", "ROOT", { role: Role.MEDICAL_REP }),
  candidate("C", "ROOT"), candidate("D", "A"), candidate("E", "B"),
  candidate("F", "C"), candidate("G", "D"), candidate("OUTSIDE")];
const bfs = discoveryRepository(branching);
const allResults: string[] = [];
let continuationToken: string | undefined;
let pageCount = 0;
do {
  const before = bfs.reads;
  const page = await listReportingDescendantsPage("ACTOR", { ...request, pageSize: 1, continuationToken }, bfs.repo);
  assert.equal(page.workUnits, bfs.reads - before);
  assert(page.workUnits <= 1000);
  allResults.push(...page.representatives.map(user => user.id));
  continuationToken = page.continuationToken;
  assert(++pageCount < 30, "Synthetic traversal must complete");
} while (continuationToken);
assert.deepEqual(allResults, ["C", "D", "E", "F", "G"]);
assert.equal(bfs.states.size, 0);
assert(bfs.queries.some(query => query.manager === "ROOT" && query.after === "A"));
assert.equal(new Set(allResults).size, allResults.length);
assert(!allResults.includes("ROOT"));

const wide = [candidate("ROOT"), ...Array.from({ length: 130 }, (_, i) => candidate(`REP-${String(i).padStart(3, "0")}`, "ROOT"))];
for (const [pageSize, expected] of [[undefined, 50], [100, 100]] as const) {
  const fake = discoveryRepository(wide);
  const result = await listReportingDescendantsPage("ACTOR", { ...request, pageSize }, fake.repo);
  assert.equal(result.representatives.length, expected);
  assert(result.continuationToken);
}
for (const pageSize of [0, -1, 101, 1.5, NaN, Infinity, null, "50"]) {
  const fake = discoveryRepository(wide);
  await assert.rejects(() => listReportingDescendantsPage("ACTOR", { ...request, pageSize: pageSize as number }, fake.repo), errorCode("HIERARCHY_DISCOVERY_REQUEST_INVALID"));
  assert.equal(fake.reads, 0);
}

// A wide ineligible level exhausts work, not results; all branches survive.
const budgetTree = [candidate("ROOT"), ...Array.from({ length: 1200 }, (_, i) => candidate(`NODE-${String(i).padStart(4, "0")}`, "ROOT", { role: Role.MEDICAL_REP })),
  candidate("LAST-REP", "NODE-1199")];
const budget = discoveryRepository(budgetTree);
let budgetToken: string | undefined;
const budgetResults: string[] = [];
let budgetPages = 0;
do {
  const before = budget.reads;
  const page = await listReportingDescendantsPage("ACTOR", { ...request, continuationToken: budgetToken }, budget.repo);
  assert.equal(page.workUnits, budget.reads - before);
  assert(page.workUnits <= 1000);
  if (!budgetPages) { assert.equal(page.representatives.length, 0); assert(page.continuationToken); }
  budgetResults.push(...page.representatives.map(user => user.id));
  budgetToken = page.continuationToken;
  assert(++budgetPages < 20);
} while (budgetToken);
assert.deepEqual(budgetResults, ["LAST-REP"]);
assert(budget.emptyQueries >= 1200, "Zero-result queries are executed and charged");
assert.equal(budget.states.size, 0);

for (const inactive of [
  { active: false }, { isDeleted: true }, { loginAllowed: false },
  { status: "Inactive" }, { status: "Archived" }, { status: "Suspended" },
  { employmentStatus: "Inactive" }, { employmentStatus: "Archived" }, { employmentStatus: "Suspended" },
  { accountStatus: "INACTIVE" }, { role: Role.MEDICAL_REP },
]) {
  const fake = discoveryRepository([candidate("ROOT"), candidate("BRIDGE", "ROOT", inactive), candidate("LEAF", "BRIDGE")]);
  const page = await listReportingDescendantsPage("ACTOR", request, fake.repo);
  assert.deepEqual(page.representatives.map(user => user.id), ["LEAF"]);
}

// Malformed data rejects the whole promise, even after a valid result accumulated.
for (const bad of [
  candidate("BAD", "WRONG"), candidate("ROOT", "ROOT"), candidate("BAD", "BAD"),
  candidate("BAD", "ROOT", { id: " bad" }), candidate("BAD", "ROOT", { managerId: "bad/path" }),
  candidate("BAD", "ROOT", { active: "true" as unknown as boolean }),
]) {
  const fake = discoveryRepository([candidate("ROOT")]);
  fake.repo.getDirectReportsPage = async () => [candidate("A", "ROOT"), bad];
  await assert.rejects(() => listReportingDescendantsPage("ACTOR", request, fake.repo), errorCode("HIERARCHY_MALFORMED"));
  assert.equal(fake.states.size, 0);
}
for (const records of [
  [], [candidate("ROOT", "ROOT")],
  [candidate("ROOT", "CHILD"), candidate("CHILD", "ROOT")],
  [candidate("ROOT"), candidate("A", "ROOT"), candidate("A", "ROOT")],
]) {
  await assert.rejects(() => listReportingDescendantsPage("ACTOR", request, discoveryRepository(records).repo), errorCode("HIERARCHY_MALFORMED"));
}
const mismatchedIdentity = discoveryRepository([]);
mismatchedIdentity.repo.getUser = async () => candidate("DIFFERENT");
await assert.rejects(() => listReportingDescendantsPage("ACTOR", request, mismatchedIdentity.repo), errorCode("HIERARCHY_MALFORMED"));

let clock = 100000;
const timed = discoveryRepository(wide);
const firstPage = await listReportingDescendantsPage("ACTOR", request, timed.repo, { now: () => clock });
const firstToken = firstPage.continuationToken!;
const original = timed.states.get(firstToken)!.document as HierarchyContinuationDocument;
clock += 60000;
const secondPage = await listReportingDescendantsPage("ACTOR", { ...request, continuationToken: firstToken }, timed.repo, { now: () => clock });
assert(!timed.states.has(firstToken));
assert.notEqual(secondPage.continuationToken, firstToken);
const successor = timed.states.get(secondPage.continuationToken!)!.document as HierarchyContinuationDocument;
assert.equal(successor.createdAt, original.createdAt);
assert.equal(successor.expiresAt, original.createdAt + 30 * 60 * 1000);
await assert.rejects(() => listReportingDescendantsPage("ACTOR", { ...request, continuationToken: firstToken }, timed.repo, { now: () => clock }), errorCode("HIERARCHY_CONTINUATION_INVALID"));

for (const [actorUid, changed] of [["OTHER", request], ["ACTOR", { rootUid: "OTHER" }], ["ACTOR", { ...request, pageSize: 1 }]] as const) {
  await assert.rejects(() => listReportingDescendantsPage(actorUid, { ...changed, continuationToken: secondPage.continuationToken }, timed.repo, { now: () => clock }), errorCode("HIERARCHY_CONTINUATION_MISMATCH"));
  assert(timed.states.has(secondPage.continuationToken!));
}
clock = successor.expiresAt;
await assert.rejects(() => listReportingDescendantsPage("ACTOR", { ...request, continuationToken: secondPage.continuationToken }, timed.repo, { now: () => clock }), errorCode("HIERARCHY_CONTINUATION_EXPIRED"));
assert.equal(timed.states.size, 0);

const concurrent = discoveryRepository(wide);
const initialConcurrent = await listReportingDescendantsPage("ACTOR", request, concurrent.repo);
const races = await Promise.allSettled([1, 2].map(() => listReportingDescendantsPage("ACTOR", { ...request, continuationToken: initialConcurrent.continuationToken }, concurrent.repo)));
assert.equal(races.filter(result => result.status === "fulfilled").length, 1);
const rejectedRace = races.find(result => result.status === "rejected") as PromiseRejectedResult;
assert(errorCode("HIERARCHY_CONTINUATION_CONFLICT")(rejectedRace.reason));
assert.equal(concurrent.states.size, 1);

for (const stateJson of ["{", JSON.stringify({ frontier: ["ROOT", "ROOT"], discoveredIds: ["ROOT"] }),
  JSON.stringify({ frontier: ["UNKNOWN"], discoveredIds: ["ROOT"] })]) {
  const fake = discoveryRepository(wide);
  const initial = await listReportingDescendantsPage("ACTOR", request, fake.repo);
  (fake.states.get(initial.continuationToken!)!.document as HierarchyContinuationDocument).stateJson = stateJson;
  await assert.rejects(() => listReportingDescendantsPage("ACTOR", { ...request, continuationToken: initial.continuationToken }, fake.repo), errorCode("HIERARCHY_MALFORMED"));
  assert.equal(fake.states.size, 0);
}
// Cursor provenance and BFS position must be valid before any hierarchy read.
for (const invalidState of [
  { frontier: ["ROOT"], discoveredIds: ["ROOT"], afterDocumentId: "ROOT" },
  { frontier: ["ROOT"], discoveredIds: ["ROOT"], afterDocumentId: "ROOT", afterManagerUid: "ROOT" },
  // A previously expanded manager cannot be the current manager's child cursor.
  { frontier: ["B", "C"], discoveredIds: ["ROOT", "A", "B", "C"], afterDocumentId: "A", afterManagerUid: "B" },
  // Even the latest discovered node is invalid if it belongs to another parent.
  { frontier: ["B", "C"], discoveredIds: ["ROOT", "A", "B", "C"], afterDocumentId: "C", afterManagerUid: "A" },
  { frontier: ["ROOT", "A"], discoveredIds: ["ROOT", "A"], afterDocumentId: "A" },
  { frontier: ["ROOT", "A"], discoveredIds: ["ROOT", "A"], afterManagerUid: "ROOT" },
]) {
  const fake = discoveryRepository(wide);
  const initial = await listReportingDescendantsPage("ACTOR", request, fake.repo);
  (fake.states.get(initial.continuationToken!)!.document as HierarchyContinuationDocument).stateJson = JSON.stringify(invalidState);
  const queriesBefore = fake.queries.length;
  fake.repo.getUser = async () => assert.fail("Malformed cursor must reject before exact hierarchy reads");
  fake.repo.getDirectReportsPage = async () => assert.fail("Malformed cursor must reject before hierarchy queries");
  let resultEscaped = false;
  await assert.rejects(async () => {
    await listReportingDescendantsPage("ACTOR", { ...request, continuationToken: initial.continuationToken }, fake.repo);
    resultEscaped = true;
  }, errorCode("HIERARCHY_MALFORMED"));
  assert.equal(resultEscaped, false);
  assert.equal(fake.queries.length, queriesBefore);
  assert.equal(fake.states.size, 0, "Malformed current token must be invalidated without a successor");
}

const validCursor = discoveryRepository([candidate("ROOT"), candidate("A", "ROOT"), candidate("B", "ROOT")]);
const validFirst = await listReportingDescendantsPage("ACTOR", { ...request, pageSize: 1 }, validCursor.repo);
const validState = JSON.parse((validCursor.states.get(validFirst.continuationToken!)!.document as HierarchyContinuationDocument).stateJson);
assert.equal(validState.afterDocumentId, "A");
assert.equal(validState.afterManagerUid, "ROOT");
const validSecond = await listReportingDescendantsPage("ACTOR", { ...request, pageSize: 1, continuationToken: validFirst.continuationToken }, validCursor.repo);
assert.deepEqual([...validFirst.representatives, ...validSecond.representatives].map(user => user.id), ["A", "B"]);
const validFinal = await listReportingDescendantsPage("ACTOR", { ...request, pageSize: 1, continuationToken: validSecond.continuationToken }, validCursor.repo);
assert.deepEqual(validFinal.representatives, []);
assert.equal(validFinal.continuationToken, undefined);
assert.equal(validCursor.states.size, 0);

const resumedMalformed = discoveryRepository(wide);
const initialMalformed = await listReportingDescendantsPage("ACTOR", request, resumedMalformed.repo);
resumedMalformed.repo.getDirectReportsPage = async () => [candidate("REP-050", "ROOT"), candidate("REP-051", "WRONG")];
await assert.rejects(() => listReportingDescendantsPage("ACTOR", { ...request, continuationToken: initialMalformed.continuationToken }, resumedMalformed.repo), errorCode("HIERARCHY_MALFORMED"));
assert.equal(resumedMalformed.states.size, 0);

const boundaryDocument: HierarchyContinuationDocument = { ...original, stateJson: "" };
const overhead = Buffer.byteLength(JSON.stringify(boundaryDocument), "utf8");
boundaryDocument.stateJson = "x".repeat(HIERARCHY_CONTINUATION_MAX_BYTES - overhead);
assertHierarchyContinuationCapacity(boundaryDocument);
await assert.rejects(async () => assertHierarchyContinuationCapacity({ ...boundaryDocument, stateJson: boundaryDocument.stateJson + "x" }), errorCode("HIERARCHY_CONTINUATION_CAPACITY_EXCEEDED"));
// UTF-8 bytes and JSON escaping both count, not JS character count alone.
await assert.rejects(async () => assertHierarchyContinuationCapacity({ ...boundaryDocument, stateJson: "é".repeat(boundaryDocument.stateJson.length) }), errorCode("HIERARCHY_CONTINUATION_CAPACITY_EXCEEDED"));

const oversized = discoveryRepository([candidate("ROOT"), ...Array.from({ length: 100 }, (_, i) => candidate(`${String(i).padStart(3, "0")}-${"x".repeat(1400)}`, "ROOT"))]);
const smallStart = await listReportingDescendantsPage("ACTOR", { ...request, pageSize: 1 }, discoveryRepository(wide).repo);
assert(smallStart.continuationToken);
// Seed a valid near-capacity continuation, then discover enough new IDs to exceed it.
const hugeIds = Array.from({ length: 460 }, (_, i) => `OLD-${i}-${"x".repeat(1400)}`);
const nearCapacity: HierarchyContinuationDocument = { ...original, createdAt: Date.now(), expiresAt: Date.now() + 30 * 60 * 1000,
  stateJson: JSON.stringify({ frontier: ["ROOT"], discoveredIds: ["ROOT"] }) };
nearCapacity.expiresAt = nearCapacity.createdAt + 30 * 60 * 1000;
// Expanded IDs precede the pending root only in a valid FIFO; use a pending manager last.
nearCapacity.stateJson = JSON.stringify({ frontier: ["PENDING"], discoveredIds: ["ROOT", ...hugeIds, "PENDING"] });
assertHierarchyContinuationCapacity(nearCapacity);
oversized.repo.getUser = async uid => candidate(uid, uid === "ROOT" ? undefined : "ROOT");
const realPage = oversized.repo.getDirectReportsPage;
oversized.repo.getDirectReportsPage = async (manager, after, limit) => manager === "PENDING"
  ? (await realPage("ROOT", after, limit)).map(user => ({ ...user, managerId: "PENDING" })) : [];
oversized.states.set("CAPACITY-TOKEN", { token: "CAPACITY-TOKEN", revision: 1, document: nearCapacity });
await assert.rejects(() => listReportingDescendantsPage("ACTOR", { ...request, continuationToken: "CAPACITY-TOKEN" }, oversized.repo), errorCode("HIERARCHY_CONTINUATION_CAPACITY_EXCEEDED"));
assert.equal(oversized.states.size, 1, "Oversized replacement must not consume the valid original state");
assert.deepEqual(oversized.states.get("CAPACITY-TOKEN")!.document, nearCapacity);

// Repository query and atomic write contract: injected Firestore double only.
const calls: unknown[][] = [];
let rows: Array<{ id: string; data(): Record<string, unknown> }> = [];
let commitCode: number | undefined;
const query = {
  where(...args: unknown[]) { calls.push(["where", ...args]); return this; },
  orderBy(...args: unknown[]) { calls.push(["orderBy", ...args]); return this; },
  startAfter(...args: unknown[]) { calls.push(["startAfter", ...args]); return this; },
  limit(...args: unknown[]) { calls.push(["limit", ...args]); return this; },
  async get() { assert(calls.some(call => call[0] === "limit")); calls.push(["queryGet"]); return { docs: rows }; },
  doc(id: string) { return { id, async get() { calls.push(["documentGet", id]); return { exists: false }; } }; },
};
const fakeDb = {
  collection(name: string) { calls.push(["collection", name]); return query; },
  batch() { return {
    delete(ref: { id: string }, precondition: unknown) { calls.push(["delete", ref.id, precondition]); },
    create(ref: { id: string }, data: unknown) { calls.push(["create", ref.id, data]); },
    async commit() { calls.push(["commit"]); if (commitCode) throw { code: commitCode }; },
  }; },
};
const firestoreRepository = createFirestoreOrganizationalHierarchyRepository(fakeDb as unknown as Firestore);
await firestoreRepository.getDirectReportsPage("ROOT", "LAST", 50);
assert.deepEqual(calls.slice(0, 6), [["collection", "users"], ["where", "managerId", "==", "ROOT"],
  ["orderBy", FieldPath.documentId(), "asc"], ["startAfter", "LAST"], ["limit", 50], ["queryGet"]]);
calls.length = 0;
await firestoreRepository.getDirectReportsPage("ROOT", undefined, 1);
assert(!calls.some(call => call[0] === "startAfter"));
rows = [{ id: "CANONICAL", data: () => ({ id: "FORGED", managerId: "ROOT" }) }];
await assert.rejects(() => firestoreRepository.getDirectReportsPage("ROOT", undefined, 1), errorCode("HIERARCHY_MALFORMED"));
calls.length = 0;
await firestoreRepository.getContinuation("OPAQUE");
assert.deepEqual(calls, [["collection", "organizationalHierarchyContinuations"], ["documentGet", "OPAQUE"]]);
calls.length = 0;
await firestoreRepository.advanceContinuation({ token: "OLD", document: original, revision: "VERSION" }, { token: "NEW", document: original });
assert.equal(calls.filter(call => call[0] === "commit").length, 1);
assert.deepEqual(calls.find(call => call[0] === "delete"), ["delete", "OLD", { lastUpdateTime: "VERSION" }]);
assert(calls.some(call => call[0] === "create" && call[1] === "NEW"));
commitCode = 9;
await assert.rejects(() => firestoreRepository.advanceContinuation({ token: "OLD", document: original, revision: "VERSION" }, undefined), errorCode("HIERARCHY_CONTINUATION_CONFLICT"));
console.log("Bounded reporting-descendant discovery, continuation and repository tests passed.");
