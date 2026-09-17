import { spawnSync } from "node:child_process";
import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { uatEnvironment } from "./constants";

Object.assign(process.env, uatEnvironment("wp98-commercial-browser-certification-secret-000000000000000000000"));
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
delete process.env.FIREBASE_TOKEN;
const { assertProductionIsolation } = await import("./preflight");
const { seedEmulatorState } = await import("./seed");
assertProductionIsolation();
await seedEmulatorState();
const result = spawnSync("npx", ["playwright", "test", "--config", "playwright.uat.config.ts", "commercialE2E.spec.ts"], { env: process.env, stdio: "inherit", shell: false });
if (result.status !== 0) process.exit(result.status ?? 1);

const certificationApp = getApps()[0] || initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = getFirestore(certificationApp);
const createdOrders = await db.collection("orders").where("visitId", "!=", "").get();
const canonicalOrders = createdOrders.docs
  .map((doc) => ({ id: doc.id, ...doc.data() } as Record<string, any>))
  .filter((order) => order.createdByUid === "uat-sales-rep-west-a" && /^UT-SO-/.test(String(order.displayNumber || "")));
if (canonicalOrders.length !== 1) throw new Error(`COMMERCIAL_ORDER_UNIQUENESS_FAILED:${canonicalOrders.length}`);
const order = canonicalOrders[0];
const history = Array.isArray(order.history) ? order.history : [];
if (order.status !== "DELIVERED" || order.stage !== "CLOSED") throw new Error("COMMERCIAL_TERMINAL_STATE_FAILED");
if (order.recipientName !== "Synthetic Pharmacy Recipient") throw new Error("COMMERCIAL_RECIPIENT_LINEAGE_FAILED");
if (order.deliveredByUid !== "uat-delivery-officer") throw new Error("COMMERCIAL_DELIVERY_ACTOR_FAILED");
if (!history.some((entry: any) => entry.action === "DELIVERY_COMPLETE" && entry.actorUid === "uat-delivery-officer" && entry.toStatus === "DELIVERED")) throw new Error("COMMERCIAL_DELIVERY_HISTORY_FAILED");
if (order.pharmacyId !== "PHARM-COMM-A" || order.representativeUid !== "uat-sales-rep-west-a" || !order.visitId || !order.marketId || !order.currencyCode || !order.displayNumber) throw new Error("COMMERCIAL_CANONICAL_LINEAGE_FAILED");
console.log(`WP109_TERMINAL_ORDER_CERTIFICATION=PASS:${order.displayNumber}`);
if (getApps().includes(certificationApp)) await deleteApp(certificationApp);
