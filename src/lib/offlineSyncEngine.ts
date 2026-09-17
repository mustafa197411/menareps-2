import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  query, 
  where,
  runTransaction,
  disableNetwork,
  enableNetwork
} from "firebase/firestore";
import { db, auth, firestoreDatabaseId } from "./firebase";
import { decorateRecord } from "./firebaseSync";
import { prepareSampleWrite } from "./samplePersistence";
import { clearFirestoreError } from "./firebaseError";

const dbId = firestoreDatabaseId;

function logSyncEvent(event: string, statusDetail: string, errorDetail?: { code?: string; message?: string }) {
  const timestamp = new Date().toISOString();
  const authUid = auth?.currentUser?.uid || "unauthenticated";
  const online = navigator.onLine;
  console.info(`[SYNC_LIFECYCLE] [${timestamp}] ${event}`, {
    timestamp,
    authUid,
    navigatorOnLine: online,
    firestoreDatabaseId: dbId,
    synchronizationStatus: statusDetail,
    errorCode: errorDetail?.code || "none",
    errorMessage: errorDetail?.message || "none"
  });
}
import { 
  savePhysicianVisitRecord, 
  savePharmacyVisitRecord, 
  saveOrder, 
  savePlannerApprovalTransactional, 
  disburseSampleTransactional,
  receiveSampleStockTransactional,
  adjustSampleStockTransactional,
  saveAuditLogRecord,
  saveProduct, isRetryableProductPersistenceError,
} from "./firestoreService";

export type ConnectivityStatus = "online" | "offline" | "poor" | "recovered";

export interface OfflineQueueItem {
  id: string; // Unique queue item ID (usually prefixed with OQ-)
  module: "medicalPlanner" | "salesPlanner" | "physicianVisit" | "pharmacyVisit" | "order" | "sample" | "marketing" | "stock" | "gps" | "note" | "attachment" | "products";
  action: "create" | "update" | "delete" | "disburse" | "receive" | "adjust";
  data: any; // Payload data
  status: "pending" | "uploading" | "uploaded" | "conflict" | "failed";
  retryCount: number;
  lastError?: string;
  conflictDetails?: string;
  createdAt: string;
  updatedAt: string;
  userId: string;
  userName?: string;
  userRole?: string;
}

export const isTerminalOfflineProductFailure = (module: OfflineQueueItem["module"], error: unknown): boolean =>
  module === "products" && !isRetryableProductPersistenceError(error);

// Memory listeners for reactivity in the UI
type StatusListener = (status: ConnectivityStatus) => void;
type QueueListener = (queues: { [key: string]: OfflineQueueItem[] }) => void;

const statusListeners = new Set<StatusListener>();
const queueListeners = new Set<QueueListener>();

let currentStatus: ConnectivityStatus = navigator.onLine ? "online" : "offline";
let isSyncing = false;

let isInitialized = false;
let pingIntervalId: any = null;
let networkInfoListener: any = null;
let onlineListener: (() => void) | null = null;
let offlineListener: (() => void) | null = null;

