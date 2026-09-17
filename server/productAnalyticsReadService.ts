import { getFirebaseAdminServices } from "./firebaseAdmin";
import { createFirestoreOperationalScopeRepository, resolveOperationalScopeForActor, type OperationalScopeRepository } from "./operationalScopeRepository";

export interface ProductAnalyticsOrder { id: string; areaId: string; date: string; currencyCode: string; total: number; status: string; items: Array<{ productId: string; name: string; quantity: number; total: number }> }
export interface ProductAnalyticsRepository { queryOrdersByAreaIds(areaIds: string[]): Promise<Record<string, any>[]> }
const ids = (value: unknown): string[] => Array.isArray(value) ? Array.from(new Set(value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map(item => item.trim()))).sort() : [];
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";

export function createFirestoreProductAnalyticsRepository(): ProductAnalyticsRepository {
  return { async queryOrdersByAreaIds(areaIds) { if (areaIds.length < 1 || areaIds.length > 30) throw new Error("INVALID_PRODUCT_ANALYTICS_AREA_CHUNK"); const { db } = getFirebaseAdminServices(); const snapshot = await db.collection("orders").where("areaId", "in", areaIds).get(); return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })); } };
}

export async function resolveScopedProductAnalytics(actorUid: string, dependencies: { operationalScopeRepository?: OperationalScopeRepository; repository?: ProductAnalyticsRepository } = {}) {
  const scope = await resolveOperationalScopeForActor(actorUid, {}, dependencies.operationalScopeRepository || createFirestoreOperationalScopeRepository());
  if (!scope.authorized || scope.queryPlan.denyAll || !scope.queryPlan.areaIdChunks.length || !scope.productIds.length) return { authorized: false, code: scope.code || "PRODUCT_ANALYTICS_SCOPE_DENIED", orders: [] as ProductAnalyticsOrder[] };
  const repository = dependencies.repository || createFirestoreProductAnalyticsRepository();
  const rows = (await Promise.all(scope.queryPlan.areaIdChunks.map(chunk => repository.queryOrdersByAreaIds(chunk)))).flat();
  const areas = new Set(ids(scope.areaIds)); const products = new Set(ids(scope.productIds)); const orders: ProductAnalyticsOrder[] = [];
  for (const row of rows) {
    const id = text(row.id), areaId = text(row.areaId), date = text(row.orderDate || row.createdAt || row.date).slice(0, 10), currencyCode = text(row.currencyCode || row.currency);
    if (!id || !areas.has(areaId) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[A-Z]{3}$/.test(currencyCode)) continue;
    const items = Array.isArray(row.items) ? row.items.map((item: any) => ({ productId: text(item.productId || item.id), name: text(item.name || item.productName), quantity: Number(item.quantity || item.qty || 0), total: Number(item.total || (Number(item.price || item.unitPrice || 0) * Number(item.quantity || item.qty || 0))) })).filter(item => products.has(item.productId) && Number.isFinite(item.quantity) && Number.isFinite(item.total)) : [];
    if (!items.length) continue;
    orders.push({ id, areaId, date, currencyCode, status: text(row.status), items, total: items.reduce((sum, item) => sum + item.total, 0) });
  }
  return { authorized: true, orders: orders.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)) };
}
