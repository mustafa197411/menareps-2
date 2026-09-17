import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("WP102 Pharmacy Visit transaction authority contract", () => {
  const completion = fs.readFileSync(new URL("./services/completePharmacyVisitV2.ts", import.meta.url), "utf8");
  const backend = fs.readFileSync(new URL("../../../server/pharmacyVisitCompletionService.ts", import.meta.url), "utf8");
  it("browser completion uses the authenticated endpoint and no Firestore transaction", () => { expect(completion).toContain("completePharmacyVisitAuthoritatively"); expect(completion).not.toContain("runTransaction"); expect(completion).not.toContain("businessDocumentSequences"); });
  it("document sequence and immutable audit are backend-owned", () => { expect(backend).toContain('collection("businessDocumentSequences")'); expect(backend).toContain('collection("auditLogs")'); expect(backend).toContain('source: "BACKEND"'); });
  it("the governed Order is created atomically by completion authority", () => { expect(backend).toContain('tx.create(db.collection("orders").doc(orderId), order)'); expect(completion).not.toContain("createOrderFromCompletedPharmacyVisit"); });
});
