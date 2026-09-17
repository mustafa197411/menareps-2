import { beforeEach, describe, expect, it, vi } from "vitest";
const harness = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void)[], fetch: vi.fn() }));
vi.mock("react", async importOriginal => {
  const actual: any = await importOriginal();
  const state = (initial: any) => { const i = harness.cursor++; if (!(i in harness.slots)) harness.slots[i] = typeof initial === "function" ? initial() : initial; return [harness.slots[i], (v: any) => { harness.slots[i] = typeof v === "function" ? v(harness.slots[i]) : v; }]; };
  const memo = (fn: any, deps: any[]) => { const i = harness.cursor++, old = harness.slots[i]; if (!old || deps.some((d, n) => !Object.is(d, old.deps[n]))) harness.slots[i] = { deps, value: fn() }; return harness.slots[i].value; };
  const effect = (fn: any, deps: any[]) => { const i = harness.cursor++, old = harness.slots[i]; if (!old || deps.some((d, n) => !Object.is(d, old.deps[n]))) { const slot = { deps, cleanup: undefined as any }; harness.slots[i] = slot; harness.effects.push(() => { old?.cleanup?.(); slot.cleanup = fn(); }); } };
  const overrides = { useState: state, useRef: (v: any) => state({ current: v })[0], useMemo: memo, useCallback: (fn: any, deps: any[]) => memo(() => fn, deps), useEffect: effect, useLayoutEffect: effect };
  return { ...actual, ...overrides, default: { ...actual.default, ...overrides } };
});
vi.mock("./services/offerService", () => ({ fetchLivePharmacyOffers: harness.fetch, PharmacyOfferReadError: class extends Error { constructor(public code: string) { super(code); } } }));
import { Step3ApplyOffers } from "./steps/Step3ApplyOffers";
import { LIBYA_MARKET_DEFAULT } from "../../lib/marketSettings";
const market = LIBYA_MARKET_DEFAULT;
const line = { id: "L", canonicalProductId: "P", quantity: 1, unitPricePreview: 1 };
function render(props: any) { harness.cursor = 0; const tree = Step3ApplyOffers(props); const effects = harness.effects.splice(0); effects.forEach(fn => fn()); return tree; }
beforeEach(() => { harness.slots = []; harness.cursor = 0; harness.effects = []; harness.fetch.mockReset(); });
describe("Step 6 asynchronous discovery", () => {
  it("ignores an older successful response after newer order discovery fails", async () => {
    let finishOld!: (v: any) => void, failNew!: (v: any) => void;
    harness.fetch.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; })).mockImplementationOnce(() => new Promise((_, reject) => { failNew = reject; }));
    const ready = vi.fn(), dispatch = vi.fn();
    const props: any = { draft: { pharmacyId: "PH", areaId: "A", pharmacySnapshot: { countryId: "C" }, order: { lines: [line] } }, market, marketStatus: "RESOLVED", onReadinessChange: ready, dispatch };
    render(props);
    const changed = { ...props, draft: { ...props.draft, order: { lines: [{ ...line, quantity: 2 }] } } };
    render(changed); failNew(new Error("failure")); await Promise.resolve();
    render(changed); finishOld({ offers: [], unavailableOfferIds: [], selectedCombinationAvailable: true }); await Promise.resolve();
    const tree = render(changed);
    expect(ready.mock.calls.at(-1)).toEqual([false]);
    expect(JSON.stringify(tree)).not.toContain("No eligible Offers");
    expect(harness.fetch).toHaveBeenCalledTimes(2);
  });
  it("signals readiness only after a current complete successful result", async () => {
    harness.fetch.mockResolvedValue({ offers: [], unavailableOfferIds: [], selectedCombinationAvailable: true });
    const ready = vi.fn();
    const props: any = { draft: { pharmacyId: "PH", areaId: "A", pharmacySnapshot: { countryId: "C" }, order: { lines: [line] } }, market, marketStatus: "RESOLVED", onReadinessChange: ready, dispatch: vi.fn() };
    render(props); expect(ready.mock.calls.at(-1)).toEqual([false]);
    await Promise.resolve(); render(props); expect(ready.mock.calls.at(-1)).toEqual([true]);
  });
});
