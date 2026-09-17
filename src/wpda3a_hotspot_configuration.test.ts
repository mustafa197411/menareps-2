import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), create: vi.fn(), update: vi.fn(), deactivate: vi.fn(), discover: vi.fn() }));
vi.mock("./lib/resourceReadClient", () => ({ fetchActiveResourceHotspots: mocks.fetch, createManagedResourceHotspot: mocks.create, updateManagedResourceHotspot: mocks.update, deactivateManagedResourceHotspot: mocks.deactivate, discoverManagedResourceHotspots: mocks.discover }));
import { ALLOWED_HOTSPOT_TYPES, canManageHotspots, createHotspotDefinition, deactivateHotspotDefinition, detectHotspotOverlap, getActiveHotspotsForMaterial, getHotspotsForMaterialPage, normalizeHotspotName, updateHotspotDefinition, validateHotspotCoordinates, type HotspotDefinition } from "./lib/detailingHotspotService";
import { Role } from "./types";

const hotspot: HotspotDefinition = { hotspotId: "H-1", materialId: "RES-1", productId: "P-1", promotionGroupId: "PG-1", resourceVersion: 2, pageNumber: 1, hotspotName: "Claim", hotspotType: "KEY_MESSAGE", xPercent: 10, yPercent: 10, widthPercent: 20, heightPercent: 20, active: true, version: 1, createdByUid: "U", createdAt: "TIME", updatedByUid: "U", updatedAt: "TIME" };

describe("WP-DA3A hotspot configuration foundation", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.fetch.mockResolvedValue({ hotspots: [] }); mocks.discover.mockResolvedValue({ hotspots: [], products: [], keyMessages: [], canCreate: true }); });
  it("normalizes names and validates bounded coordinates", () => {
    expect(normalizeHotspotName("  Safety Info ")).toBe("safety info");
    expect(validateHotspotCoordinates(0, 0, 100, 100).valid).toBe(true);
    expect(validateHotspotCoordinates(90, 1, 20, 10).valid).toBe(false);
    expect(validateHotspotCoordinates(1, 1, 0, 10).valid).toBe(false);
  });
  it("detects overlap while ignoring inactive and excluded definitions", () => {
    expect(detectHotspotOverlap({ xPercent: 15, yPercent: 15, widthPercent: 10, heightPercent: 10 }, [hotspot])).toHaveLength(1);
    expect(detectHotspotOverlap({ xPercent: 15, yPercent: 15, widthPercent: 10, heightPercent: 10 }, [{ ...hotspot, active: false }])).toHaveLength(0);
    expect(detectHotspotOverlap({ xPercent: 15, yPercent: 15, widthPercent: 10, heightPercent: 10 }, [hotspot], "H-1")).toHaveLength(0);
  });
  it("keeps the exact approved management-role ceiling", () => {
    for (const role of [Role.SUPER_ADMIN, Role.ADMIN, Role.PRODUCT_MANAGER, Role.MARKETING_MANAGER]) expect(canManageHotspots(role)).toBe(true);
    for (const role of [Role.MEDICAL_MANAGER, Role.SALES_MARKETING_MANAGER, Role.MEDICAL_REP, Role.SALES_REP]) expect(canManageHotspots(role)).toBe(false);
  });
  it("rejects unauthorized client wrappers before a backend request", async () => {
    await expect(createHotspotDefinition({ materialId: "RES-1", productId: "P-1", promotionGroupId: "PG-1", pageNumber: 1, hotspotName: "Claim", hotspotType: "KEY_MESSAGE", xPercent: 1, yPercent: 1, widthPercent: 10, heightPercent: 10 }, Role.MEDICAL_REP)).rejects.toThrow("not authorized");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("routes creation through the trusted backend", async () => {
    mocks.create.mockResolvedValue({ hotspot });
    expect(await createHotspotDefinition({ materialId: "RES-1", productId: "P-1", promotionGroupId: "forged-is-ignored-server-side", pageNumber: 1, hotspotName: "Claim", hotspotType: "KEY_MESSAGE", xPercent: 10, yPercent: 10, widthPercent: 20, heightPercent: 20 }, Role.PRODUCT_MANAGER)).toEqual(hotspot);
    expect(mocks.create).toHaveBeenCalledWith("RES-1", expect.objectContaining({ productId: "P-1" }));
  });
  it("routes update and deactivation through the trusted backend", async () => {
    mocks.discover.mockResolvedValue({ hotspots: [hotspot], products: [], keyMessages: [], canCreate: true });
    mocks.update.mockResolvedValue({ hotspot: { ...hotspot, hotspotName: "Updated", version: 2 } });
    expect(await updateHotspotDefinition("RES-1", "H-1", { hotspotName: "Updated" }, Role.ADMIN)).toMatchObject({ hotspotName: "Updated", version: 2 });
    await deactivateHotspotDefinition("RES-1", "H-1", Role.MARKETING_MANAGER);
    expect(mocks.deactivate).toHaveBeenCalledWith("RES-1", "H-1");
  });
  it("reads active definitions only through the Fix 4 endpoint", async () => {
    mocks.fetch.mockResolvedValue({ hotspots: [hotspot] });
    expect(await getHotspotsForMaterialPage("RES-1", 1)).toEqual([hotspot]);
    expect(await getActiveHotspotsForMaterial("RES-1")).toEqual([hotspot]);
    expect(mocks.fetch).toHaveBeenCalledWith("RES-1", { purpose: "MANAGEMENT" }, 1);
  });
  it("retains all supported controlled hotspot types", () => expect(ALLOWED_HOTSPOT_TYPES).toContain("CLINICAL_EVIDENCE"));
});
