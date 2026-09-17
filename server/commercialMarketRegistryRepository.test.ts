import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { createFirestoreCommercialMarketRegistryRepository, FIRESTORE_IN_QUERY_LIMIT } from "./commercialMarketRegistryRepository";

describe("Firestore commercial market registry repository boundary", () => {
  it("rejects oversized in-query chunks before accessing Firestore", async () => {
    const repository = createFirestoreCommercialMarketRegistryRepository({} as never);
    await expect(repository.readProducts({ ids: Array.from({ length: FIRESTORE_IN_QUERY_LIMIT + 1 }, (_, index) => `P_${index}`), limit: 100 })).rejects.toThrow("COMMERCIAL_REGISTRY_INVALID_ID_CHUNK");
  });

  it("uses bounded pagination and contains no unbounded collection get", () => {
    const source = fs.readFileSync(new URL("./commercialMarketRegistryRepository.ts", import.meta.url), "utf8");
    expect(source).toContain(".limit(request.limit)");
    expect(source).toContain(".startAfter(request.cursor)");
    expect(source).toContain('where(descriptor.filterField, "in"');
    expect(source).not.toMatch(/collection\([^)]*\)\.get\s*\(/);
    expect(source).toContain("COMMERCIAL_REGISTRY_DOCUMENT_ID_MISMATCH");
  });
});
