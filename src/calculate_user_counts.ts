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

async function runAudit() {
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

  await signInWithEmailAndPassword(auth, "test-admin-99@menareps.com", "Password123!");

  const snap = await getDocs(collection(db, "users"));
  const users: UserDoc[] = snap.docs.map(d => ({ id: d.id, ...d.data() } as UserDoc));

  const totalUserDocuments = users.length;

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

  const isArchivedUser = (u: UserDoc) => {
    return (
      u.identityStatus === "ARCHIVED_DUPLICATE" ||
      u.identityStatus === "ARCHIVED_USER" ||
      u.status === "Archived" ||
      u.employmentStatus === "Archived" ||
      !!u.duplicateOfUid
    );
  };

  const isDeletedUser = (u: UserDoc) => {
    return u.isDeleted === true;
  };

  const activeOperationalUsersList = users.filter(u => isEligibleActiveUser(u));
  const activeOperationalUsers = activeOperationalUsersList.length;

  const archivedHistoricalUsersList = users.filter(u => isArchivedUser(u) && !isDeletedUser(u));
  const archivedHistoricalUsers = users.filter(u => isArchivedUser(u)).length;

  const deletedUsers = users.filter(u => u.isDeleted === true).length;

  const inactiveNonArchivedUsers = users.filter(u => 
    !isEligibleActiveUser(u) && 
    !isArchivedUser(u) && 
    !isDeletedUser(u)
  ).length;

  console.log("Total Documents:", totalUserDocuments);
  console.log("Active Operational Users:", activeOperationalUsers);
  console.log("Archived Historical Users:", archivedHistoricalUsers);
  console.log("Inactive Non-Archived Users:", inactiveNonArchivedUsers);
  console.log("Deleted Users:", deletedUsers);

  console.log("Breakdown of non-active operational users:");
  users.filter(u => !isEligibleActiveUser(u)).forEach(u => {
    console.log(`- ${u.id} (${u.email}): active=${u.active}, loginAllowed=${u.loginAllowed}, isDeleted=${u.isDeleted}, isOperational=${u.isOperational}, identityStatus=${u.identityStatus}, status=${u.status}, employmentStatus=${u.employmentStatus}`);
  });

  process.exit(0);
}

runAudit().catch(console.error);
