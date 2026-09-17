import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./components/products/ResourceCenter.tsx", import.meta.url), "utf8");

describe("Fix 3A Resource Center authoring UI", () => {
  it("loads only the authenticated Product Manager's canonical assignments without router changes", () => {
    expect(source).toContain('query(collection(db, "userProductAssignments"), where("userId", "==", currentUser.id))');
    expect(source).toContain("resolveResourceAuthoringProducts");
  });
  it("defaults Product Manager creation to selected Products", () => {
    expect(source).toContain("currentUser.role === Role.PRODUCT_MANAGER ? ResourceScope.SELECTED_PRODUCTS : ResourceScope.PROMOTION_GROUP");
  });
  it("disables group-wide Product Manager authoring with a clear ownership explanation", () => {
    expect(source).toContain("disabled={currentUser.role === Role.PRODUCT_MANAGER}");
    expect(source).toContain("Group-wide authoring requires explicit Promotion Group ownership");
  });
  it("keeps group-wide authoring available to other roles", () => {
    expect(source).not.toContain("disabled={canManage}");
    expect(source).toContain("value={ResourceScope.PROMOTION_GROUP}");
  });
  it("does not alter Resource listing/read filtering by Product assignment", () => {
    const listing = source.slice(source.indexOf("const filteredResources"), source.indexOf("return (", source.indexOf("const filteredResources")));
    expect(listing).not.toContain("ownProductAssignments");
    expect(listing).not.toContain("authoringProducts");
  });
});
