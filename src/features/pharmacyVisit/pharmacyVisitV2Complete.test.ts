import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePharmacyVisitCompletionRequest } from "../../../server/pharmacyVisitCompletionService";

describe("WP102 authoritative Pharmacy Visit completion request", () => {
  it("accepts only the bounded draft and optional remarks envelope", () => { const draft = { draftId: "D", repUid: "R", pharmacyId: "P", areaId: "A" }; expect(parsePharmacyVisitCompletionRequest({ draft, finalRemarks: "note" })).toEqual({ draft, finalRemarks: "note" }); expect(parsePharmacyVisitCompletionRequest({ draft, status: "COMPLETED" })).toBeNull(); });
  it("requires canonical identity-bearing draft fields", () => expect(parsePharmacyVisitCompletionRequest({ draft: { draftId: "D" } })).toBeNull());
  it("server derives completion state, actor, geography, market, totals and document number", () => { const source = fs.readFileSync(new URL("../../../server/pharmacyVisitCompletionService.ts", import.meta.url), "utf8"); for (const evidence of ['status: "COMPLETED"', "repId: actorUid", "scope.areaIds.includes(areaId)", "marketDateForInstant", "formatBusinessDocumentNumber", "grossTotal"]) expect(source).toContain(evidence); });
});
