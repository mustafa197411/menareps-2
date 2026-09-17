import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UAT_PROJECT_ID } from "./constants";
import { assertProductionIsolation } from "./preflight";

const IDS = Object.freeze({
  representative: "uat-medical-rep-west-a",
  supervisor: "uat-medical-supervisor",
  finalManager: "uat-medical-manager",
  executionManager: "uat-country-manager-ly",
  area: "WEST-A1",
  outsideArea: "WEST-A2",
  physician: "PHY-MED-IN",
  outsidePhysician: "PHY-MED-OUT",
  primaryGroup: "PG-A",
  targetGroup: "PG-B",
  primaryProduct: "P-A",
  targetProduct: "P-B",
  keyMessage: "KM-P-A",
  sampleSku: "SKU-P-A-ONE",
  batch: "BATCH-P-A-FEFO",
  allocation: "ALLOC-MED-A",
  market: "LY",
});

let app: ReturnType<typeof initializeApp>;
let db: ReturnType<typeof getFirestore>;

beforeAll(() => {
  assertProductionIsolation();
  app = getApps().find(candidate => candidate.name === "medical-e2e-contract")
    ?? initializeApp({ projectId: UAT_PROJECT_ID }, "medical-e2e-contract");
  db = getFirestore(app);
});
afterAll(async () => deleteApp(app));

async function record(collection: string, id: string) {
  const snapshot = await db.collection(collection).doc(id).get();
  expect(snapshot.exists, `${collection}/${id} must exist`).toBe(true);
  return snapshot.data() as Record<string, unknown>;
}

describe("synthetic Medical E2E canonical fixture contract", () => {
  it("has an active canonical reporting chain and explicit operational assignments", async () => {
    const representative = await record("users", IDS.representative);
    const supervisor = await record("users", IDS.supervisor);
    const finalManager = await record("users", IDS.finalManager);
    const executionManager = await record("users", IDS.executionManager);
    expect([representative.active, supervisor.active, finalManager.active, executionManager.active]).toEqual([true, true, true, true]);
    expect(representative.managerId).toBe(IDS.supervisor);
    expect(representative.primaryPromotionGroupId).toBe(IDS.primaryGroup);
    expect(supervisor.managerId).toBe(IDS.finalManager);
    expect(finalManager.managerId).toBe(IDS.executionManager);
    expect((await record("userTerritoryAssignments", `TA_${IDS.representative}_${IDS.area}`)).areaId).toBe(IDS.area);
    const assignedProductGroups = new Map<string, unknown>();
    for (const productId of [IDS.targetProduct, IDS.primaryProduct]) {
      const assignment = await record("userProductAssignments", `PA_${IDS.representative}_${productId}`);
      const product = await record("products", productId);
      expect(assignment.productId).toBe(productId);
      expect(assignment.productGroupId).toBe(product.promotionGroupId);
      assignedProductGroups.set(productId, assignment.productGroupId);
    }
    expect(assignedProductGroups).toEqual(new Map([
      [IDS.targetProduct, IDS.targetGroup],
      [IDS.primaryProduct, IDS.primaryGroup],
    ]));
    const primaryGroup = await record("productPromotionGroups", IDS.primaryGroup);
    expect(primaryGroup.active).toBe(true);
    expect((await record("products", IDS.primaryProduct)).promotionGroupId).toBe(IDS.primaryGroup);
  });

  it("has deterministic physician geography and canonical promotion alignment", async () => {
    const physician = await record("physicians", IDS.physician);
    const outside = await record("physicians", IDS.outsidePhysician);
    expect(physician.areaId).toBe(IDS.area);
    expect(outside.areaId).toBe(IDS.outsideArea);
    expect(physician.primaryPromotionGroupId).toBe(IDS.primaryGroup);
    expect(physician.targetPromotionGroupIds).toEqual([IDS.targetGroup]);
    expect(physician.alignedProductIds).toEqual(expect.arrayContaining([IDS.primaryProduct, IDS.targetProduct]));
    expect((await record("areas", IDS.area)).active).toBe(true);
  });

  it("has canonical Product, message, SKU, batch, and representative allocation lineage", async () => {
    expect((await record("products", IDS.primaryProduct)).promotionGroupId).toBe(IDS.primaryGroup);
    expect((await record("products", IDS.targetProduct)).promotionGroupId).toBe(IDS.targetGroup);
    expect((await record("keyMessages", IDS.keyMessage)).productId).toBe(IDS.primaryProduct);
    expect((await record("sampleCatalog", IDS.sampleSku)).productId).toBe(IDS.primaryProduct);
    const batch = await record("sampleBatches", IDS.batch);
    expect(batch.active).toBe(true);
    expect(batch.sampleSkuId).toBe(IDS.sampleSku);
    expect(batch.status).toBe("AVAILABLE");
    const minimumPositiveExpiry = new Date();
    minimumPositiveExpiry.setUTCDate(minimumPositiveExpiry.getUTCDate() + 60);
    expect(String(batch.expiryDate).slice(0, 10) >= minimumPositiveExpiry.toISOString().slice(0, 10)).toBe(true);
    expect(Number(batch.availableQuantity)).toBeGreaterThanOrEqual(3);
    expect(Number(batch.receivedQuantity)).toBeGreaterThanOrEqual(Number(batch.availableQuantity));
    const allocation = await record("sampleAllocations", IDS.allocation);
    expect(allocation.repId).toBe(IDS.representative);
    expect(allocation.sampleSkuId).toBe(IDS.sampleSku);
    expect(allocation.batchId).toBe(IDS.batch);
    expect(Number(allocation.quantityRemaining)).toBeGreaterThanOrEqual(3);
    expect(Number(allocation.quantityRemaining)).toBeLessThanOrEqual(Number(batch.availableQuantity));
  });

  it("has one complete active market/calendar/document-number contract", async () => {
    const market = await record("marketSettings", IDS.market);
    expect(market.countryId).toBe(IDS.market);
    expect(market.active).toBe(true);
    expect(typeof market.timezone).toBe("string");
    expect(Array.isArray(market.workingWeekdays)).toBe(true);
    expect((market.workingWeekdays as unknown[]).length).toBeGreaterThan(0);
    expect(market.businessDocumentCode).toMatch(/^[A-Z0-9]{2,8}$/);
  });
});
