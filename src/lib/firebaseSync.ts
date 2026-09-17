import { 
  collection, 
  doc, 
  getDocs, 
  setDoc, 
  addDoc, 
  onSnapshot, 
  query, 
  where, 
  writeBatch,
  orderBy,
  limit,
  serverTimestamp
} from "firebase/firestore";
import { db } from "./firebase";
import { 
  initialUsers, 
  initialPhysicians, 
  initialPharmacies, 
  initialProducts, 
  initialKeyMessages, 
  initialAuditLogs,
  initialPhysicianVisits,
  initialPharmacyVisits,
  initialPermissions,
  initialOrders,
  initialPhysicianSpecialties
} from "../data/mockData";
import { 
  INITIAL_COUNTRIES,
  INITIAL_DISTRICTS,
  INITIAL_CITIES,
  INITIAL_TERRITORIES,
  INITIAL_PRODUCT_GROUPS,
  INITIAL_USER_TERRITORY_ASSIGNMENTS,
  INITIAL_USER_PRODUCT_ASSIGNMENTS,
  INITIAL_AREAS
} from "./alignmentService";
import { User, Physician, Pharmacy, Product, KeyMessage, AuditLog, PhysicianVisit, PharmacyVisit, Permissions, OrderRecord } from "../types";
import { handleFirestoreError, OperationType } from "./firebaseError";

// Dynamic database metadata helper to inject companyId and audit fields only.
export function decorateRecord<T extends object>(data: T, userId: string, actionType: "create" | "update" = "create"): T & {
  companyId: string;
  createdAt?: string;
  createdBy?: string;
  updatedAt: string;
  updatedBy: string;
  status?: string;
  isDeleted?: boolean;
} {
  const timestamp = new Date().toISOString().replace("T", " ").substring(0, 19) + " UTC";
  const decoration: any = {
    companyId: "MENAREPS-CENTRAL",
    updatedAt: timestamp,
    updatedBy: userId
  };

  if (actionType === "create") {
    decoration.createdAt = timestamp;
    decoration.createdBy = userId;
  }

  return { ...data, ...decoration };
}

// Check and seed Firestore collections if empty with granular handleFirestoreError guards
export async function seedDatabaseIfEmpty() {
  const isDemoSeedingEnabled = import.meta.env.DEV && (
    import.meta.env.VITE_ENABLE_DEMO_SEEDING === "true" ||
    (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("demo_seed") === "true")
  );

  if (!isDemoSeedingEnabled) {
    console.warn(
      "[FirebaseSync] Automatic database seeding is currently disabled. " +
      "Demo seeding is available only in a development build."
    );
    return;
  }

  console.log("[FirebaseSync] Checking database collection hydration state...");
  const {
    initialSampleAllocations,
    initialSampleApprovals,
    initialSampleRequests,
    initialSampleInventory,
    initialSampleTransactions,
  } = await import("./sampleMockData");
  
  const collectionsToSeed = [
    { name: "users", initial: initialUsers },
    { name: "physicians", initial: initialPhysicians },
    { name: "pharmacies", initial: initialPharmacies },
    { name: "products", initial: initialProducts },
    { name: "keyMessages", initial: initialKeyMessages },
    { name: "auditLogs", initial: initialAuditLogs },
    { name: "physicianVisits", initial: initialPhysicianVisits },
    { name: "pharmacyVisits", initial: initialPharmacyVisits },
    { name: "countries", initial: INITIAL_COUNTRIES },
    { name: "districts", initial: INITIAL_DISTRICTS },
    { name: "cities", initial: INITIAL_CITIES },
    { name: "areas", initial: INITIAL_AREAS },
    { name: "territories", initial: INITIAL_TERRITORIES },
    { name: "productGroups", initial: INITIAL_PRODUCT_GROUPS },
    { name: "userTerritoryAssignments", initial: INITIAL_USER_TERRITORY_ASSIGNMENTS },
    { name: "userProductAssignments", initial: INITIAL_USER_PRODUCT_ASSIGNMENTS },
    { name: "sampleAllocations", initial: initialSampleAllocations },
    { name: "sampleApprovals", initial: initialSampleApprovals },
    { name: "sampleRequests", initial: initialSampleRequests },
    { name: "sampleInventory", initial: initialSampleInventory },
    { name: "sampleTransactions", initial: initialSampleTransactions },
    { name: "orders", initial: initialOrders },
    { 
      name: "rolePermissions", 
      initial: Object.entries(initialPermissions).map(([role, perms]) => ({
        id: role,
        role,
        ...perms
      }))
    }
  ];

  await Promise.all(
    collectionsToSeed.map(async (colInfo) => {
      let snap;
      try {
        // Query only 1 document to check if the collection is empty without pulling whole records
        const q = query(collection(db, colInfo.name), limit(1));
        snap = await getDocs(q);
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, colInfo.name);
      }

      if (snap && snap.empty) {
        console.log(`[FirebaseSync] Seeding ${colInfo.name} collection...`);
        try {
          const batch = writeBatch(db);
          colInfo.initial.forEach((item: any) => {
            const docId = String(item.id || item.territoryId || item.assignmentId || `SEED-${Math.floor(100000 + Math.random() * 900000)}`);
            const docRef = doc(db, colInfo.name, docId);
            const decorated = decorateRecord(item, "SYSTEM", "create");
            batch.set(docRef, decorated);
          });
          await batch.commit();
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, colInfo.name);
        }
      }
    })
  );

  console.log("[FirebaseSync] Seeding check completed.");
}

// Reusable hook-like listeners for syncing Firestore collection state in real-time
export function listenCollection<T>(collectionName: string, onUpdate: (data: T[]) => void) {
  const colRef = collection(db, collectionName);
  
  return onSnapshot(colRef, (snapshot) => {
    const records: T[] = [];
    snapshot.forEach((doc) => {
      const data = doc.data() as any;
      if (data.isDeleted !== true) {
        records.push({ id: doc.id, ...data } as T);
      }
    });
    onUpdate(records);
  }, (err) => {
    handleFirestoreError(err, OperationType.LIST, collectionName);
  });
}

export function listenQuery<T>(queryRef: any, onUpdate: (data: T[]) => void) {
  return onSnapshot(queryRef, (snapshot: any) => {
    const records: T[] = [];
    snapshot.forEach((doc: any) => {
      const data = doc.data();
      if (data.isDeleted !== true) {
        records.push({ id: doc.id, ...data } as T);
      }
    });
    onUpdate(records);
  }, (err) => {
    handleFirestoreError(err, OperationType.LIST, "query");
  });
}

export async function saveRolePermissions(role: string, perms: Permissions, userId: string) {
  try {
    const docRef = doc(db, "rolePermissions", role);
    const data = { role, ...perms };
    const decorated = decorateRecord(data, userId, "update");
    await setDoc(docRef, decorated);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, "rolePermissions");
  }
}
