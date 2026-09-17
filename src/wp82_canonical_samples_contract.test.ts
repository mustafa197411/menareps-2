import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const visit = readFileSync("src/components/PhysicianVisit.tsx", "utf8");
const writer = readFileSync("server/physicianVisitWriteService.ts", "utf8");
const standalone = readFileSync("server/sampleDistributionService.ts", "utf8");
const rules = readFileSync("firestore.rules", "utf8");
const legacy = readFileSync("src/lib/firestoreService.ts", "utf8");
const requests = readFileSync("src/components/samples/SampleRequests.tsx", "utf8");
const physicians = readFileSync("src/components/PhysicianList.tsx", "utf8");
const specialties = readFileSync("src/utils/specialtyService.ts", "utf8");
const seeding = readFileSync("src/lib/firebaseSync.ts", "utf8");

describe("WP82 canonical samples runtime contract", () => {
  it("requires an explicit SKU in every visit sample block", () => { expect(visit).toContain("sampleSkuId: string"); expect(visit).toContain("-- Select SKU --"); expect(visit).not.toContain("Stock: {p.stock}"); });
  it("uses authenticated distributable options rather than commercial Product stock", () => { expect(visit).toContain("fetchSampleVisitOptions(auth.currentUser"); expect(visit).toContain("option.availableQuantity"); });
  it("aggregates duplicate SKUs and applies one per-SKU policy", () => { expect(writer).toContain("aggregateSampleRequests"); expect(writer).toContain("sampleRequests.reduce"); });
  it("does not authorize using monthly Product limits or monthly usage counters", () => { expect(writer).not.toContain("monthlyPhysicianSampleLimit"); expect(writer).not.toContain('collection("physicianSampleUsage")'); });
  it("resolves market-local distribution date and full FEFO lineage", () => { expect(writer).toContain("marketLocalDate(now, timezone)"); expect(writer).toContain("allocationConsumptions: lineage"); expect(writer).not.toContain("consumeAllocationsFefo"); });
  it("serializes rolling cap mutations on a physician lock", () => { expect(writer).toContain('collection("physicianSampleRollingUsage")'); expect(writer).toContain("assertRollingPhysicianLimit"); });
  it("standalone distribution uses the same canonical policy primitives", () => { expect(standalone).toContain("eligibleProductsForPhysician"); expect(standalone).toContain("planRepresentativeFefo"); expect(standalone).toContain("assertRollingPhysicianLimit"); });
  it("legacy offline replay calls authenticated backend and has no display-name allocation scan", () => { const start = legacy.indexOf("export async function disburseSampleTransactional"); const end = legacy.indexOf("// Receive sample stock", start); const body = legacy.slice(start, end); expect(body).toContain('/api/samples/distribute'); expect(body).not.toContain('collection(db, "sampleAllocations")'); expect(body).not.toContain("data.productName === prodName"); expect(body).toContain("SAMPLE_DISTRIBUTION_REQUIRES_ONLINE_AUTHORITY"); });
  it("denies direct representative composition of authoritative sample collections", () => { expect(rules).toContain("Distribution is composed atomically by the authenticated backend"); expect(rules).toContain("match /physicianSampleRollingUsage/{usageId}"); });
  it("production runtime cannot enable operational mock fallback", () => {
    expect(requests).not.toContain("VITE_ENABLE_MOCK_DATA");
    expect(requests).not.toContain("mockRequests");
    for (const source of [physicians, specialties]) {
      const toggles = source.match(/(?:import\.meta\.env\.DEV && )?import\.meta\.env\.VITE_ENABLE_MOCK_DATA === "true"/g) || [];
      expect(toggles.length).toBeGreaterThan(0);
      expect(toggles.every(toggle => toggle.startsWith("import.meta.env.DEV && "))).toBe(true);
    }
    expect(seeding).toContain("const isDemoSeedingEnabled = import.meta.env.DEV &&");
    expect(seeding).toContain('await import("./sampleMockData")');
    expect(seeding).toContain("Demo seeding is available only in a development build.");
  });
  it("contains no unapproved A/B brand or SKU-count policy", () => { for (const source of [visit, writer, standalone]) { expect(source).not.toMatch(/max(?:imum)?\s*[236]\s*(?:brands?|skus?)/i); } });
});
