import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { canManageHotspots } from "./lib/detailingHotspotService";
import { Role } from "./types";

describe("Fix 5 hotspot UI and transport integration", () => {
  it("exposes hotspot management only to the approved roles", () => {
    for (const role of [Role.SUPER_ADMIN, Role.ADMIN, Role.MARKETING_MANAGER, Role.PRODUCT_MANAGER]) expect(canManageHotspots(role)).toBe(true);
    for (const role of [Role.MEDICAL_MANAGER, Role.SALES_MARKETING_MANAGER, Role.MEDICAL_REP]) expect(canManageHotspots(role)).toBe(false);
  });
  it("packages the PDF worker locally and does not use a CDN", () => {
    const source = fs.readFileSync("src/components/resources/ControlledResourcePage.tsx", "utf8");
    expect(source).toContain('pdf.worker.min.mjs?url');
    expect(source).toContain("GlobalWorkerOptions.workerSrc = workerUrl");
    expect(source).not.toMatch(/https?:\/\//);
  });
  it("uses controlled page state, percentage rectangles, and page-specific overlays", () => {
    const source = fs.readFileSync("src/components/resources/ControlledResourcePage.tsx", "utf8");
    expect(source).toContain("document.numPages");
    expect(source).toContain("item.pageNumber === page");
    expect(source).toContain("xPercent");
    expect(source).toContain("onRectangle");
  });
  it("keeps visit presentation and hotspot activation independent", () => {
    const source = fs.readFileSync("src/components/PhysicianVisit.tsx", "utf8");
    expect(source).toContain("recordResourceHotspotInteraction");
    expect(source).toContain("onHotspotActivate={activateHotspot}");
    expect(source).not.toMatch(/activateHotspot[\s\S]{0,500}recordPresentedMaterial/);
  });
  it("never uses direct Firestore for hotspot lifecycle or interactions", () => {
    const client = fs.readFileSync("src/lib/detailingHotspotService.ts", "utf8"), read = fs.readFileSync("src/lib/resourceReadClient.ts", "utf8");
    expect(client).not.toContain('from "firebase/firestore"');
    expect(read).toContain("/hotspots/manage/create");
    expect(read).toContain("/interactions");
  });
});
