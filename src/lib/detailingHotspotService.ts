import { Role } from "../types";
import { createManagedResourceHotspot, deactivateManagedResourceHotspot, discoverManagedResourceHotspots, fetchActiveResourceHotspots, updateManagedResourceHotspot, type ResourceReadContext } from "./resourceReadClient";

export type HotspotType =
  | "KEY_MESSAGE"
  | "PRODUCT_CLAIM"
  | "PRODUCT_FEATURE"
  | "CLINICAL_EVIDENCE"
  | "SAFETY_INFORMATION"
  | "DOSAGE_INFORMATION"
  | "PRODUCT_IMAGE"
  | "NAVIGATION"
  | "GENERAL_CONTENT";

export const ALLOWED_HOTSPOT_TYPES: HotspotType[] = [
  "KEY_MESSAGE",
  "PRODUCT_CLAIM",
  "PRODUCT_FEATURE",
  "CLINICAL_EVIDENCE",
  "SAFETY_INFORMATION",
  "DOSAGE_INFORMATION",
  "PRODUCT_IMAGE",
  "NAVIGATION",
  "GENERAL_CONTENT",
];

export const AUTHORIZED_HOTSPOT_ROLES: string[] = [
  Role.SUPER_ADMIN,
  Role.ADMIN,
  Role.PRODUCT_MANAGER,
  Role.MARKETING_MANAGER,
];

export interface HotspotDefinition {
  hotspotId: string;
  materialId: string;
  materialName?: string;
  productId: string;
  promotionGroupId: string;
  resourceVersion?: number;
  pageNumber: number;
  hotspotName: string;
  hotspotType: HotspotType;
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
  linkedKeyMessageId?: string;
  linkedClaimId?: string;
  linkedProductId?: string;
  description?: string;
  active: boolean;
  version: number;
  createdByUid: string;
  createdAt: any;
  updatedByUid: string;
  updatedAt: any;
}

export interface CreateHotspotInput {
  materialId: string;
  materialName?: string;
  productId: string;
  promotionGroupId: string;
  pageNumber: number;
  hotspotName: string;
  hotspotType: HotspotType;
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
  linkedKeyMessageId?: string;
  linkedClaimId?: string;
  linkedProductId?: string;
  description?: string;
  active?: boolean;
}

export interface UpdateHotspotInput {
  materialName?: string;
  productId?: string;
  promotionGroupId?: string;
  pageNumber?: number;
  hotspotName?: string;
  hotspotType?: HotspotType;
  xPercent?: number;
  yPercent?: number;
  widthPercent?: number;
  heightPercent?: number;
  linkedKeyMessageId?: string;
  linkedClaimId?: string;
  linkedProductId?: string;
  description?: string;
  active?: boolean;
}

/**
 * Normalizes a hotspot name by trimming whitespace and lowercasing.
 */
export function normalizeHotspotName(name: string): string {
  return (name || "").trim().toLowerCase();
}

/**
 * Validates hotspot coordinates to ensure they stay strictly within 0-100 percentage bounds.
 */
export function validateHotspotCoordinates(
  xPercent: number,
  yPercent: number,
  widthPercent: number,
  heightPercent: number
): { valid: boolean; reason?: string } {
  if (typeof xPercent !== "number" || isNaN(xPercent) || xPercent < 0 || xPercent > 100) {
    return { valid: false, reason: "xPercent must be a number between 0 and 100." };
  }
  if (typeof yPercent !== "number" || isNaN(yPercent) || yPercent < 0 || yPercent > 100) {
    return { valid: false, reason: "yPercent must be a number between 0 and 100." };
  }
  if (typeof widthPercent !== "number" || isNaN(widthPercent) || widthPercent <= 0 || widthPercent > 100) {
    return { valid: false, reason: "widthPercent must be a number greater than 0 and up to 100." };
  }
  if (typeof heightPercent !== "number" || isNaN(heightPercent) || heightPercent <= 0 || heightPercent > 100) {
    return { valid: false, reason: "heightPercent must be a number greater than 0 and up to 100." };
  }
  if (xPercent + widthPercent > 100) {
    return { valid: false, reason: `xPercent (${xPercent}) + widthPercent (${widthPercent}) exceeds 100%.` };
  }
  if (yPercent + heightPercent > 100) {
    return { valid: false, reason: `yPercent (${yPercent}) + heightPercent (${heightPercent}) exceeds 100%.` };
  }
  return { valid: true };
}