export function initializeOfflineSyncEngine() {
  if (isInitialized) {
    return;
  }
  
  if (typeof window === "undefined") {
    return;
  }

  isInitialized = true;
  console.info("[Offline Sync] Connectivity engine initialized successfully as singleton.");

  onlineListener = () => {
    handleConnectivityChange("recovered");
  };

  offlineListener = () => {
    handleConnectivityChange("offline");
  };

  window.addEventListener("online", onlineListener);
  window.addEventListener("offline", offlineListener);

  // Safely feature-detect and monitor Network Information API where supported
  const navConnection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
  if (navConnection) {
    networkInfoListener = () => {
      const type = navConnection.effectiveType;
      if (type === "slow-2g" || type === "2g") {
        handleConnectivityChange("poor");
      } else {
        if (navigator.onLine) {
          // Verify with currentStatus to avoid forcing "recovered" if we are already "online"
          if (currentStatus !== "online" && currentStatus !== "recovered") {
            handleConnectivityChange("recovered");
          }
        } else {
          handleConnectivityChange("offline");
        }
      }
    };
    try {
      navConnection.addEventListener("change", networkInfoListener);
    } catch (e) {
      console.warn("[Offline Sync] Failed to attach connection change listener:", e);
    }
  }

  // Run periodic ping tests to identify "poor connection" states
  pingIntervalId = setInterval(async () => {
    if (!navigator.onLine) {
      if (currentStatus !== "offline") {
        handleConnectivityChange("offline");
      }
      return;
    }

    try {
      const startTime = Date.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);
      
      const res = await fetch("/api/health", { signal: controller.signal }).catch(() => null);
      clearTimeout(timeoutId);
      
      const duration = Date.now() - startTime;

      if (res && res.ok) {
        if (duration > 2000) {
          handleConnectivityChange("poor");
        } else if (currentStatus === "offline" || currentStatus === "poor") {
          handleConnectivityChange("recovered");
        } else {
          handleConnectivityChange("online");
        }
      } else {
        handleConnectivityChange("poor");
      }
    } catch (e) {
      handleConnectivityChange("poor");
    }
  }, 15000);
}

export function destroyOfflineSyncEngine() {
  if (!isInitialized) return;

  if (typeof window !== "undefined") {
    if (onlineListener) {
      window.removeEventListener("online", onlineListener);
      onlineListener = null;
    }
    if (offlineListener) {
      window.removeEventListener("offline", offlineListener);
      offlineListener = null;
    }

    const navConnection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    if (navConnection && networkInfoListener) {
      try {
        navConnection.removeEventListener("change", networkInfoListener);
      } catch (e) {
        // ignore
      }
      networkInfoListener = null;
    }
  }

  if (pingIntervalId) {
    clearInterval(pingIntervalId);
    pingIntervalId = null;
  }

  isInitialized = false;
  console.info("[Offline Sync] Connectivity engine successfully destroyed.");
}

// Auto-initialize the engine as a safe singleton on load
if (typeof window !== "undefined") {
  initializeOfflineSyncEngine();
}

async function handleConnectivityChange(newStatus: ConnectivityStatus) {
  const previousStatus = currentStatus;
  
  // Strict deduplication check: do not execute or emit events if status is unchanged
  if (previousStatus === newStatus) {
    return;
  }
  
  currentStatus = newStatus;
  console.log(`[Offline Sync] Connection changed: ${previousStatus} -> ${newStatus}`);
  
  if (newStatus === "offline") {
    try {
      logSyncEvent("NETWORK DISABLE START", "Disabling Firestore network due to connection state change to offline");
      await disableNetwork(db);
      logSyncEvent("NETWORK DISABLED", "Firestore network successfully disabled");
    } catch (e: any) {
      console.error("[Offline Sync] Failed to disable Firestore network:", e);
      logSyncEvent("SYNC FAILURE", "Failed to disable Firestore network", { code: e?.code, message: e?.message });
    }
  } else if (newStatus === "online" || newStatus === "recovered") {
    try {
      logSyncEvent("NETWORK RESTORE START", "Enabling Firestore network due to connection state change to online/recovered");
      await enableNetwork(db);
      logSyncEvent("NETWORK RESTORED", "Firestore network successfully enabled");
    } catch (e: any) {
      console.error("[Offline Sync] Failed to enable Firestore network:", e);
      logSyncEvent("SYNC FAILURE", "Failed to enable Firestore network", { code: e?.code, message: e?.message });
    }
  }

  // Trigger listeners
  statusListeners.forEach(l => l(newStatus));

  // If connection is recovered or normal online, kick off an automatic background synchronization
  if (newStatus === "online" || newStatus === "recovered") {
    triggerAutomaticSync().catch(err => {
      console.error("[Offline Sync] Background automatic synchronization failed:", err);
    });
  }
}

// Listen to connectivity status changes
export function subscribeConnectivityStatus(listener: StatusListener) {
  statusListeners.add(listener);
  listener(currentStatus);
  return () => {
    statusListeners.delete(listener);
  };
}

