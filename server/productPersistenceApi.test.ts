import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Product persistence API contract", () => {
  const source = fs.readFileSync(new URL("../server.ts", import.meta.url), "utf8");

  it("registers exactly one authenticated Product mutation route", () => {
    expect(source).toContain('app.post("/api/products/mutate", requireFirebaseAuth');
    expect(source.match(/app\.post\("\/api\/products\/mutate"/g)).toHaveLength(1);
    expect(source).toContain("executeProductMutation(authenticated.authUid!, authenticated.user, command");
    expect(source).toContain("executeProductMutationBatch(authenticated.authUid!, authenticated.user, batchCommands!");
    expect(source).toContain("executeProductMutationBatch(authenticated.authUid!, authenticated.user, batchCommands!");
  });

  it("routes Product imports through the bounded backend without changing import-mode decisions", () => {
    const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    const productBranch = app.slice(app.indexOf('module === "Products"'), app.indexOf('module === "Key Messages"'));
    expect(productBranch).toContain('importMode === "CREATE_NEW_ONLY" && existingProd');
    expect(productBranch).toContain('importMode === "UPDATE_EXISTING_ONLY" && !existingProd');
    expect(app).toContain('importMode: "UPSERT" | "CREATE_NEW_ONLY" | "UPDATE_EXISTING_ONLY" = "UPSERT"');
    expect(productBranch).toContain('const operation = existingProd ? "edit" : "create"');
    expect(productBranch).toContain("productCommands.push({ operation, productId: docId, product: prod })");
    expect(productBranch).toContain("await saveProductBatch(productCommands, currentUser.id)");
    expect(productBranch).not.toMatch(/batch\.set\(doc\(db, "products"/);
    expect(productBranch).not.toContain("importedAt: rec.importedAt");
    expect(productBranch).not.toContain("importedBy: rec.importedBy");
    expect(app).toContain('if (module !== "Products") await batch.commit()');
  });

  it("queues Product Add/Edit only after an explicitly retryable transport failure", () => {
    const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    const add = app.slice(app.indexOf("const handleAddProduct"), app.indexOf("const handleUpdateProduct"));
    const edit = app.slice(app.indexOf("const handleUpdateProduct"), app.indexOf("const handleDeleteProduct"));
    for (const handler of [add, edit]) {
      const fallback = handler.slice(handler.indexOf("catch (e: any)"));
      const guard = fallback.indexOf("if (!isRetryableProductPersistenceError(e)) throw e");
      expect(guard).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(fallback.indexOf("enqueueOfflineWrite"));
      expect(guard).toBeLessThan(fallback.indexOf("setProducts"));
    }
  });

  it("routes Product imports through the bounded backend without changing import-mode decisions", () => {
    const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    const productBranch = app.slice(app.indexOf('module === "Products"'), app.indexOf('module === "Key Messages"'));
    expect(productBranch).toContain('importMode === "CREATE_NEW_ONLY" && existingProd');
    expect(productBranch).toContain('importMode === "UPDATE_EXISTING_ONLY" && !existingProd');
    expect(productBranch).toContain("productCommands.push({ operation, productId: docId, product: prod })");
    expect(productBranch).toContain("await saveProductBatch(productCommands, currentUser.id)");
    expect(productBranch).not.toMatch(/batch\.set\(doc\(db, "products"/);
  });

  it("returns sanitized stable Product persistence codes", () => {
    expect(source).toContain('json({ code: "PRODUCT_REQUEST_INVALID" })');
    expect(source).toContain("json({ code: error.code })");
    expect(source).toContain('json({ code: "PRODUCT_WRITE_FAILED" })');
  });
});
