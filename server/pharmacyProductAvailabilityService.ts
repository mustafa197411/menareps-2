import type { Firestore } from "firebase-admin/firestore";
import { createFirestoreOperationalScopeRepository, resolveOperationalScopeForActor, type OperationalScopeRepository } from "./operationalScopeRepository";
import { getFirebaseAdminServices } from "./firebaseAdmin";
import type { ProductAvailability, ProductAvailabilityState } from "../src/features/pharmacyVisit/types/productAvailability";

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const active = (value: any) => value?.active !== false && value?.isActive !== false && value?.isDeleted !== true && value?.status !== "Inactive";
export interface PharmacyProductAvailabilityRequest { pharmacyId: string; productIds: string[] }
export interface AvailabilityDependencies { db?: Firestore; operationalScopeRepository?: OperationalScopeRepository }

export function parsePharmacyProductAvailabilityRequest(body: unknown): PharmacyProductAvailabilityRequest | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some(key => !["pharmacyId", "productIds"].includes(key))) return null;
  const pharmacyId = text(value.pharmacyId);
  const productIds = Array.isArray(value.productIds) ? [...new Set(value.productIds.map(text).filter(Boolean))] : [];
  return pharmacyId && productIds.length > 0 && productIds.length <= 100 ? { pharmacyId, productIds } : null;
}

export function availabilityResult(productId: string, quantity: number | null, showNumericStock: boolean, code?: string, errorState: ProductAvailabilityState = "UNAVAILABLE_ERROR"): ProductAvailability {
  if (quantity == null || !Number.isFinite(quantity) || quantity < 0) return { productId, availabilityState: errorState, canOrder: false, shortageEligible: false, showNumericStock, ...(code ? { code } : {}) };
  const available = quantity > 0;
  return { productId, availabilityState: available ? "AVAILABLE" : "OUT_OF_STOCK", canOrder: available, shortageEligible: !available, showNumericStock, ...(showNumericStock ? { actualAvailableQty: quantity } : {}) };
}

export function readProductStockQuantity(product: any): number | null {
  const quantity = product?.stockQuantity;
  return typeof quantity === "number" && Number.isFinite(quantity) && quantity >= 0 ? quantity : null;
}

export function readProductAvailableToPromise(product: any): number | null {
  const stock = readProductStockQuantity(product);
  const reserved = product?.activeReservedQuantity === undefined ? 0 : product.activeReservedQuantity;
  return stock != null && Number.isSafeInteger(reserved) && reserved >= 0 ? Math.max(0, stock - reserved) : null;
}

export async function resolvePharmacyProductAvailability(actorUid: string, request: PharmacyProductAvailabilityRequest, dependencies: AvailabilityDependencies = {}) {
  const scope = await resolveOperationalScopeForActor(actorUid, {}, dependencies.operationalScopeRepository || createFirestoreOperationalScopeRepository());
  if (!scope.authorized || scope.queryPlan.denyAll || scope.role !== "Sales Representative") return { authorized: false, code: scope.code || "AVAILABILITY_NOT_AUTHORIZED", availability: [] };
  const db = dependencies.db || getFirebaseAdminServices().db;
  const pharmacySnap = await db.collection("pharmacies").doc(request.pharmacyId).get();
  if (!pharmacySnap.exists || !active(pharmacySnap.data()) || !scope.areaIds.includes(text(pharmacySnap.data()?.areaId))) return { authorized: false, code: "PHARMACY_NOT_AUTHORIZED", availability: [] };
  const requestedIds = request.productIds.filter(id => scope.productIds.includes(id));
  if (requestedIds.length !== request.productIds.length) return { authorized: false, code: "PRODUCT_NOT_AUTHORIZED", availability: [] };
  const products = await Promise.all(requestedIds.map(id => db.collection("products").doc(id).get()));
  const availability = products.map((snap, index) => {
    const id = requestedIds[index];
    if (!snap.exists || !active(snap.data())) return availabilityResult(id, null, false, "PRODUCT_UNAVAILABLE");
    const quantity = readProductAvailableToPromise(snap.data());
    return availabilityResult(id, quantity, false, quantity == null ? "PRODUCT_STOCK_QUANTITY_INVALID" : undefined);
  });
  return { authorized: true, availability };
}