export function getCurrentConnectivityStatus(): ConnectivityStatus {
  return currentStatus;
}

// Queue Storage Operations
export function getOfflineQueue(
  queueName: "pending" | "completed" | "failed" | "retry" | "conflict"
): OfflineQueueItem[] {
  try {
    const raw = localStorage.getItem(`menareps_offline_queue_${queueName}`);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error(`[Offline Storage] Error reading queue ${queueName}:`, e);
    return [];
  }
}

export function saveOfflineQueue(
  queueName: "pending" | "completed" | "failed" | "retry" | "conflict",
  items: OfflineQueueItem[]
): void {
  try {
    localStorage.setItem(`menareps_offline_queue_${queueName}`, JSON.stringify(items));
    notifyQueueListeners();
  } catch (e) {
    console.error(`[Offline Storage] Error writing queue ${queueName}:`, e);
  }
}

function notifyQueueListeners() {
  const queues = {
    pending: getOfflineQueue("pending"),
    completed: getOfflineQueue("completed"),
    failed: getOfflineQueue("failed"),
    retry: getOfflineQueue("retry"),
    conflict: getOfflineQueue("conflict")
  };
  queueListeners.forEach(l => l(queues));
}

export function subscribeQueueChanges(listener: QueueListener) {
  queueListeners.add(listener);
  notifyQueueListeners();
  return () => {
    queueListeners.delete(listener);
  };
}

// Add an entry into the local offline storage engine
export function enqueueOfflineWrite(
  module: OfflineQueueItem["module"],
  action: OfflineQueueItem["action"],
  data: any,
  userId: string,
  userName?: string,
  userRole?: string
): OfflineQueueItem {
  const pending = getOfflineQueue("pending");
  
  // Construct fully compliant offline record
  const timestamp = new Date().toISOString();
  const newItem: OfflineQueueItem = {
    id: `OQ-${module.substring(0, 3).toUpperCase()}-${Math.floor(100000 + Math.random() * 900000)}`,
    module,
    action,
    data,
    status: "pending",
    retryCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    userId,
    userName,
    userRole
  };

  pending.push(newItem);
  saveOfflineQueue("pending", pending);
  
  console.log(`[Offline Sync] Enqueued offline write: ${newItem.id} for module: ${module}`);
  
  // Schedule a sync check immediately
  if (currentStatus === "online" || currentStatus === "recovered") {
    triggerAutomaticSync().catch(e => console.error("Immediate sync trigger failed:", e));
  }

  return newItem;
}

// Remove an entry completely
export function deleteQueueItem(
  id: string,
  queueName: "pending" | "completed" | "failed" | "retry" | "conflict"
): void {
  const queue = getOfflineQueue(queueName);
  const updated = queue.filter(item => item.id !== id);
  saveOfflineQueue(queueName, updated);
}

// Clear all items in a queue
export function clearQueue(
  queueName: "pending" | "completed" | "failed" | "retry" | "conflict"
): void {
  saveOfflineQueue(queueName, []);
}

// Force a manual retry of a failed or conflict item
export async function forceRetryItem(id: string): Promise<boolean> {
  let item: OfflineQueueItem | undefined;
  
  // Search in failed, retry, or conflict queues
  const queues: ("failed" | "retry" | "conflict" | "pending")[] = ["failed", "retry", "conflict", "pending"];
  for (const qName of queues) {
    const list = getOfflineQueue(qName);
    const found = list.find(i => i.id === id);
    if (found) {
      item = found;
      // Remove from old queue
      saveOfflineQueue(qName, list.filter(i => i.id !== id));
      break;
    }
  }

  if (!item) return false;

  // Re-enqueue into pending
  item.status = "pending";
  item.retryCount = 0;
  item.updatedAt = new Date().toISOString();
  delete item.lastError;
  delete item.conflictDetails;

  const pending = getOfflineQueue("pending");
  pending.push(item);
  saveOfflineQueue("pending", pending);

  // Trigger sync process
  await triggerAutomaticSync();
  return true;
}

