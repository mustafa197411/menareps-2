import { doc, setDoc, updateDoc, collection, query, where, getDocs, onSnapshot, runTransaction, orderBy, limit } from "firebase/firestore";
import { db } from "./firebase";
import { Notification, Role } from "../types";
import { decorateRecord } from "./firebaseSync";
import { handleFirestoreError, OperationType } from "./firebaseError";

/**
 * Creates a unique notification record in Firestore.
 */
export async function createNotification(
  notifData: Omit<Notification, "id" | "notificationId" | "createdAt" | "status" | "createdBy">,
  createdByUserId: string
): Promise<string> {
  const notifId = `NOT-${Math.floor(100000 + Math.random() * 900000)}`;
  const notifRef = doc(db, "notifications", notifId);

  const fullNotif: Notification = {
    ...notifData,
    id: notifId,
    notificationId: notifId,
    status: "unread",
    createdAt: new Date().toISOString(),
    createdBy: createdByUserId
  };

  const decorated = decorateRecord(fullNotif, createdByUserId, "create");

  try {
    await setDoc(notifRef, decorated);
    return notifId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `notifications/${notifId}`);
    throw error;
  }
}

/**
 * Creates a notification inside a transaction (great for atomic approval states).
 */
export function createNotificationInTransaction(
  transaction: any,
  notifData: Omit<Notification, "id" | "notificationId" | "createdAt" | "status" | "createdBy">,
  createdByUserId: string
): string {
  const notifId = `NOT-${Math.floor(100000 + Math.random() * 900000)}`;
  const notifRef = doc(db, "notifications", notifId);

  const fullNotif: Notification = {
    ...notifData,
    id: notifId,
    notificationId: notifId,
    status: "unread",
    createdAt: new Date().toISOString(),
    createdBy: createdByUserId
  };

  const decorated = decorateRecord(fullNotif, createdByUserId, "create");
  transaction.set(notifRef, decorated);
  return notifId;
}

/**
 * Helper to write a combined Audit Log and Notification atomically.
 */
export async function createNotificationWithAudit(
  notifData: Omit<Notification, "id" | "notificationId" | "createdAt" | "status" | "auditLogId" | "createdBy">,
  auditAction: string,
  auditDetails: string,
  userId: string,
  userName: string,
  userRole: string
): Promise<string> {
  const notifId = `NOT-${Math.floor(100000 + Math.random() * 900000)}`;
  const auditLogId = `AUD-${Math.floor(100000 + Math.random() * 900000)}`;

  const notifRef = doc(db, "notifications", notifId);
  const auditRef = doc(db, "auditLogs", auditLogId);

  const fullNotif: Notification = {
    ...notifData,
    id: notifId,
    notificationId: notifId,
    status: "unread",
    createdAt: new Date().toISOString(),
    createdBy: userId,
    auditLogId: auditLogId
  };

  const decoratedNotif = decorateRecord(fullNotif, userId, "create");

  const auditData = {
    id: auditLogId,
    userId: userId,
    userName: userName,
    userRole: userRole,
    action: auditAction,
    entityType: notifData.relatedModule || "Notification",
    entityId: notifData.relatedRecordId || notifId,
    details: auditDetails,
    timestamp: new Date().toISOString()
  };

  const decoratedAudit = decorateRecord(auditData, userId, "create");

  try {
    await runTransaction(db, async (transaction) => {
      transaction.set(notifRef, decoratedNotif);
      transaction.set(auditRef, decoratedAudit);
    });
    return notifId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `notifications/${notifId}`);
    throw error;
  }
}

/**
 * Updates the read status of a notification.
 */
