import { getFirebaseAdminServices } from "./firebaseAdmin";
import { eligibleProductsForPhysician } from "../src/lib/canonicalRepresentativeScope";
import { addCalendarDays, isCanonicalDate, marketLocalDate, MIN_SAMPLE_SHELF_LIFE_DAYS } from "./sampleDistributionPolicy";

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const active = (value: any) => value?.active !== false && value?.isActive !== false && value?.isDeleted !== true && value?.status !== "Inactive";

export async function resolveSampleVisitOptions(actorUid: string, physicianId: string) {
  const { db } = getFirebaseAdminServices();
  const [actorSnap, physicianSnap, territorySnap, assignmentSnap, productsSnap, catalogSnap, allocationsSnap] = await Promise.all([
    db.collection("users").doc(actorUid).get(), db.collection("physicians").doc(physicianId).get(),
    db.collection("userTerritoryAssignments").where("userId", "==", actorUid).get(),
    db.collection("userProductAssignments").where("userId", "==", actorUid).get(), db.collection("products").get(),
    db.collection("sampleCatalog").get(), db.collection("sampleAllocations").where("repId", "==", actorUid).get(),
  ]);
  const actor = actorSnap.data(); const physician = physicianSnap.data();
  if (!actor || text(actor.role) !== "Medical Representative" || !active(actor) || actor.loginAllowed === false) return { success: false, code: "ACTOR_NOT_AUTHORIZED" };
  if (!physician || !active(physician) || !text(physician.areaId)) return { success: false, code: "PHYSICIAN_NOT_ELIGIBLE" };
  const areas = territorySnap.docs.map(doc => doc.data()).filter(active).map(row => text(row.areaId) || text(row.territoryId));
  if (!areas.includes(text(physician.areaId))) return { success: false, code: "PHYSICIAN_NOT_ELIGIBLE" };
  const products = productsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  const allowed = new Set(eligibleProductsForPhysician({ physician: physician as any, representativeUid: actorUid, productAssignments: assignmentSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })) as any, products: products as any }).map(product => text(product.id)));
  const areaSnap = await db.collection("areas").doc(text(physician.areaId)).get();
  if (!areaSnap.exists || !active(areaSnap.data()) || !text(areaSnap.data()?.countryId)) return { success: false, code: "CANONICAL_GEOGRAPHY_INVALID" };
  const marketSnap = await db.collection("marketSettings").where("countryId", "==", text(areaSnap.data()?.countryId)).get();
  const markets = marketSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)).filter(active);
  if (markets.length !== 1 || !text(markets[0].timezone)) return { success: false, code: markets.length ? "MARKET_CONFIGURATION_AMBIGUOUS" : "MARKET_CONFIGURATION_REQUIRED" };
  let date: string;
  try { date = marketLocalDate(new Date().toISOString(), text(markets[0].timezone)); }
  catch { return { success: false, code: "MARKET_TIMEZONE_INVALID" }; }
  const minimumExpiry = addCalendarDays(date, MIN_SAMPLE_SHELF_LIFE_DAYS);
  const allocations = allocationsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)).filter(row => active(row) && row.status === "ACTIVE" && Number(row.quantityRemaining) > 0 && text(row.batchId));
  const batchIds = [...new Set(allocations.map(row => text(row.batchId)))];
  const batchSnaps = batchIds.length ? await db.getAll(...batchIds.map(id => db.collection("sampleBatches").doc(id))) : [];
  const batches = new Map(batchSnaps.filter(snap => snap.exists).map(snap => [snap.id, { id: snap.id, ...snap.data() } as any]));
  const options = catalogSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)).filter(sku => active(sku) && sku.status === "ACTIVE" && allowed.has(text(sku.productId))).map(sku => {
    const usable = allocations.filter(allocation => allocation.sampleSkuId === sku.id).filter(allocation => {
      const batch = batches.get(text(allocation.batchId));
      const expiryDate = text(batch?.expiryDate).slice(0, 10);
      return batch && active(batch) && batch.status === "AVAILABLE" && batch.sampleSkuId === sku.id && isCanonicalDate(expiryDate) && expiryDate >= minimumExpiry;
    });
    return { sampleSkuId: sku.id, productId: sku.productId, name: sku.name, descriptor: sku.descriptor, availableQuantity: usable.reduce((sum, row) => sum + Number(row.quantityRemaining), 0), batches: usable.map(row => { const batch = batches.get(text(row.batchId))!; return { batchId: batch.id, batchNumber: batch.batchNumber, expiryDate: batch.expiryDate, availableQuantity: row.quantityRemaining }; }) };
  }).filter(option => option.availableQuantity > 0);
  return { success: true, options };
}