// Resolve a conflict item manually
export async function resolveConflictManually(
  id: string,
  resolution: "client_wins" | "server_wins"
): Promise<boolean> {
  const conflicts = getOfflineQueue("conflict");
  const item = conflicts.find(i => i.id === id);
  if (!item) return false;

  // Remove from conflict queue
  saveOfflineQueue("conflict", conflicts.filter(i => i.id !== id));

  if (resolution === "client_wins") {
    // Re-add to pending but flag as "force_client" to bypass conflict check
    item.status = "pending";
    item.retryCount = 0;
    item.data._forceClient = true;
    item.updatedAt = new Date().toISOString();
    
    const pending = getOfflineQueue("pending");
    pending.push(item);
    saveOfflineQueue("pending", pending);
    
    await triggerAutomaticSync();
  } else {
    // Server wins: discard local changes and put in completed directly as discarded
    item.status = "uploaded";
    item.conflictDetails = "Resolved manually: Server Authority Accepted.";
    item.updatedAt = new Date().toISOString();
    
    const completed = getOfflineQueue("completed");
    completed.push(item);
    saveOfflineQueue("completed", completed);
  }

  return true;
}

// Central Synchronizer Process
export async function triggerAutomaticSync(): Promise<void> {
  if (isSyncing) return;
  
  const pending = getOfflineQueue("pending");
  if (pending.length === 0) return;

  if (currentStatus === "offline") {
    console.log("[Offline Sync] Device offline. Automatic background synchronization paused.");
    return;
  }

  isSyncing = true;
  logSyncEvent("SYNC START", `Starting sync of ${pending.length} pending operations...`);
  logSyncEvent("NETWORK BEFORE SYNC", `Current connectivity state: ${currentStatus}`);

  // Move pending items one-by-one to avoid batch write-locks on transactions
  const remainingPending = [...pending];
  
  try {
    // Ensure Firestore networking is enabled before remote database writes
    logSyncEvent("NETWORK RESTORE START", "Ensuring Firestore network is enabled before sync operation");
    await enableNetwork(db);
    logSyncEvent("NETWORK RESTORED", "Firestore network successfully enabled");

    for (const item of remainingPending) {
      // 1. Update status to uploading
      item.status = "uploading";
      updateItemStatusAcrossQueues(item);
      logSyncEvent("SYNC OPERATION", `Processing write action for item ${item.id} of module ${item.module}`);

      try {
        // 2. Perform Conflict Check
        const conflictFound = await checkConflicts(item);
        if (conflictFound && !item.data?._forceClient) {
          console.warn(`[Offline Sync] Conflict detected for item: ${item.id}`);
          item.status = "conflict";
          item.conflictDetails = conflictFound;
          moveItemToQueue(item, "pending", "conflict");
          logSyncEvent("SYNC FAILURE", `Conflict detected for item ${item.id}`, { message: conflictFound });
          continue;
        }

        // 3. Process write action to Firestore
        await executeOfflineAction(item);

        // 4. On success, move to completed
        item.status = "uploaded";
        item.updatedAt = new Date().toISOString();
        moveItemToQueue(item, "pending", "completed");
        
        // Log audit for successful sync
        await logSyncAuditSuccess(item);
        logSyncEvent("SYNC SUCCESS", `Item ${item.id} synced successfully`);
        clearFirestoreError();

      } catch (err: any) {
        console.error(`[Offline Sync] Failed to synchronize item ${item.id}:`, err);
        
        const terminalProductRejection = isTerminalOfflineProductFailure(item.module, err);
        item.retryCount += 1;
        item.lastError = err?.message || String(err);

        if (terminalProductRejection || item.retryCount >= 3) {
          // Permanent failure
          item.status = "failed";
          moveItemToQueue(item, "pending", "failed");
          await logSyncAuditFailure(item, true);
          logSyncEvent("SYNC FAILURE", `Permanent failure syncing item ${item.id}`, { code: err?.code, message: err?.message });
        } else {
          // Retry queue
          item.status = "failed"; // Keep failed state for record status display
          moveItemToQueue(item, "pending", "retry");
          await logSyncAuditFailure(item, false);
          logSyncEvent("SYNC FAILURE", `Transient failure syncing item ${item.id}`, { code: err?.code, message: err?.message });
        }
      }
    }
  } catch (globalErr: any) {
    console.error("[Offline Sync] Global error during synchronization process:", globalErr);
    logSyncEvent("SYNC FAILURE", "Global sync error occurred", { code: globalErr?.code, message: globalErr?.message });
  } finally {
    try {
      // Restore and guarantee that Firestore networking is enabled
      logSyncEvent("NETWORK RESTORE START", "Finalizing sync and ensuring Firestore network is enabled in finally block");
      await enableNetwork(db);
      logSyncEvent("NETWORK RESTORED", "Firestore network connection verified as online");

      // Verify authenticated profile can be read to confirm client is fully online
      if (auth.currentUser) {
        logSyncEvent("PROFILE READ START", "Verifying authenticated profile is readable after sync");
        const profileRef = doc(db, "users", auth.currentUser.uid);
        await getDoc(profileRef);
        logSyncEvent("PROFILE READ SUCCESS", "Profile successfully read; client is confirmed online");
        clearFirestoreError();
      }
    } catch (e: any) {
      console.error("[Offline Sync] Failed to restore network or read profile in finally block:", e);
      logSyncEvent("SYNC FAILURE", "Failed to restore Firestore network or read profile in finally block", { code: e?.code, message: e?.message });
    }
    isSyncing = false;
    logSyncEvent("SYNC END", "Synchronization sweep completed");
  }
}

