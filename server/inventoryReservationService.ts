import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import { classifyInventoryContract, VERSION2_INVENTORY_CONTRACT } from "../src/features/orders/inventoryContractClassifier";

export const INVENTORY_CONTRACT_VERSION = VERSION2_INVENTORY_CONTRACT;
export type ReservationStatus = "ACTIVE" | "CONSUMED" | "RELEASED";
export type PhysicalDemandLine = { productId: string; saleableQuantity?: number; promotionalFreeQuantity?: number };

export class InventoryReservationError extends Error {
  constructor(public readonly code: string, public readonly productId?: string) { super(code); }
}

const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const quantity = (value: unknown): number => {
  const result = Number(value ?? 0);
  if (!Number.isSafeInteger(result) || result < 0) throw new InventoryReservationError("INVENTORY_RESERVATION_QUANTITY_INVALID");
  return result;
};

export function readActiveReservedQuantity(product: Record<string, unknown>): number {
  return quantity(product.activeReservedQuantity);
}

export function availableToPromise(product: Record<string, unknown>): number {
  const stock = quantity(product.stockQuantity);
  return Math.max(0, stock - readActiveReservedQuantity(product));
}

export function deterministicReservationId(orderId: string, productId: string): string {
  const safe = (value: string) => encodeURIComponent(value.trim()).replace(/%/g, "_");
  if (!text(orderId) || !text(productId)) throw new InventoryReservationError("INVENTORY_RESERVATION_ID_INVALID");
  return `RES_${safe(orderId)}_${safe(productId)}`;
}

export function aggregatePhysicalDemand(lines: readonly PhysicalDemandLine[]) {
  const byProduct = new Map<string, { productId: string; saleableQuantity: number; promotionalFreeQuantity: number; totalPhysicalQuantity: number }>();
  for (const line of lines) {
    const productId = text(line.productId);
    if (!productId) throw new InventoryReservationError("INVENTORY_RESERVATION_PRODUCT_INVALID");
    const saleableQuantity = quantity(line.saleableQuantity);
    const promotionalFreeQuantity = quantity(line.promotionalFreeQuantity);
    const current = byProduct.get(productId) || { productId, saleableQuantity: 0, promotionalFreeQuantity: 0, totalPhysicalQuantity: 0 };
    current.saleableQuantity = quantity(current.saleableQuantity + saleableQuantity);
    current.promotionalFreeQuantity = quantity(current.promotionalFreeQuantity + promotionalFreeQuantity);
    current.totalPhysicalQuantity = quantity(current.saleableQuantity + current.promotionalFreeQuantity);
    byProduct.set(productId, current);
  }
  return [...byProduct.values()].filter(row => row.totalPhysicalQuantity > 0).sort((a, b) => a.productId.localeCompare(b.productId));
}

export interface ReservationCreationContext {
  orderId: string; pharmacyVisitId?: string; pharmacyId: string; companyId: string; countryId: string; marketId: string;
  actorUid: string; products: ReadonlyMap<string, Record<string, unknown>>; demand: ReturnType<typeof aggregatePhysicalDemand>;
}

