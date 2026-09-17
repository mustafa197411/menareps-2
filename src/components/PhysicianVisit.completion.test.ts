import { describe, expect, it, vi } from "vitest";
import {
  buildVisitSamplePayload,
  PhysicianVisitCompletionUiState,
  runPhysicianVisitCompletionAttempt
} from "./PhysicianVisit";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("WP7.10A Physician Visit completion reliability", () => {
  it("preserves distinct explicitly selected Sample SKUs in the completion payload", () => {
    const samples = buildVisitSamplePayload([
      { id: "BLOCK-B", therapeuticArea: "AREA", brand: "BRAND", productId: "PRODUCT", sampleSkuId: "SKU-B", quantity: 2 },
      { id: "BLOCK-A", therapeuticArea: "AREA", brand: "BRAND", productId: "PRODUCT", sampleSkuId: "SKU-A", quantity: 1 },
    ], [{ id: "PRODUCT", name: "Product", brand: "Brand" } as any]);

    expect(samples.map(sample => sample.sampleSkuId)).toEqual(["SKU-B", "SKU-A"]);
    expect(samples).toEqual(expect.arrayContaining([
      expect.objectContaining({ productId: "PRODUCT", sampleSkuId: "SKU-A", quantity: 1 }),
      expect.objectContaining({ productId: "PRODUCT", sampleSkuId: "SKU-B", quantity: 2 }),
    ]));
  });

  it("resets only after persistence resolves successfully", async () => {
    const persistence = deferred<{ status: "COMPLETED" }>();
    const states: PhysicianVisitCompletionUiState[] = [];
    const onCompleted = vi.fn();
    const attempt = runPhysicianVisitCompletionAttempt({
      lock: { current: false },
      submit: () => persistence.promise,
      setState: state => states.push(state),
      onCompleted
    });

    expect(onCompleted).not.toHaveBeenCalled();
    expect(states.at(-1)).toEqual({ status: "SAVING" });

    persistence.resolve({ status: "COMPLETED" });
    await attempt;

    expect(onCompleted).toHaveBeenCalledOnce();
    expect(states.at(-1)).toEqual({ status: "IDLE" });
  });

  it("preserves state and exposes a retryable error when persistence fails", async () => {
    const states: PhysicianVisitCompletionUiState[] = [];
    const onCompleted = vi.fn();
    const lock = { current: false };

    await expect(runPhysicianVisitCompletionAttempt({
      lock,
      submit: async () => { throw new Error("permission denied"); },
      setState: state => states.push(state),
      onCompleted
    })).rejects.toThrow("permission denied");

    expect(onCompleted).not.toHaveBeenCalled();
    expect(states.at(-1)).toEqual({ status: "ERROR", message: "permission denied" });
    expect(lock.current).toBe(false);
  });

  it("blocks duplicate completion attempts while a save is in progress", async () => {
    const persistence = deferred<{ status: "COMPLETED" }>();
    const submit = vi.fn(() => persistence.promise);
    const lock = { current: false };
    const options = {
      lock,
      submit,
      setState: vi.fn(),
      onCompleted: vi.fn()
    };

    const first = runPhysicianVisitCompletionAttempt(options);
    const duplicate = await runPhysicianVisitCompletionAttempt(options);

    expect(duplicate).toBeNull();
    expect(submit).toHaveBeenCalledOnce();

    persistence.resolve({ status: "COMPLETED" });
    await first;
  });

  it("publishes SAVING immediately so the saving indicator is shown", async () => {
    const persistence = deferred<{ status: "COMPLETED" }>();
    let visibleState: PhysicianVisitCompletionUiState = { status: "IDLE" };
    const attempt = runPhysicianVisitCompletionAttempt({
      lock: { current: false },
      submit: () => persistence.promise,
      setState: state => { visibleState = state; },
      onCompleted: vi.fn()
    });

    expect(visibleState).toEqual({ status: "SAVING" });

    persistence.resolve({ status: "COMPLETED" });
    await attempt;
  });

  it("keeps the form and reports offline queueing as Pending Sync, not cloud completion", async () => {
    const states: PhysicianVisitCompletionUiState[] = [];
    const onCompleted = vi.fn();
    const lock = { current: false };

    const result = await runPhysicianVisitCompletionAttempt({
      lock,
      submit: async () => ({ status: "PENDING_SYNC", queueItemId: "OQ-PHY-123456" }),
      setState: state => states.push(state),
      onCompleted
    });

    expect(result).toEqual({ status: "PENDING_SYNC", queueItemId: "OQ-PHY-123456" });
    expect(onCompleted).not.toHaveBeenCalled();
    expect(states.at(-1)).toEqual({ status: "PENDING_SYNC", queueItemId: "OQ-PHY-123456" });
    expect(lock.current).toBe(true);
  });
});