export async function markNotificationStatus(
  notificationId: string,
  status: "read" | "unread",
  userId: string
): Promise<void> {
  const docRef = doc(db, "notifications", notificationId);
  try {
    await updateDoc(docRef, {
      status,
      updatedAt: new Date().toISOString(),
      updatedBy: userId
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `notifications/${notificationId}`);
  }
}

/**
 * Bulk marks all active notifications for a user/role as read.
 */
export async function markAllNotificationsAsRead(
  userId: string,
  userRole: string
): Promise<void> {
  const q = query(
    collection(db, "notifications"),
    where("status", "==", "unread")
  );

  try {
    const snapshots = await getDocs(q);
    const promises: Promise<void>[] = [];

    snapshots.forEach((docSnap) => {
      const data = docSnap.data();
      const isTargetedToUser = data.userId === userId;
      const isTargetedToRole = data.role === userRole;

      if (isTargetedToUser || isTargetedToRole) {
        const docRef = doc(db, "notifications", docSnap.id);
        promises.push(
          updateDoc(docRef, {
            status: "read",
            updatedAt: new Date().toISOString(),
            updatedBy: userId
          })
        );
      }
    });

    await Promise.all(promises);
  } catch (error) {
    console.error("[NotificationService] Failed bulk read status update:", error);
  }
}

/**
 * Subscribes to real-time notification alerts matching the logged-in user or role.
 * Includes a robust client-side filter to support dynamic security rules and avoid complex indexes.
 */
export function subscribeToNotifications(
  userId: string,
  userRole: string,
  callback: (notifications: Notification[]) => void
) {
  let q;
  if (userRole === Role.SUPER_ADMIN) {
    q = query(
      collection(db, "notifications"),
      orderBy("createdAt", "desc"),
      limit(200)
    );
  } else {
    q = query(
      collection(db, "notifications"),
      where("userId", "==", userId),
      orderBy("createdAt", "desc"),
      limit(200)
    );
  }

  console.info("SAFE LISTENER STARTED: notifications");

  return onSnapshot(
    q,
    (snapshot) => {
      const allNotifs: Notification[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as Notification;
        // User-specific or Role-specific or general broadcast filtering
        const isUserMatch = data.userId === userId;
        const isRoleMatch = data.role === userRole;
        const isGeneral = !data.userId && !data.role;

        if (isUserMatch || isRoleMatch || isGeneral) {
          allNotifs.push({
            ...data,
            id: docSnap.id
          });
        }
      });
      callback(allNotifs);
    },
    (error) => {
      console.error("[NotificationService] Real-time subscription error:", error);
    }
  );
}

/**
 * Specific Alert Triggers
 */

export async function triggerPlannerSubmissionAlert(
  plannerId: string,
  repId: string,
  repName: string,
  period: string,
  plannerType: "medical" | "sales",
  userId: string
): Promise<string> {
  const supervisorRole = plannerType === "medical" ? "Medical Supervisor" : "Sales Supervisor";
  return createNotification({
    userId: "", // Broadcast to matching role
    role: supervisorRole,
    category: "planner",
    priority: "medium",
    title: "New Planner Submitted",
    message: `Representative ${repName} has submitted a ${plannerType} planner for the period ${period} awaiting supervisor review.`,
    relatedModule: "Planners",
    relatedRecordId: plannerId,
    deepLink: `/supervision/approvals?id=${plannerId}`
  }, userId);
}

export async function triggerSampleRequestAlert(
  requestId: string,
  repName: string,
  productName: string,
  quantity: number,
  urgent: boolean,
  userId: string
): Promise<string> {
  return createNotification({
    role: "Warehouse / Inventory",
    category: "sample",
    priority: urgent ? "high" : "medium",
    title: urgent ? "🚨 Urgent Sample Replenishment" : "Sample Replenishment Request",
    message: `Representative ${repName} requested ${quantity} units of ${productName} as a portfolio replenishment. Reason: Field detailing.`,
    relatedModule: "Samples",
    relatedRecordId: requestId,
    deepLink: `/samples/requests?id=${requestId}`
  }, userId);
}

export async function triggerMarketingRequestAlert(
  requestId: string,
  repName: string,
  materialName: string,
  quantity: number,
  userId: string
): Promise<string> {
  return createNotification({
    role: "Marketing",
    category: "marketing",
    priority: "medium",
    title: "Marketing Material Request",
    message: `Representative ${repName} requested ${quantity} units of ${materialName} for clinical meetings.`,
    relatedModule: "Marketing",
    relatedRecordId: requestId,
    deepLink: `/marketing/materials?id=${requestId}`
  }, userId);
}