export function createReservationsInTransaction(db: Firestore, tx: Transaction, context: ReservationCreationContext): string[] {
  const reservationIds: string[] = [];
  for (const demand of context.demand) {
    const product = context.products.get(demand.productId);
    if (!product) throw new InventoryReservationError("INVENTORY_RESERVATION_PRODUCT_MISSING", demand.productId);
    if (availableToPromise(product) < demand.totalPhysicalQuantity) {
      throw new InventoryReservationError(demand.promotionalFreeQuantity > 0 ? "PHARMACY_VISIT_OFFER_REWARD_STOCK_INSUFFICIENT" : "PHARMACY_VISIT_INVENTORY_RESERVATION_INSUFFICIENT", demand.productId);
    }
    const reservationId = deterministicReservationId(context.orderId, demand.productId);
    reservationIds.push(reservationId);
    tx.create(db.collection("inventoryReservations").doc(reservationId), {
      schemaVersion: 1, inventoryContractVersion: INVENTORY_CONTRACT_VERSION, reservationId, orderId: context.orderId,
      ...(context.pharmacyVisitId ? { pharmacyVisitId: context.pharmacyVisitId } : {}), pharmacyId: context.pharmacyId,
      companyId: context.companyId, countryId: context.countryId, marketId: context.marketId, productId: demand.productId,
      saleableReservedQuantity: demand.saleableQuantity, promotionalReservedQuantity: demand.promotionalFreeQuantity,
      totalReservedQuantity: demand.totalPhysicalQuantity, status: "ACTIVE", revision: 1,
      createdAt: FieldValue.serverTimestamp(), createdBy: context.actorUid, updatedAt: FieldValue.serverTimestamp(), updatedBy: context.actorUid, source: "BACKEND",
    });
    tx.update(db.collection("products").doc(demand.productId), {
      activeReservedQuantity: readActiveReservedQuantity(product) + demand.totalPhysicalQuantity,
      inventoryUpdatedAt: FieldValue.serverTimestamp(), inventoryUpdatedBy: context.actorUid,
    });
  }
  return reservationIds;
}

export type ReservationEffect = "RELEASE" | "CONSUME" | "RESTORE_RETURN";

export function terminalReservationStatus(current: ReservationStatus, effect: "RELEASE" | "CONSUME"): ReservationStatus {
  if (current !== "ACTIVE") throw new InventoryReservationError(effect === "RELEASE" ? "INVENTORY_RESERVATION_DUPLICATE_RELEASE" : "INVENTORY_RESERVATION_DUPLICATE_CONSUMPTION");
  return effect === "RELEASE" ? "RELEASED" : "CONSUMED";
}

