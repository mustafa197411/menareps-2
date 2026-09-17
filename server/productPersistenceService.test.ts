import { describe, expect, it, vi } from "vitest";
import { validateProductReference } from "../src/lib/commercialRegistry";
import { executeProductMutation, executeProductMutationBatch, MAX_PRODUCT_IMPORT_COMMANDS, parseProductMutationBatchRequest, parseProductMutationRequest, ProductPersistenceError, type ProductMutationCommand } from "./productPersistenceService";

const NOW = "2035-04-05T06:07:08.000Z";
const CREATED = "2034-01-02T03:04:05.000Z";
const AUDIT = { createdAt: CREATED, createdBy: "ACTOR_CREATOR", updatedAt: CREATED, updatedBy: "ACTOR_CREATOR" };
const actor = { role: "Admin", active: true, loginAllowed: true };
const command = (operation: "create" | "edit", productId = "PRODUCT_ALPHA", overrides: Record<string, unknown> = {}): ProductMutationCommand => ({
  operation, productId,
  product: { id: productId, name: "Synthetic Product", brand: "Synthetic Brand", therapeuticArea: "Synthetic Area", sku: "SKU_ALPHA", code: "CODE_ALPHA", price: 31, stock: 44, isActive: true, ...overrides } as ProductMutationCommand["product"],
});

class MemoryDb {
  documents = new Map<string, Record<string, unknown>>();
  writes: Array<{ method: "create" | "set"; path: string; data: Record<string, unknown> }> = [];
  reads: string[] = [];
  failFirstAttempt = false;
  collection(name: string) { return { doc: (id: string) => ({ id, path: `${name}/${id}`, get: async () => { const data = this.documents.get(`${name}/${id}`); return { exists: Boolean(data), data: () => data }; } }) }; }
  async runTransaction<T>(work: (transaction: any) => Promise<T>): Promise<T> {
    let attempt = 0;
    while (true) {
      attempt += 1;
      const pending: typeof this.writes = [];
      const transaction = {
        get: async (reference: { path: string }) => {
          this.reads.push(reference.path);
          const data = this.documents.get(reference.path);
          return { exists: Boolean(data), data: () => structuredClone(data) };
        },
        create: (reference: { path: string }, data: Record<string, unknown>) => pending.push({ method: "create", path: reference.path, data: structuredClone(data) }),
        set: (reference: { path: string }, data: Record<string, unknown>) => pending.push({ method: "set", path: reference.path, data: structuredClone(data) }),
      };
      const result = await work(transaction);
      if (this.failFirstAttempt && attempt === 1) continue;
      for (const write of pending) this.documents.set(write.path, { ...(this.documents.get(write.path) || {}), ...write.data });
      this.writes.push(...pending);
      return result;
    }
  }
}

const allow = vi.fn(async () => undefined);
const dependencies = (authorize = allow, clock = () => NOW) => ({ authorize, clock });

