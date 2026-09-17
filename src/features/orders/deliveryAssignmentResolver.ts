export interface DeliveryAssignmentInfo {
  isAssigned: boolean;
  deliveryOfficerUid: string;
  deliveryOfficerName: string;
  deliveryOfficerEmail: string;
  plannedDeliveryDate: string;
  plannedDeliveryWindow: string;
  deliveryAssignedByUid: string;
  deliveryAssignedAt: string;
  deliveryAssignmentStatus: string;
}

/**
 * Unified Canonical Delivery Assignment Resolver (WP7.4D)
 * Single authoritative source of truth for reading delivery assignment state on any order.
 */
export function resolveDeliveryAssignment(order: any): DeliveryAssignmentInfo {
  if (!order) {
    return {
      isAssigned: false,
      deliveryOfficerUid: "",
      deliveryOfficerName: "",
      deliveryOfficerEmail: "",
      plannedDeliveryDate: "",
      plannedDeliveryWindow: "",
      deliveryAssignedByUid: "",
      deliveryAssignedAt: "",
      deliveryAssignmentStatus: "UNASSIGNED"
    };
  }

  const officerUid = order.deliveryOfficerUid || order.deliveryOfficerId || order.assignedDeliveryOfficerUid || order.deliveredByUid || order.returnedByUid || order.postponedByUid || "";
  const officerName = order.deliveryOfficerName || order.deliveryOfficer || order.deliveredBy || order.returnedBy || order.postponedBy || "";
  const officerEmail = order.deliveryOfficerEmail || "";
  const plannedDate = order.plannedDeliveryDate || order.newDeliveryDate || "";
  const plannedWindow = order.plannedDeliveryWindow || order.plannedDeliveryTime || order.deliveryWindow || "Standard";
  const assignedByUid = order.deliveryAssignedByUid || order.assignedByUid || "";
  const assignedAt = order.deliveryAssignedAt || order.assignedAt || "";

  const hasOfficer = Boolean(
    (officerUid && String(officerUid).trim() !== "") || 
    (officerName && String(officerName).trim() !== "")
  );

  const rawStatus = order.deliveryAssignmentStatus || order.deliveryStatus || (hasOfficer ? "ASSIGNED" : "UNASSIGNED");
  const isAssigned = hasOfficer && rawStatus !== "UNASSIGNED";

  return {
    isAssigned,
    deliveryOfficerUid: officerUid,
    deliveryOfficerName: officerName,
    deliveryOfficerEmail: officerEmail,
    plannedDeliveryDate: plannedDate,
    plannedDeliveryWindow: plannedWindow,
    deliveryAssignedByUid: assignedByUid,
    deliveryAssignedAt: assignedAt,
    deliveryAssignmentStatus: isAssigned ? rawStatus : "UNASSIGNED"
  };
}