// Resolve helper to move item from source queue to target queue
function moveItemToQueue(
  item: OfflineQueueItem,
  fromQueue: "pending" | "completed" | "failed" | "retry" | "conflict",
  toQueue: "pending" | "completed" | "failed" | "retry" | "conflict"
) {
  const fromList = getOfflineQueue(fromQueue);
  const toList = getOfflineQueue(toQueue);

  const updatedFrom = fromList.filter(i => i.id !== item.id);
  // Prevent duplicates in target
  const updatedTo = toList.filter(i => i.id !== item.id);
  updatedTo.push(item);

  saveOfflineQueue(fromQueue, updatedFrom);
  saveOfflineQueue(toQueue, updatedTo);
}

function updateItemStatusAcrossQueues(item: OfflineQueueItem) {
  const queues: ("pending" | "completed" | "failed" | "retry" | "conflict")[] = ["pending", "completed", "failed", "retry", "conflict"];
  queues.forEach(qName => {
    const list = getOfflineQueue(qName);
    const idx = list.findIndex(i => i.id === item.id);
    if (idx !== -1) {
      list[idx] = item;
      saveOfflineQueue(qName, list);
    }
  });
}

// Master execution routing for offline queue items
export async function executeOfflineAction(item: OfflineQueueItem): Promise<void> {
  const { module, action, data, userId, userName, userRole } = item;
  const currentUser = { id: userId, name: userName || "Representative", role: userRole as any };

  switch (module) {
    case "medicalPlanner":
      await savePlannerApprovalTransactional(
        data,
        "medicalPlannerApprovals",
        userId,
        userRole || "",
        userName || "",
        data.actionDetails || "Medical Plan submitted during sync."
      );
      break;

    case "salesPlanner":
      await savePlannerApprovalTransactional(
        data,
        "salesPlannerApprovals",
        userId,
        userRole || "",
        userName || "",
        data.actionDetails || "Sales Plan submitted during sync."
      );
      break;

    case "physicianVisit":
      await savePhysicianVisitRecord(data, userId, userName, userRole);
      break;

    case "pharmacyVisit":
      await savePharmacyVisitRecord(data, userId, userName, userRole);
      break;

    case "order":
      await saveOrder(data, userId, userRole, userName, data.actionDetails || `Order ${data.id} uploaded from offline queue.`);
      break;

    case "sample":
      if (action === "disburse") {
        await disburseSampleTransactional(data.newLog, data.productName, data.quantity, currentUser);
      } else {
        // Sample requests
        const docRef = doc(db, "sampleRequests", data.id);
        const decorated = prepareSampleWrite("sampleRequests", data.id, data, userId, "create");
        await setDoc(docRef, decorated);
      }
      break;

    case "marketing":
      const mRef = doc(db, "marketingMaterialRequests", data.id);
      const decM = decorateRecord(data, userId, "create");
      await setDoc(mRef, decM);
      break;

    case "stock":
      if (action === "receive") {
        await receiveSampleStockTransactional(
          data.receiptProductId,
          data.receiptQty,
          data.receiptFile,
          data.selectedSampleName,
          currentUser
        );
      } else if (action === "adjust") {
        await adjustSampleStockTransactional(
          data.selectedAdjustProductId,
          data.selectedAdjustProductName,
          data.selectedAdjustProductBrand,
          data.targetQty,
          data.targetAvail,
          data.adjustReason,
          data.adjustNotes,
          currentUser
        );
      }
      break;

    case "gps":
      // A standalone GPS Audit Check-In
      await saveAuditLogRecord({
        id: data.id || `AL-GPS-${Math.floor(100000 + Math.random() * 900000)}`,
        userId,
        userName: userName || "Representative",
        userRole: userRole as any,
        action: "GPS Verification Success",
        entityType: "GPS",
        entityName: data.contextName || data.entityName || data.id || "GPS Verification",
        details: data.details || `GPS coordinate offline lock synced successfully.`,
        timestamp: new Date().toISOString()
      });
      break;

    case "note":
      const noteRef = doc(db, "notes", data.id);
      const decNote = decorateRecord(data, userId, "create");
      await setDoc(noteRef, decNote);
      break;

    case "attachment":
      const attRef = doc(db, "attachments", data.id);
      const decAtt = decorateRecord(data, userId, "create");
      await setDoc(attRef, decAtt);
      break;

    case "products":
      if (action !== "create" && action !== "update") throw new Error("PRODUCT_OFFLINE_ACTION_INVALID");
      await saveProduct(data, userId, action === "create" ? "create" : "edit");
      break;

    default:
      throw new Error(`Unsupported offline sync module: ${module}`);
  }
}

