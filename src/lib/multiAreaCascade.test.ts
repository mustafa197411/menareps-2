import { describe, expect, it } from "vitest";
import type { Area, City, Country, District } from "../types";
import {
  addCascadeSelections, applyCascadeRemoval, areasForSelectedCities, availableCountries,
  citiesForDistricts, districtsForCountries, hydrateMultiAreaCascade, removalImpact,
  selectionState, toggleCascadeArea, type MultiAreaCascadeState,
} from "./multiAreaCascade";

const countries: Country[] = [{ id: "libya", name: "Libya" }, { id: "tunisia", name: "Tunisia" }, { id: "off", name: "Off", active: false } as Country];
const districts: District[] = [
  { id: "west", name: "West", countryId: "libya", countryName: "Libya" },
  { id: "east", name: "East", countryId: "libya", countryName: "Libya" },
  { id: "north", name: "North", countryId: "tunisia", countryName: "Tunisia" },
];
const cities: City[] = [
  { id: "tripoli", name: "Tripoli", countryId: "libya", countryName: "Libya", districtId: "west", districtName: "West" },
  { id: "benghazi", name: "Benghazi", countryId: "libya", countryName: "Libya", districtId: "east", districtName: "East" },
  { id: "tunis", name: "Tunis", countryId: "tunisia", countryName: "Tunisia", districtId: "north", districtName: "North" },
];
const areas: Area[] = [
  { id: "a", name: "Area A", cityId: "tripoli", cityName: "Tripoli", districtId: "west", districtName: "West", countryId: "libya", countryName: "Libya" },
  { id: "b", name: "Area B", cityId: "benghazi", cityName: "Benghazi", districtId: "east", districtName: "East", countryId: "libya", countryName: "Libya" },
  { id: "c", name: "Area C", cityId: "tunis", cityName: "Tunis", districtId: "north", districtName: "North", countryId: "tunisia", countryName: "Tunisia" },
  { id: "off", name: "Inactive", cityId: "tripoli", cityName: "Tripoli", districtId: "west", districtName: "West", countryId: "libya", countryName: "Libya", active: false },
];
const full = (): MultiAreaCascadeState => ({ countryIds: ["libya", "tunisia"], districtIds: ["east", "north", "west"], cityIds: ["benghazi", "tripoli", "tunis"], areaIds: ["a", "b", "c"] });

describe("User Management unified direct geography cascade", () => {
  it("filters active countries and unions districts deterministically", () => {
    expect(availableCountries(countries).map(item => item.id)).toEqual(["libya", "tunisia"]);
    expect(districtsForCountries(districts, ["libya"]).map(item => item.id)).toEqual(["east", "west"]);
  });
  it("unions cities across countries and districts", () => expect(citiesForDistricts(cities, ["libya", "tunisia"], ["west", "north"]).map(item => item.id)).toEqual(["tripoli", "tunis"]));
  it("unions Areas through complete selected ancestry and excludes inactive Areas", () => expect(areasForSelectedCities(areas, ["libya", "tunisia"], ["west", "north"], ["tripoli", "tunis"]).map(item => item.id)).toEqual(["a", "c"]));
  it("hydrates exact canonical Areas across multiple countries", () => expect(hydrateMultiAreaCascade(["c", "a", "b", "a"], areas)).toEqual(full()));
  it("Select All adds deterministically without duplicates", () => expect(addCascadeSelections({ ...full(), areaIds: ["a"] }, "areaIds", ["a", "b", "c"]).areaIds).toEqual(["a", "b", "c"]));
  it("reports checked and indeterminate Select All state", () => {
    expect(selectionState(["a", "b"], ["a", "b"])).toEqual({ checked: true, indeterminate: false });
    expect(selectionState(["a"], ["a", "b"])).toEqual({ checked: false, indeterminate: true });
  });
  it("rejects an Area outside selected ancestry", () => expect(toggleCascadeArea({ ...full(), countryIds: ["libya"], districtIds: ["west"], cityIds: ["tripoli"], areaIds: [] }, "c", true, areas).areaIds).toEqual([]));
  it("country removal identifies and removes only its descendants after confirmation", () => {
    const impact = removalImpact(full(), "country", ["tunisia"], districts, cities, areas);
    expect(impact).toMatchObject({ districtIds: ["north"], cityIds: ["tunis"], areaIds: ["c"] });
    expect(applyCascadeRemoval(full(), impact)).toEqual({ countryIds: ["libya"], districtIds: ["east", "west"], cityIds: ["benghazi", "tripoli"], areaIds: ["a", "b"] });
  });
  it("district and city removal preserve unrelated assignments", () => {
    expect(applyCascadeRemoval(full(), removalImpact(full(), "district", ["east"], districts, cities, areas)).areaIds).toEqual(["a", "c"]);
    expect(applyCascadeRemoval(full(), removalImpact(full(), "city", ["tripoli"], districts, cities, areas)).areaIds).toEqual(["b", "c"]);
  });
  it("a future Area is not assigned by prior Select All persistence", () => expect(hydrateMultiAreaCascade(["a"], [...areas, { ...areas[0], id: "new" }]).areaIds).toEqual(["a"]));
});