export async function applyReservationEffectInTransaction(db: Firestore, tx: Transaction, order: Record<string, unknown>, actorUid: string, effect: ReservationEffect, reason?: string) {
  const contract = classifyInventoryContract(order);
  if (contract.kind === "INTEGRITY_ERROR") throw new InventoryReservationError(contract.code);
  if (contract.legacy) return { applied: false, legacy: true };
  const orderId = text(order.id || order.orderId);
  const ids = Array.isArray(order.reservationIds) ? order.reservationIds.map(text).filter(Boolean).sort() : [];
  if (!orderId || ids.length === 0) throw new InventoryReservationError("VERSION2_ORDER_RESERVATION_MISSING");
  const reservationSnaps = await Promise.all(ids.map(id => tx.get(db.collection("inventoryReservations").doc(id))));
  if (reservationSnaps.some(snap => !snap.exists)) throw new InventoryReservationError("VERSION2_ORDER_RESERVATION_MISSING");
  const reservations = reservationSnaps.map(snap => ({ ref: snap.ref, ...snap.data()! } as Record<string, any>));
  if (reservations.some(row => text(row.orderId) !== orderId || deterministicReservationId(orderId, text(row.productId)) !== text(row.reservationId))) throw new InventoryReservationError("INVENTORY_RESERVATION_ORDER_MISMATCH");
  const expected: ReservationStatus = effect === "RESTORE_RETURN" ? "CONSUMED" : "ACTIVE";
  if (reservations.some(row => row.status !== expected)) {
    const code = effect === "RELEASE" ? "INVENTORY_RESERVATION_DUPLICATE_RELEASE" : effect === "CONSUME" ? "INVENTORY_RESERVATION_DUPLICATE_CONSUMPTION" : "INVENTORY_RETURN_DUPLICATE_RESTORATION";
    throw new InventoryReservationError(code);
  }
  const productSnaps = await Promise.all(reservations.map(row => tx.get(db.collection("products").doc(text(row.productId)))));
  if (productSnaps.some(snap => !snap.exists)) throw new InventoryReservationError("INVENTORY_RESERVATION_PRODUCT_MISSING");
  for (let index = 0; index < reservations.length; index += 1) {
    const reservation = reservations[index]; const product = productSnaps[index].data()!;
    const total = quantity(reservation.totalReservedQuantity);
    if (total !== quantity(reservation.saleableReservedQuantity) + quantity(reservation.promotionalReservedQuantity)) throw new InventoryReservationError("INVENTORY_RESERVATION_TOTAL_MISMATCH");
    const stock = quantity(product.stockQuantity), activeReserved = readActiveReservedQuantity(product);
    if (effect !== "RESTORE_RETURN" && activeReserved < total) throw new InventoryReservationError("INVENTORY_RESERVATION_UNSAFE_BALANCE", text(reservation.productId));
    if (effect === "CONSUME" && stock < total) throw new InventoryReservationError("INVENTORY_RESERVATION_UNSAFE_BALANCE", text(reservation.productId));
    tx.update(productSnaps[index].ref, {
      stockQuantity: effect === "CONSUME" ? stock - total : effect === "RESTORE_RETURN" ? quantity(stock + total) : stock,
      activeReservedQuantity: effect === "RESTORE_RETURN" ? activeReserved : activeReserved - total,
      inventoryUpdatedAt: FieldValue.serverTimestamp(), inventoryUpdatedBy: actorUid,
    });
    if (effect === "RELEASE") tx.update(reservation.ref, { status: terminalReservationStatus(reservation.status, "RELEASE"), releasedAt: FieldValue.serverTimestamp(), releasedBy: actorUid, releaseReason: text(reason) || "TERMINAL_PRE_DISPATCH_TRANSITION", updatedAt: FieldValue.serverTimestamp(), updatedBy: actorUid, revision: quantity(reservation.revision) + 1 });
    if (effect === "CONSUME") tx.update(reservation.ref, { status: terminalReservationStatus(reservation.status, "CONSUME"), consumedAt: FieldValue.serverTimestamp(), consumedBy: actorUid, updatedAt: FieldValue.serverTimestamp(), updatedBy: actorUid, revision: quantity(reservation.revision) + 1 });
    if (effect === "RESTORE_RETURN") {
      const eventId = `RETURN_${text(reservation.reservationId)}`;
      tx.create(db.collection("inventoryReturnEvents").doc(eventId), { schemaVersion: 1, inventoryContractVersion: 2, eventId, orderId, reservationId: reservation.reservationId, productId: reservation.productId, saleableReturnedQuantity: reservation.saleableReservedQuantity, promotionalReturnedQuantity: reservation.promotionalReservedQuantity, totalReturnedQuantity: total, reason: text(reason), restoredAt: FieldValue.serverTimestamp(), restoredBy: actorUid, source: "BACKEND" });
    }
  }
  return { applied: true, legacy: false };
}

export async function requireConsumedReservationsInTransaction(db: Firestore, tx: Transaction, order: Record<string, unknown>) {
  const contract = classifyInventoryContract(order);
  if (contract.kind === "INTEGRITY_ERROR") throw new InventoryReservationError(contract.code);
  if (contract.legacy) return { verified: false, legacy: true };
  const orderId = text(order.id || order.orderId);
  const ids = Array.isArray(order.reservationIds) ? order.reservationIds.map(text).filter(Boolean).sort() : [];
  if (!orderId || ids.length === 0) throw new InventoryReservationError("VERSION2_ORDER_RESERVATION_MISSING");
  const snapshots = await Promise.all(ids.map(id => tx.get(db.collection("inventoryReservations").doc(id))));
  if (snapshots.some(snapshot => !snapshot.exists)) throw new InventoryReservationError("VERSION2_ORDER_RESERVATION_MISSING");
  const reservations = snapshots.map(snapshot => snapshot.data()!);
  if (reservations.some(row => text(row.orderId) !== orderId || deterministicReservationId(orderId, text(row.productId)) !== text(row.reservationId))) {
    throw new InventoryReservationError("INVENTORY_RESERVATION_ORDER_MISMATCH");
  }
  if (reservations.some(row => text(row.status) !== "CONSUMED")) throw new InventoryReservationError("VERSION2_DELIVERY_RESERVATION_NOT_CONSUMED");
  return { verified: true, legacy: false };
}