// Multi-Module Server/Local Conflict Detection Algorithm
async function checkConflicts(item: OfflineQueueItem): Promise<string | null> {
  const { module, data, userId } = item;

  try {
    switch (module) {
      case "physicianVisit": {
        // Conflict 1: Duplicate physician visit on the same day by the same Rep
        const visitRef = doc(db, "physicianVisits", data.id);
        const snap = await getDoc(visitRef);
        if (snap.exists()) {
          return `Duplicate physician visit detected. A visit with ID ${data.id} is already stored on the server.`;
        }

        // Conflict 2: Double check if another visit exists for same doc & day to prevent duplicate reporting
        const q = query(
          collection(db, "physicianVisits"),
          where("physicianId", "==", data.physicianId),
          where("visitDate", "==", data.visitDate),
          where("createdBy", "==", userId)
        );
        const qSnap = await getDocs(q);
        if (!qSnap.empty) {
          return `Duplicate Physician Visit: Another completed visit for Dr. ${data.physicianName} on ${data.visitDate} already exists.`;
        }
        break;
      }

      case "pharmacyVisit": {
        // Conflict 1: Duplicate pharmacy visit
        const visitRef = doc(db, "pharmacyVisits", data.id);
        const snap = await getDoc(visitRef);
        if (snap.exists()) {
          return `Duplicate pharmacy visit detected. A visit with ID ${data.id} is already stored on the server.`;
        }

        // Conflict 2: Same pharmacy & date already reported
        const q = query(
          collection(db, "pharmacyVisits"),
          where("pharmacyId", "==", data.pharmacyId),
          where("visitDate", "==", data.visitDate),
          where("createdBy", "==", userId)
        );
        const qSnap = await getDocs(q);
        if (!qSnap.empty) {
          return `Duplicate Pharmacy Visit: Another completed visit for ${data.pharmacyName} on ${data.visitDate} already exists.`;
        }
        break;
      }

      case "order": {
        const orderRef = doc(db, "orders", data.id);
        const snap = await getDoc(orderRef);
        if (snap.exists()) {
          const serverData = snap.data() as any;
          
          // Conflict 1: Server has terminal state like Delivered / Voided
          if (serverData.status === "Delivered" || serverData.status === "Voided") {
            return `Terminal State Conflict: Order ${data.id} is already marked as '${serverData.status}' on the server. Modification blocked.`;
          }

          // Conflict 2: Server has been updated more recently
          if (serverData.updatedAt && data.updatedAt && new Date(serverData.updatedAt) > new Date(data.updatedAt)) {
            return `Outdated Version Conflict: A newer version of Order ${data.id} is already registered on the server (Server: ${serverData.updatedAt}, Local: ${data.updatedAt}).`;
          }
        }
        break;
      }

      case "medicalPlanner":
      case "salesPlanner": {
        const col = module === "medicalPlanner" ? "medicalPlannerApprovals" : "salesPlannerApprovals";
        const approvalRef = doc(db, col, data.id);
        const snap = await getDoc(approvalRef);
        
        if (snap.exists()) {
          const serverData = snap.data() as any;
          // Conflict: Server version has already been Approved or Rejected
          if (serverData.status === "Approved" || serverData.status === "Rejected") {
            return `Planner State Conflict: This planner period is already marked as '${serverData.status}' on the server. Double action prevented.`;
          }
        }
        break;
      }

      case "products":
        break;

      default:
        // Default generic newest-version check for simpler collections
        break;
    }
  } catch (e) {
    console.warn("[Offline Sync] Error during conflict checks, bypassing to let transaction handle it:", e);
  }

  return null;
}