export async function triggerOrderSupervisorApprovalAlert(
  orderId: string,
  pharmacyName: string,
  total: number,
  repName: string,
  userId: string,
  currencyCode: string
): Promise<string> {
  return createNotification({
    role: "Sales Supervisor",
    category: "order",
    priority: "high",
    title: "Commercial Order Supervisor Review",
    message: `New commercial order of ${total} ${currencyCode} submitted for ${pharmacyName} by ${repName} requires Supervisor review.`,
    relatedModule: "Orders",
    relatedRecordId: orderId,
    deepLink: `/supervision/orders?id=${orderId}`
  }, userId);
}

export async function triggerFinanceApprovalAlert(
  orderId: string,
  pharmacyName: string,
  total: number,
  userId: string,
  currencyCode: string
): Promise<string> {
  return createNotification({
    role: "Finance Officer",
    category: "finance",
    priority: "high",
    title: "Commercial Order Financial Approval",
    message: `Commercial order of ${total} ${currencyCode} for ${pharmacyName} cleared by supervisor. Awaiting Finance Officer credit verification and operational sign-off.`,
    relatedModule: "Finance",
    relatedRecordId: orderId,
    deepLink: `/finance/manager?id=${orderId}`
  }, userId);
}

export async function triggerWarehouseReleaseAlert(
  orderId: string,
  pharmacyName: string,
  itemCount: number,
  userId: string
): Promise<string> {
  return createNotification({
    role: "Warehouse / Inventory",
    category: "warehouse",
    priority: "high",
    title: "Release Order Inventory",
    message: `Commercial order for ${pharmacyName} approved by Finance. Warehouse release authorized for ${itemCount} items. Prepare parcel now.`,
    relatedModule: "Warehouse",
    relatedRecordId: orderId,
    deepLink: `/inventory/manager?id=${orderId}`
  }, userId);
}

export async function triggerDeliveryIssueAlert(
  orderId: string,
  pharmacyName: string,
  issueDetails: string,
  userId: string
): Promise<string> {
  return createNotification({
    role: "Order Operations Officer",
    category: "delivery",
    priority: "high",
    title: "⚠️ Delivery Logistical Issue",
    message: `Delivery dispatch for ${pharmacyName} reported an exception: ${issueDetails}.`,
    relatedModule: "Operations",
    relatedRecordId: orderId,
    deepLink: `/operations/hub?id=${orderId}`
  }, userId);
}

export async function triggerLowStockAlert(
  sampleId: string,
  productName: string,
  currentStock: number,
  reorderLevel: number,
  userId: string
): Promise<string> {
  return createNotification({
    role: "Warehouse / Inventory",
    category: "stock",
    priority: "high",
    title: "🚨 Low Stock Alert",
    message: `Product ${productName} stock is critical! Current: ${currentStock} units (Reorder limit: ${reorderLevel}). Order replenishment from manufacturer.`,
    relatedModule: "Warehouse",
    relatedRecordId: sampleId,
    deepLink: `/inventory/manager?id=${sampleId}`
  }, userId);
}

export async function triggerOutstandingBalanceAlert(
  pharmacyId: string,
  pharmacyName: string,
  balance: number,
  userId: string,
  currencyCode: string
): Promise<string> {
  return createNotification({
    role: "Finance Officer",
    category: "finance_alert",
    priority: "medium",
    title: "Outstanding Balance Check",
    message: `Pharmacy ${pharmacyName} outstanding balance is high at ${balance} ${currencyCode}. Review credit risks before authorizing further orders.`,
    relatedModule: "Finance",
    relatedRecordId: pharmacyId,
    deepLink: `/finance/manager?id=${pharmacyId}`
  }, userId);
}

export async function triggerCreditLimitAlert(
  orderId: string,
  pharmacyName: string,
  orderTotal: number,
  excessAmount: number,
  userId: string,
  currencyCode: string
): Promise<string> {
  return createNotification({
    role: "Finance Officer",
    category: "finance_alert",
    priority: "high",
    title: "🚨 Credit Limit Exceeded",
    message: `Order ${orderId} for ${pharmacyName} exceeds maximum credit authorization limit by ${excessAmount} ${currencyCode}. Manual Finance override is required.`,
    relatedModule: "Finance",
    relatedRecordId: orderId,
    deepLink: `/finance/manager?id=${orderId}`
  }, userId);
}
