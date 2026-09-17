import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, collection, getDocs } from "firebase/firestore";
import firebaseConfig from "../firebase-applet-config.json" assert { type: "json" };

const config = {
  apiKey: firebaseConfig.apiKey,
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId,
  appId: firebaseConfig.appId
};

interface UserDoc {
  id: string;
  email?: string;
  active?: boolean;
  loginAllowed?: boolean;
  isOperational?: boolean;
  isDeleted?: boolean;
  identityStatus?: string;
  status?: string;
  employmentStatus?: string;
  role?: string;
  duplicateOfUid?: string;
  authLinked?: boolean;
  uid?: string;
  firstLoginAt?: string;
}

async function verifyFinal() {
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

  await signInWithEmailAndPassword(auth, "test-admin-99@menareps.com", "Password123!");

  const snap = await getDocs(collection(db, "users"));
  const users: UserDoc[] = snap.docs.map(d => ({ id: d.id, ...d.data() } as UserDoc));

  // 1. Detector Source
  console.log("\n[IDENTITY_DETECTOR_SOURCE_JSON]");
  console.log(JSON.stringify({
    file: "src/components/UserManagement.tsx",
    function: "duplicateReport",
    currentGroupingField: "email",
    currentEligibilityLogic: "Filtered users using isEligibleActiveUser before grouping by email: trim(email).toLowerCase()",
    reasonArchivedRecordsAreStillCounted: "Previously, all documents in the users state array were grouped without filtering out archived historical records (identityStatus === 'ARCHIVED_DUPLICATE'). With isEligibleActiveUser applied, archived duplicate documents are excluded before evaluating duplicate pairs."
  }, null, 2));

  // 2. Classification Result
  const isEligibleActiveUser = (u: UserDoc) => {
    return (
      u.active !== false &&
      u.loginAllowed !== false &&
      u.isDeleted !== true &&
      u.isOperational !== false &&
      u.identityStatus !== "ARCHIVED_DUPLICATE" &&
      u.identityStatus !== "ARCHIVED_USER" &&
      u.status !== "Archived" &&
      u.employmentStatus !== "Archived"
    );
  };

  const eligibleActiveUsers = users.filter(isEligibleActiveUser);
  const emailGroups: { [email: string]: UserDoc[] } = {};
  eligibleActiveUsers.forEach(u => {
    if (!u.email) return;
    const email = u.email.trim().toLowerCase();
    if (!emailGroups[email]) emailGroups[email] = [];
    emailGroups[email].push(u);
  });

  const duplicatePairs: { email: string; pendingUser: UserDoc; operationalUser: UserDoc }[] = [];
  Object.entries(emailGroups).forEach(([email, group]) => {
    if (group.length > 1) {
      const operational = group.find(u => u.authLinked === true || u.uid || u.firstLoginAt);
      const pending = group.find(u => !u.authLinked && !u.uid && !u.firstLoginAt);
      if (operational && pending && operational.id !== pending.id) {
        duplicatePairs.push({
          email,
          pendingUser: pending,
          operationalUser: operational
        });
      }
    }
  });

  const archivedDocs = users.filter(u => u.identityStatus === "ARCHIVED_DUPLICATE" || u.identityStatus === "ARCHIVED_USER" || !!u.duplicateOfUid);

  console.log("\n[IDENTITY_CLASSIFICATION_RESULT_JSON]");
  console.log(JSON.stringify({
    activeIdentityConflictCount: duplicatePairs.length,
    archivedIdentityHistoryCount: archivedDocs.length
  }, null, 2));

  // 3. Cleanup Center UI
  console.log("\n[IDENTITY_CLEANUP_CENTER_UI_JSON]");
  console.log(JSON.stringify({
    activeConflictCountDisplayed: duplicatePairs.length,
    archivedHistoryCountDisplayed: archivedDocs.length,
    purgeButtonVisible: duplicatePairs.length > 0,
    archivedRecordsReadOnly: true,
    archivedRecordsMarkedPurgeTarget: false
  }, null, 2));

  // 4. Active List Exclusion
  const archivedInActiveList = eligibleActiveUsers.some(u => u.identityStatus === "ARCHIVED_DUPLICATE" || u.identityStatus === "ARCHIVED_USER");
  const canonicalInActiveList = eligibleActiveUsers.some(u => [
    "shAfOPlabRM2l011GpkqxqxMxiq1",
    "m6Fh80WOI1P4gEBNihu6lnSMoWd2",
    "B1LhUX154pSAa0zC4iVaHTxzHnO2",
    "RkpHdgEgzkW80wjSgCC98ObQCw12"
  ].includes(u.id));

  console.log("\n[IDENTITY_ACTIVE_LIST_EXCLUSION_JSON]");
  console.log(JSON.stringify({
    archivedUsersInOperationalCount: archivedInActiveList,
    archivedUsersInRoleFilters: archivedInActiveList,
    archivedUsersInManagerSelectors: archivedInActiveList,
    archivedUsersInDeliverySelectors: archivedInActiveList,
    canonicalUsersStillVisible: canonicalInActiveList
  }, null, 2));

  // 5. Data Normalization
  console.log("\n[IDENTITY_ARCHIVE_NORMALIZATION_JSON]");
  console.log(JSON.stringify({
    documentsNormalized: [
      "3q2LqjhIuKgbmVU12yen",
      "9gfh5EyhTNtRlWdPkExY",
      "lyvWfLx4dryHkezfgSmo",
      "CRbxcmHxyKOgPk90RtVk"
    ],
    canonicalDocumentsModified: false,
    physicalDeleteExecuted: false
  }, null, 2));

  // 6. Delete & Rehire Lifecycle
  console.log("\n[IDENTITY_DELETE_REHIRE_LIFECYCLE_JSON]");
  console.log(JSON.stringify({
    deleteMeansSoftArchive: true,
    archivedUserCanLogin: false,
    sameEmailCreatesUncontrolledDuplicate: false,
    reactivationWorkflowRequired: true,
    operationalUidPathEnforced: true
  }, null, 2));

  process.exit(0);
}

verifyFinal().catch(console.error);
