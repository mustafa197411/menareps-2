import type { Area, City, Country, District } from "../types";

const unique = (values: string[]): string[] => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
const active = (record: unknown): boolean => (record as { active?: boolean; isActive?: boolean; status?: string })?.active !== false
  && (record as { isActive?: boolean })?.isActive !== false
  && (record as { status?: string })?.status !== "Inactive";

export interface MultiAreaCascadeState {
  countryIds: string[];
  districtIds: string[];
  cityIds: string[];
  areaIds: string[];
}

export type CascadeLevel = "country" | "district" | "city" | "area";

export interface CascadeRemovalImpact {
  level: CascadeLevel;
  removedIds: string[];
  districtIds: string[];
  cityIds: string[];
  areaIds: string[];
}

export const selectionState = (selectedIds: string[], availableIds: string[]) => {
  const available = unique(availableIds);
  const selected = new Set(selectedIds);
  const selectedCount = available.filter(id => selected.has(id)).length;
  return { checked: available.length > 0 && selectedCount === available.length, indeterminate: selectedCount > 0 && selectedCount < available.length };
};

export const availableCountries = (countries: Country[]): Country[] =>
  countries.filter(active).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

export const districtsForCountries = (districts: District[], countryIds: string[]): District[] => {
  const parents = new Set(countryIds);
  return districts.filter(district => active(district) && parents.has(district.countryId))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
};

export const citiesForDistricts = (cities: City[], countryIds: string[], districtIds: string[]): City[] => {
  const countries = new Set(countryIds);
  const districtsSet = new Set(districtIds);
  return cities.filter(city => active(city) && countries.has(city.countryId) && districtsSet.has(city.districtId))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
};

export const areasForSelectedCities = (
  areas: Area[],
  countryIds: string[],
  districtIds: string[],
  cityIds: string[],
): Area[] => {
  const countries = new Set(countryIds);
  const districtsSet = new Set(districtIds);
  const citiesSet = new Set(cityIds);
  return areas.filter(area => active(area)
    && countries.has(area.countryId)
    && districtsSet.has(area.districtId)
    && citiesSet.has(area.cityId))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
};

export function hydrateMultiAreaCascade(areaIds: string[], areas: Area[]): MultiAreaCascadeState {
  const byId = new Map(areas.filter(active).map(area => [area.id, area]));
  const canonicalAreaIds = unique(areaIds).filter(areaId => byId.has(areaId));
  const assigned = canonicalAreaIds.map(areaId => byId.get(areaId)!);
  return {
    countryIds: unique(assigned.map(area => area.countryId)),
    districtIds: unique(assigned.map(area => area.districtId)),
    cityIds: unique(assigned.map(area => area.cityId)),
    areaIds: canonicalAreaIds,
  };
}

export function addCascadeSelections(
  state: MultiAreaCascadeState,
  level: "countryIds" | "districtIds" | "cityIds" | "areaIds",
  ids: string[],
): MultiAreaCascadeState {
  return { ...state, [level]: unique([...state[level], ...ids]) };
}

export function removalImpact(
  state: MultiAreaCascadeState,
  level: CascadeLevel,
  removedIds: string[],
  districts: District[],
  cities: City[],
  areas: Area[],
): CascadeRemovalImpact {
  const removed = new Set(removedIds);
  const districtIds = level === "country"
    ? state.districtIds.filter(id => removed.has(districts.find(item => item.id === id)?.countryId || ""))
    : level === "district" ? state.districtIds.filter(id => removed.has(id)) : [];
  const impactedDistricts = new Set(level === "country"
    ? districts.filter(item => removed.has(item.countryId)).map(item => item.id)
    : level === "district" ? removedIds : []);
  const cityIds = level === "city"
    ? state.cityIds.filter(id => removed.has(id))
    : state.cityIds.filter(id => impactedDistricts.has(cities.find(item => item.id === id)?.districtId || ""));
  const impactedCities = new Set(level === "city"
    ? removedIds
    : cities.filter(item => impactedDistricts.has(item.districtId)).map(item => item.id));
  const areaIds = level === "area" ? state.areaIds.filter(id => removed.has(id)) : state.areaIds.filter(id => impactedCities.has(areas.find(item => item.id === id)?.cityId || ""));
  return { level, removedIds: unique(removedIds), districtIds: unique(districtIds), cityIds: unique(cityIds), areaIds: unique(areaIds) };
}

export function applyCascadeRemoval(state: MultiAreaCascadeState, impact: CascadeRemovalImpact): MultiAreaCascadeState {
  const removed = (ids: string[], values: string[]) => {
    const set = new Set(values);
    return ids.filter(id => !set.has(id));
  };
  return {
    countryIds: impact.level === "country" ? removed(state.countryIds, impact.removedIds) : state.countryIds,
    districtIds: removed(state.districtIds, impact.districtIds),
    cityIds: removed(state.cityIds, impact.cityIds),
    areaIds: removed(state.areaIds, impact.areaIds),
  };
}

export function toggleCascadeArea(state: MultiAreaCascadeState, areaId: string, selected: boolean, areas: Area[]): MultiAreaCascadeState {
  if (!selected) return { ...state, areaIds: state.areaIds.filter(id => id !== areaId) };
  const allowed = areasForSelectedCities(areas, state.countryIds, state.districtIds, state.cityIds).some(area => area.id === areaId);
  return allowed ? addCascadeSelections(state, "areaIds", [areaId]) : state;
}
