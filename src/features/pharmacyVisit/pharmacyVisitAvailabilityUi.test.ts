import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { calculateShortageCandidates } from "./services/shortageEligibilityEngine";

const source = fs.readFileSync(new URL("./steps/Step2OrderItems.tsx", import.meta.url), "utf8");
const completion = fs.readFileSync(new URL("./steps/Step6CompleteVisit.tsx", import.meta.url), "utf8");
describe("Pharmacy Visit Step 2 availability UI preservation", () => {
  it("renders established two-column searchable independently scrollable panels", () => {
    expect(source).toContain('grid grid-cols-1 lg:grid-cols-2');
    expect(source).toContain('"Available Products"');
    expect(source).toContain('"Order Items"');
    expect(source.match(/max-h-96 overflow-y-auto/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain('value={searchQuery}');
  });
  it("adds selections immediately to the Order Items panel and supports empty state", () => {
    expect(source).toContain('currentOrderLines.map(line =>');
    expect(source).toContain('"No products selected"');
    expect(source).toContain('onAddOrderLine(newLine)');
  });
  it("never renders numeric stock unless the DTO explicitly permits it", () => {
    expect(source).toContain('availability.showNumericStock && availability.actualAvailableQty !== undefined');
    expect(source).not.toContain('p.stockQuantity');
    expect(source).not.toContain('p.stock}');
  });
  it("does not alter Pharmacy Visit completion code", () => {
    expect(completion).not.toContain("product-availability");
  });
  it("offers only confirmed genuine zero stock to the shortage workflow", () => {
    const product = { id: "P1", code: "P1", sku: "SKU1", name: "One", brand: "B", therapeuticArea: "T", price: 1, stock: 999, isActive: true } as any;
    const draft = { draftId: "D1", repUid: "REP", countryId: "C1", order: { lines: [], productAvailability: [
      { productId: "P1", availabilityState: "OUT_OF_STOCK", canOrder: false, shortageEligible: true, showNumericStock: false },
      { productId: "P2", availabilityState: "UNAVAILABLE_ERROR", canOrder: false, shortageEligible: false, showNumericStock: false },
    ] } } as any;
    const candidates = calculateShortageCandidates(draft, [product]);
    expect(candidates.map(candidate => candidate.productId)).toEqual(["P1"]);
    expect(draft.order.lines).toEqual([]);
  });
});
