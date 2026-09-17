export const VERSION2_INVENTORY_CONTRACT = 2 as const;
export const INVENTORY_CONTRACT_INTEGRITY_ERROR = "INVENTORY_CONTRACT_INTEGRITY_ERROR" as const;

export interface InventoryContractOrderEvidence {
  inventoryContractVersion?: unknown;
  reservationIds?: unknown;
  physicalDemand?: unknown;
  inventoryReservationId?: unknown;
}

export type InventoryContractClassification =
  | { kind: "VERSION_2"; version2: true; legacy: false; reservationEvidence: boolean }
  | { kind: "LEGACY"; version2: false; legacy: true; reservationEvidence: false }
  | { kind: "INTEGRITY_ERROR"; version2: false; legacy: false; reservationEvidence: boolean; code: typeof INVENTORY_CONTRACT_INTEGRITY_ERROR };

const nonBlank = (value: unknown): boolean => typeof value === "string" && value.trim().length > 0;
const present = (value: unknown): boolean => value !== undefined && value !== null && (typeof value !== "string" || nonBlank(value));

export function hasInventoryReservationEvidence(order: InventoryContractOrderEvidence | null | undefined): boolean {
  if (!order) return false;
  return (Array.isArray(order.reservationIds) ? order.reservationIds.length > 0 : present(order.reservationIds))
    || (Array.isArray(order.physicalDemand) ? order.physicalDemand.length > 0 : present(order.physicalDemand))
    || present(order.inventoryReservationId);
}

export function classifyInventoryContract(order: InventoryContractOrderEvidence | null | undefined): InventoryContractClassification {
  const reservationEvidence = hasInventoryReservationEvidence(order);
  const raw = order?.inventoryContractVersion;
  const missing = raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "");
  if (missing) {
    return reservationEvidence
      ? { kind: "INTEGRITY_ERROR", version2: false, legacy: false, reservationEvidence: true, code: INVENTORY_CONTRACT_INTEGRITY_ERROR }
      : { kind: "LEGACY", version2: false, legacy: true, reservationEvidence: false };
  }
  const normalized = typeof raw === "string" ? raw.trim() : raw;
  if (normalized === VERSION2_INVENTORY_CONTRACT || normalized === String(VERSION2_INVENTORY_CONTRACT)) {
    return { kind: "VERSION_2", version2: true, legacy: false, reservationEvidence };
  }
  const explicitLegacy = normalized === 1 || normalized === "1";
  if (explicitLegacy && !reservationEvidence) return { kind: "LEGACY", version2: false, legacy: true, reservationEvidence: false };
  return { kind: "INTEGRITY_ERROR", version2: false, legacy: false, reservationEvidence, code: INVENTORY_CONTRACT_INTEGRITY_ERROR };
}
