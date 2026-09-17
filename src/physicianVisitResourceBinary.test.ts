import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Physician Visit resource binary integration", () => {
  const source = fs.readFileSync("src/components/PhysicianVisit.tsx", "utf8");

  it("resolves resources through a trusted visit context and renders the resolved URL", () => {
    expect(source).toContain("resolveResourceBinary({ ...activeBrochure");
    expect(source).toContain('purpose: "PHYSICIAN_VISIT"');
    expect(source).toContain("src={resolvedUrl}");
    expect(source).toContain("binaryLoading");
    expect(source).toContain("binaryError");
  });

  it("records presentation through viewer readiness rather than click handlers", () => {
    expect(source).toContain("onReady={() => recordPresentedMaterial(");
    expect(source.match(/recordPresentedMaterial\(/g)).toHaveLength(1);
    expect(source).toContain("onCanPlay={() => presentationReadyRef.current()}");
    expect(source).toContain("onReady={() => presentationReadyRef.current()}");
    expect(source).not.toContain("resolveResourceBinaryForPresentation");
  });

  it("leaves canonical Product and Promotion Group eligibility filtering in place", () => {
    expect(source).toContain("filterMaterialsForAuthorizedProducts(academicResources, authorizedVisitProductIds, physicianVisitProducts)");
    expect(source).toContain("filterMaterialsForProduct(authorizedVisitAcademicResources");
  });
});
