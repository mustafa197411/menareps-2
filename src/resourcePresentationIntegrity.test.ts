import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createPresentationReadyGate } from "./lib/resourcePresentationIntegrity";

describe("Fix 6 Resource presentation integrity", () => {
  const visit = fs.readFileSync("src/components/PhysicianVisit.tsx", "utf8");
  const controlled = fs.readFileSync("src/components/resources/ControlledResourcePage.tsx", "utf8");
  const center = fs.readFileSync("src/components/products/ResourceCenter.tsx", "utf8");

  it("records repeated renderer/media readiness events exactly once", () => {
    const presented = vi.fn(), ready = createPresentationReadyGate(presented);
    ready(); ready(); ready();
    expect(presented).toHaveBeenCalledTimes(1);
  });

  it("does not record presentation merely because binary retrieval succeeded", () => {
    const retrievalStart = visit.indexOf("void resolveResourceBinary({ ...activeBrochure");
    const retrievalSuccess = visit.indexOf(".then(resolved =>", retrievalStart);
    expect(retrievalStart).toBeGreaterThan(-1);
    expect(retrievalSuccess).toBeGreaterThan(retrievalStart);
    expect(visit.slice(retrievalStart, retrievalSuccess)).not.toContain("onReadyRef.current()");
  });

  it("gates PDF and image presentation on successful rendering/loading", () => {
    expect(controlled).toContain("if (page === 1) onReadyRef.current?.()");
    expect(controlled).toContain("onLoad={onReady}");
    expect(controlled).toContain('onError={() => setError("Unable to render this image.")}');
    expect(controlled).toContain('catch(reason => { if (!cancelled && reason?.name !== "RenderingCancelledException") setError("Unable to render this PDF page."); })');
  });

  it("gates video presentation on playable media and never on retrieval", () => {
    expect(visit).toContain("onCanPlay={() => presentationReadyRef.current()}");
    expect(visit).toContain('onError={() => setBinaryError("Unable to play this approved video.")}');
  });

  it("uses authenticated download-only handling for unsupported Office documents", () => {
    for (const source of [visit, center]) {
      expect(source).not.toContain("docs.google.com/gview");
      expect(source).not.toContain("Google Docs Viewer");
    }
    expect(visit).toContain("Downloading it does not record a presentation.");
    expect(visit).toContain("download={activeBrochure.originalFileName");
    expect(center).toContain("Browser preview is not available for this document format.");
  });

  it("keeps hotspot activation independent from presentation readiness", () => {
    const activation = visit.slice(visit.indexOf("const activateHotspot"), visit.indexOf("const isPdf"));
    expect(activation).toContain("recordResourceHotspotInteraction");
    expect(activation).not.toContain("presentationReadyRef");
    expect(activation).not.toContain("recordPresentedMaterial");
  });

  it("introduces no direct Resource collection, Storage, or durable URL access", () => {
    const changedProduction = [visit, controlled, center, fs.readFileSync("src/lib/resourceBinaryResolver.ts", "utf8")].join("\n");
    expect(changedProduction).not.toContain('collection(db, "academicResources")');
    expect(changedProduction).not.toMatch(/\bgetBlob\s*\(|\bgetBytes\s*\(|\bgetDownloadURL\s*\(/);
    expect(changedProduction).not.toContain("downloadUrl");
  });
});
