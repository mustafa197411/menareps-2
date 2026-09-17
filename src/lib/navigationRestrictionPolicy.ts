import {
  APPLICATION_MODULES,
  CANONICAL_VIEW_ALIASES,
  type ApplicationModuleId,
} from "./canonicalRoleAccessBaseline";
import { SIDEBAR_COMPATIBILITY_VIEW_IDS, SIDEBAR_NAVIGATION_REGISTRY, sidebarNavigationRegistryForRole } from "./sidebarNavigationRegistry";

export interface NavigationRestrictions {
  hiddenModules: ApplicationModuleId[];
  hiddenViews: string[];
}

export const EMPTY_NAVIGATION_RESTRICTIONS: NavigationRestrictions = Object.freeze({
  hiddenModules: [],
  hiddenViews: [],
});

const EXACT_SIDEBAR_VIEW_IDS = new Set([
  ...SIDEBAR_NAVIGATION_REGISTRY.flatMap(group => (group.children || []).map(child => child.id)),
  ...sidebarNavigationRegistryForRole("Finance Officer").flatMap(group => (group.children || []).map(child => child.id)),
  ...SIDEBAR_COMPATIBILITY_VIEW_IDS,
]);

export function isCanonicalApplicationModule(value: unknown): value is ApplicationModuleId {
  return typeof value === "string" && (APPLICATION_MODULES as readonly string[]).includes(value);
}

export function canonicalViewId(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const viewId = value.trim();
  const alias = CANONICAL_VIEW_ALIASES[viewId as keyof typeof CANONICAL_VIEW_ALIASES];
  const canonical = alias || viewId;
  return EXACT_SIDEBAR_VIEW_IDS.has(canonical) ? canonical : null;
}

export function normalizeNavigationRestrictions(value: unknown): NavigationRestrictions {
  if (!value || typeof value !== "object") return { hiddenModules: [], hiddenViews: [] };
  const candidate = value as { hiddenModules?: unknown; hiddenViews?: unknown };
  const hiddenModules = Array.isArray(candidate.hiddenModules)
    ? [...new Set(candidate.hiddenModules.filter(isCanonicalApplicationModule))]
    : [];
  const hiddenViews = Array.isArray(candidate.hiddenViews)
    ? [...new Set(candidate.hiddenViews.map(canonicalViewId).filter((item): item is string => item !== null))]
    : [];
  return { hiddenModules, hiddenViews };
}

export function validateNavigationRestrictions(value: unknown): NavigationRestrictions | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { hiddenModules?: unknown; hiddenViews?: unknown };
  if (!Array.isArray(candidate.hiddenModules) || !Array.isArray(candidate.hiddenViews)) return null;
  if (!candidate.hiddenModules.every(isCanonicalApplicationModule)) return null;
  if (!candidate.hiddenViews.every(item => canonicalViewId(item) === item)) return null;
  return normalizeNavigationRestrictions(candidate);
}

export function isNavigationRestricted(
  restrictions: NavigationRestrictions | null | undefined,
  module: ApplicationModuleId,
  viewId?: string,
): boolean {
  const normalized = normalizeNavigationRestrictions(restrictions);
  if (normalized.hiddenModules.includes(module)) return true;
  const canonical = viewId ? canonicalViewId(viewId) : null;
  return canonical ? normalized.hiddenViews.includes(canonical) : false;
}