// Generate secure enterprise audit entries for synchronized records
async function logSyncAuditSuccess(item: OfflineQueueItem): Promise<void> {
  try {
    const auditLogId = `AUD-SYN-${Math.floor(100000 + Math.random() * 900000)}`;
    const auditData = {
      id: auditLogId,
      userId: item.userId,
      userName: item.userName || "Sync Engine",
      userRole: item.userRole || "System Engine",
      action: "Offline Records Synced",
      entityType: item.module,
      entityName: item.id,
      entityId: item.id,
      details: `Successfully synchronized offline record (${item.id}) for module '${item.module}' (Action: ${item.action}).`,
      timestamp: new Date().toISOString()
    };
    await saveAuditLogRecord(auditData as any);
  } catch (e) {
    console.error("Could not write successful sync audit log:", e);
  }
}

async function logSyncAuditFailure(item: OfflineQueueItem, isFatal: boolean): Promise<void> {
  try {
    const auditLogId = `AUD-SYF-${Math.floor(100000 + Math.random() * 900000)}`;
    const auditData = {
      id: auditLogId,
      userId: item.userId,
      userName: item.userName || "Sync Engine",
      userRole: item.userRole || "System Engine",
      action: isFatal ? "Sync Permanent Failure" : "Sync Transient Failure",
      entityType: item.module,
      entityName: item.id,
      entityId: item.id,
      details: `Failed sync of offline record (${item.id}) for module '${item.module}'. Attempts: ${item.retryCount}. Error: ${item.lastError || "Unknown"}`,
      timestamp: new Date().toISOString()
    };
    await saveAuditLogRecord(auditData as any);
  } catch (e) {
    console.error("Could not write failed sync audit log:", e);
  }
}

// Avoid circular dependencies at module-load by registering helper hooks directly
import { registerOfflineFallbackHandler } from "./firestoreService";
registerOfflineFallbackHandler({
  getCurrentConnectivityStatus,
  enqueueOfflineWrite
});