/**
 * Detects whether target hotspot rectangle overlaps with any existing active hotspots.
 * Overlap is warning/non-blocking, returning any overlapping hotspot definitions.
 */
export function detectHotspotOverlap(
  targetRect: { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number },
  existingHotspots: HotspotDefinition[],
  excludeHotspotId?: string
): HotspotDefinition[] {
  const overlapping: HotspotDefinition[] = [];

  const r1Left = targetRect.xPercent;
  const r1Right = targetRect.xPercent + targetRect.widthPercent;
  const r1Top = targetRect.yPercent;
  const r1Bottom = targetRect.yPercent + targetRect.heightPercent;

  for (const hotspot of existingHotspots) {
    if (!hotspot.active) continue;
    if (excludeHotspotId && hotspot.hotspotId === excludeHotspotId) continue;

    const r2Left = hotspot.xPercent;
    const r2Right = hotspot.xPercent + hotspot.widthPercent;
    const r2Top = hotspot.yPercent;
    const r2Bottom = hotspot.yPercent + hotspot.heightPercent;

    const noOverlap = r1Right <= r2Left || r1Left >= r2Right || r1Bottom <= r2Top || r1Top >= r2Bottom;
    if (!noOverlap) {
      overlapping.push(hotspot);
    }
  }

  return overlapping;
}

/**
 * Checks whether a given user role is authorized to manage hotspot definitions.
 */
export function canManageHotspots(userRole?: Role | string): boolean {
  if (!userRole) return false;
  return AUTHORIZED_HOTSPOT_ROLES.includes(userRole);
}

/**
 * Creates a new brochure hotspot definition.
 */
export async function createHotspotDefinition(
  input: CreateHotspotInput,
  currentUserRole?: Role | string
): Promise<HotspotDefinition> {
  if (currentUserRole && !canManageHotspots(currentUserRole)) {
    throw new Error(`Role "${currentUserRole}" is not authorized to create hotspot definitions.`);
  }

  if (!input.materialId?.trim()) {
    throw new Error("materialId is required.");
  }
  if (!input.productId?.trim()) {
    throw new Error("productId is required.");
  }
  if (!input.promotionGroupId?.trim()) {
    throw new Error("promotionGroupId is required.");
  }
  if (!input.pageNumber || input.pageNumber < 1) {
    throw new Error("pageNumber must be a positive integer.");
  }
  if (!input.hotspotName?.trim()) {
    throw new Error("hotspotName cannot be empty.");
  }
  if (!ALLOWED_HOTSPOT_TYPES.includes(input.hotspotType)) {
    throw new Error(`Unsupported hotspotType "${input.hotspotType}".`);
  }

  const coordCheck = validateHotspotCoordinates(
    input.xPercent,
    input.yPercent,
    input.widthPercent,
    input.heightPercent
  );
  if (!coordCheck.valid) {
    throw new Error(`Invalid hotspot coordinates: ${coordCheck.reason}`);
  }

  const { hotspot } = await createManagedResourceHotspot(input.materialId.trim(), input as unknown as Record<string, unknown>);
  return hotspot as HotspotDefinition;
}

/**
 * Updates an existing brochure hotspot definition.
 */