describe("authenticated Product persistence service", () => {
  it("strictly parses generic create and edit commands", () => {
    expect(parseProductMutationRequest(command("create"))).toEqual(command("create"));
    expect(parseProductMutationRequest(command("edit"))).toEqual(command("edit"));
    for (const invalid of [{}, { ...command("create"), productId: " bad " }, { ...command("create"), product: { isActive: "true" } }, { ...command("create"), extra: true }]) expect(parseProductMutationRequest(invalid)).toBeNull();
  });

  it("accepts bounded batches of 1 and 100 and rejects 0 and 101 before authorization", async () => {
    for (const size of [1, MAX_PRODUCT_IMPORT_COMMANDS]) {
      const commands = Array.from({ length: size }, (_, index) => command("create", `PRODUCT_${index}`));
      expect(parseProductMutationBatchRequest({ commands })).toHaveLength(size);
      const db = new MemoryDb();
      await expect(executeProductMutationBatch("ACTOR_SERVER", actor, commands, db as never, dependencies())).resolves.toMatchObject({ status: "COMPLETED" });
      expect(db.writes).toHaveLength(size);
    }
    for (const commands of [[], Array.from({ length: MAX_PRODUCT_IMPORT_COMMANDS + 1 }, (_, index) => command("create", `PRODUCT_${index}`))]) {
      const db = new MemoryDb(), authorize = vi.fn(async () => undefined);
      await expect(executeProductMutationBatch("ACTOR_SERVER", actor, commands, db as never, dependencies(authorize))).rejects.toMatchObject({ code: "PRODUCT_IMPORT_BATCH_SIZE_INVALID" });
      expect(authorize).not.toHaveBeenCalled(); expect(db.reads).toEqual([]); expect(db.writes).toEqual([]);
    }
  });

  it("atomically persists a mixed import after all exact reads and preserves import metadata", async () => {
    const db = new MemoryDb();
    db.documents.set("products/PRODUCT_EDIT", { id: "PRODUCT_EDIT", productId: "PRODUCT_EDIT", name: "Before", sku: "SKU_KEEP", isActive: true, active: true, source: "existing", ...AUDIT });
    const result = await executeProductMutationBatch("ACTOR_SERVER", actor, [
      command("create", "PRODUCT_CREATE", { source: "synthetic-import", importBatchId: "BATCH_SYNTHETIC", importedAt: "FORGED_TIME", importedBy: "FORGED_ACTOR" }),
      command("edit", "PRODUCT_EDIT", { name: "After", source: "synthetic-import", importedAt: "FORGED_TIME", importedBy: "FORGED_ACTOR" }),
    ], db as never, dependencies());
    expect(result.status).toBe("COMPLETED");
    expect(db.reads).toEqual(["products/PRODUCT_CREATE", "products/PRODUCT_EDIT"]);
    expect(db.writes).toHaveLength(2);
    expect(result.products[0].product).toMatchObject({ productId: "PRODUCT_CREATE", source: "synthetic-import", importBatchId: "BATCH_SYNTHETIC", createdBy: "ACTOR_SERVER", importedAt: NOW, importedBy: "ACTOR_SERVER" });
    expect(result.products[1].product).toMatchObject({ productId: "PRODUCT_EDIT", name: "After", source: "synthetic-import", importedAt: NOW, importedBy: "ACTOR_SERVER", createdBy: "ACTOR_CREATOR" });
  });

  it("rejects a conflicting or invalid batch atomically", async () => {
    for (const commands of [
      [command("create", "PRODUCT_DUPLICATE"), command("edit", "PRODUCT_DUPLICATE")],
      [command("create", "PRODUCT_NEW"), command("edit", "PRODUCT_MISSING")],
    ]) {
      const db = new MemoryDb();
      await expect(executeProductMutationBatch("ACTOR_SERVER", actor, commands, db as never, dependencies())).rejects.toBeInstanceOf(ProductPersistenceError);
      expect(db.writes).toEqual([]);
    }
  });

  it("authorizes the complete batch before beginning exact Product reads", async () => {
    const db = new MemoryDb();
    const authorize = vi.fn(async (_uid, _profile, _operation, productId) => {
      if (productId === "PRODUCT_DENIED") throw new ProductPersistenceError("PRODUCT_PERMISSION_DENIED", 403);
    });
    await expect(executeProductMutationBatch("ACTOR_SERVER", actor, [command("create", "PRODUCT_ALLOWED"), command("create", "PRODUCT_DENIED")], db as never, dependencies(authorize))).rejects.toMatchObject({ code: "PRODUCT_PERMISSION_DENIED" });
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(db.reads).toEqual([]); expect(db.writes).toEqual([]);
  });

  it("creates one exact canonical Product using only server identity and time", async () => {
    const db = new MemoryDb();
    const input = command("create", "PRODUCT_CREATE", { productId: "CLIENT_ID", active: false, createdAt: "CLIENT_TIME", createdBy: "CLIENT_ACTOR", updatedAt: "CLIENT_TIME", updatedBy: "CLIENT_ACTOR" });
    const result = await executeProductMutation("ACTOR_SERVER", actor, input, db as never, dependencies());
    expect(result.status).toBe("CREATED");
    expect(db.reads).toEqual(["products/PRODUCT_CREATE"]);
    expect(db.writes).toEqual([{ method: "create", path: "products/PRODUCT_CREATE", data: result.product }]);
    expect(result.product).toMatchObject({ id: "PRODUCT_CREATE", productId: "PRODUCT_CREATE", isActive: true, active: true, createdAt: NOW, createdBy: "ACTOR_SERVER", updatedAt: NOW, updatedBy: "ACTOR_SERVER", sku: "SKU_ALPHA", code: "CODE_ALPHA", price: 31 });
    expect(result.product).not.toHaveProperty("importedAt");
    expect(result.product).not.toHaveProperty("importedBy");
    expect(validateProductReference(result.product)).toMatchObject({ valid: true });
  });

  it("edits the exact Product while preserving creation audit and unrelated business fields", async () => {
    const db = new MemoryDb();
    db.documents.set("products/PRODUCT_EDIT", { id: "PRODUCT_EDIT", productId: "PRODUCT_EDIT", name: "Before", sku: "SKU_KEEP", code: "CODE_KEEP", price: 19, stock: 20, customBusiness: "keep", isActive: true, active: true, ...AUDIT });
    const result = await executeProductMutation("ACTOR_EDITOR", actor, command("edit", "PRODUCT_EDIT", { name: "After", isActive: false, productId: "CLIENT_ID", createdAt: "CLIENT_TIME", createdBy: "CLIENT_ACTOR" }), db as never, dependencies());
    expect(result.status).toBe("UPDATED");
    expect(result.product).toMatchObject({ productId: "PRODUCT_EDIT", name: "After", isActive: false, active: false, createdAt: CREATED, createdBy: "ACTOR_CREATOR", updatedAt: NOW, updatedBy: "ACTOR_EDITOR", customBusiness: "keep" });
    expect(db.writes).toHaveLength(1);
  });

  it("fails closed for create conflicts, missing edits, malformed legacy records, and invalid clocks", async () => {
    for (const setup of ["conflict", "missing", "legacy", "clock"] as const) {
      const db = new MemoryDb(); const operation = setup === "conflict" ? "create" : "edit"; const input = command(operation);
      if (setup === "conflict") db.documents.set("products/PRODUCT_ALPHA", { productId: "PRODUCT_ALPHA" });
      if (setup === "legacy" || setup === "clock") db.documents.set("products/PRODUCT_ALPHA", { productId: "PRODUCT_ALPHA", active: setup === "legacy" ? "invalid" : true, ...AUDIT });
      await expect(executeProductMutation("ACTOR_SERVER", actor, input, db as never, dependencies(allow, setup === "clock" ? () => "invalid" : () => NOW))).rejects.toBeInstanceOf(ProductPersistenceError);
      expect(db.writes).toEqual([]);
    }
  });

  it("enforces injected canonical permission and scope decisions before mutation", async () => {
    for (const code of ["PRODUCT_PERMISSION_DENIED", "PRODUCT_SCOPE_DENIED"]) {
      const db = new MemoryDb();
      const deny = vi.fn(async () => { throw new ProductPersistenceError(code, 403); });
      await expect(executeProductMutation("ACTOR_DENIED", actor, command("create"), db as never, dependencies(deny))).rejects.toMatchObject({ code });
      expect(deny).toHaveBeenCalledOnce();
      expect(db.reads).toEqual([]); expect(db.writes).toEqual([]);
    }
  });

  it("reuses the existing Products/create permission and active actor validation", async () => {
    const denied = new MemoryDb();
    denied.documents.set("rolePermissions/Admin", { create: false, edit: true });
    await expect(executeProductMutation("ACTOR_DENIED", actor, command("create"), denied as never, { clock: () => NOW })).rejects.toMatchObject({ code: "PRODUCT_PERMISSION_DENIED" });
    expect(denied.writes).toEqual([]);
    const inactive = new MemoryDb();
    await expect(executeProductMutation("ACTOR_INACTIVE", { ...actor, active: false }, command("create"), inactive as never, { clock: () => NOW })).rejects.toMatchObject({ code: "PRODUCT_ACTOR_INVALID" });
    expect(inactive.writes).toEqual([]);
  });

  it("retries transaction conflicts without leaking the first attempt", async () => {
    const db = new MemoryDb(); db.failFirstAttempt = true;
    await executeProductMutation("ACTOR_SERVER", actor, command("create"), db as never, dependencies());
    expect(db.reads).toEqual(["products/PRODUCT_ALPHA", "products/PRODUCT_ALPHA"]);
    expect(db.writes).toHaveLength(1);
  });

  it("never derives or falls back to another price field", async () => {
    const db = new MemoryDb();
    const result = await executeProductMutation("ACTOR_SERVER", actor, command("create", "PRODUCT_PRICE", { price: 0, unitPrice: 999 }), db as never, dependencies());
    expect(result.product).toMatchObject({ price: 0, unitPrice: 999 });
  });
});