export async function updateHotspotDefinition(
  materialId: string,
  hotspotId: string,
  input: UpdateHotspotInput,
  currentUserRole?: Role | string
): Promise<HotspotDefinition> {
  if (currentUserRole && !canManageHotspots(currentUserRole)) {
    throw new Error(`Role "${currentUserRole}" is not authorized to update hotspot definitions.`);
  }

  const existingData = (await discoverManagedResourceHotspots(materialId)).hotspots.find(row => row.hotspotId === hotspotId) as HotspotDefinition;
  if (!existingData) throw new Error(`Hotspot definition ${hotspotId} not found.`);

  const updatedPageNumber = input.pageNumber ?? existingData.pageNumber;
  if (updatedPageNumber < 1) {
    throw new Error("pageNumber must be a positive integer.");
  }

  const updatedName = input.hotspotName !== undefined ? input.hotspotName.trim() : existingData.hotspotName;
  if (!updatedName) {
    throw new Error("hotspotName cannot be empty.");
  }

  const updatedType = input.hotspotType ?? existingData.hotspotType;
  if (!ALLOWED_HOTSPOT_TYPES.includes(updatedType)) {
    throw new Error(`Unsupported hotspotType "${updatedType}".`);
  }

  const updatedX = input.xPercent ?? existingData.xPercent;
  const updatedY = input.yPercent ?? existingData.yPercent;
  const updatedW = input.widthPercent ?? existingData.widthPercent;
  const updatedH = input.heightPercent ?? existingData.heightPercent;

  const coordCheck = validateHotspotCoordinates(updatedX, updatedY, updatedW, updatedH);
  if (!coordCheck.valid) {
    throw new Error(`Invalid hotspot coordinates: ${coordCheck.reason}`);
  }

  const updatePayload = {
    productId: input.productId ?? existingData.productId,
    ...(input.materialName !== undefined && { materialName: input.materialName.trim() }),
    pageNumber: updatedPageNumber,
    hotspotName: updatedName,
    hotspotType: updatedType,
    xPercent: updatedX,
    yPercent: updatedY,
    widthPercent: updatedW,
    heightPercent: updatedH,
    ...(input.linkedKeyMessageId !== undefined && { linkedKeyMessageId: input.linkedKeyMessageId.trim() }),
    ...(input.description !== undefined && { description: input.description.trim() }),
  };
  return (await updateManagedResourceHotspot(existingData.materialId, hotspotId, updatePayload)).hotspot as HotspotDefinition;
}

/**
 * Deactivates (soft-deletes) a hotspot definition by setting active = false and incrementing version.
 */
export async function deactivateHotspotDefinition(
  materialId: string,
  hotspotId: string,
  currentUserRole?: Role | string
): Promise<void> {
  if (currentUserRole && !canManageHotspots(currentUserRole)) {
    throw new Error(`Role "${currentUserRole}" is not authorized to deactivate hotspot definitions.`);
  }

  await deactivateManagedResourceHotspot(materialId, hotspotId);
}

export async function getManagedHotspotsForMaterial(materialId: string): Promise<HotspotDefinition[]> {
  return (await discoverManagedResourceHotspots(materialId)).hotspots as HotspotDefinition[];
}

/**
 * Fetches all hotspots for a specific material and page number.
 */
export async function getHotspotsForMaterialPage(
  materialId: string,
  pageNumber: number,
  _includeInactive: boolean = false,
  context: ResourceReadContext = { purpose: "MANAGEMENT" },
): Promise<HotspotDefinition[]> {
  try {
    return (await fetchActiveResourceHotspots(materialId, context, pageNumber)).hotspots as HotspotDefinition[];
  } catch (error) {
    console.warn(`[detailingHotspotService] Failed to query hotspots for material ${materialId} page ${pageNumber}:`, error);
    return [];
  }
}

/**
 * Fetches all active hotspots for a material across all pages.
 */
export async function getActiveHotspotsForMaterial(
  materialId: string,
  context: ResourceReadContext = { purpose: "MANAGEMENT" },
): Promise<HotspotDefinition[]> {
  try {
    return (await fetchActiveResourceHotspots(materialId, context)).hotspots as HotspotDefinition[];
  } catch (error) {
    console.warn(`[detailingHotspotService] Failed to query active hotspots for material ${materialId}:`, error);
    return [];
  }
}
