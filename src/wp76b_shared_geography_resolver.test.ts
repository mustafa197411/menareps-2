import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { isCanonical, resolveGeographyTuple, type GeographyRegistries } from "./utils/importNormalization";

const base: GeographyRegistries = {
  countries: [{ id: "C-LIB-1999", name: "LIBYA" }],
  districts: [{ id: "D-679247", name: "WEST", countryId: "C-LIB-1999" }],
  cities: [{ id: "CT-694383", name: "TRIPOLI", countryId: "C-LIB-1999", districtId: "D-679247" }],
  areas: [{ id: "A-713066", name: "TEST", countryId: "C-LIB-1999", districtId: "D-679247", cityId: "CT-694383" }],
};

const resolveTest = (registries = base) => resolveGeographyTuple("LIBYA", "WEST", "TRIPOLI", "TEST", registries);

describe("WP76B shared canonical geography resolver", () => {
  it("resolves the live TEST hierarchy to its exact canonical IDs", () => {
    expect(resolveTest()).toMatchObject({
      isValid: true,
      countryId: "C-LIB-1999",
      districtId: "D-679247",
      cityId: "CT-694383",
      areaId: "A-713066",
      countryName: "LIBYA",
      districtName: "WEST",
      cityName: "TRIPOLI",
      areaName: "TEST",
    });
  });

  it("does not interpret A- or other document ID prefixes as legacy", () => {
    expect(isCanonical(base.areas[0])).toBe(true);
    expect(fs.readFileSync(new URL("./utils/importNormalization.ts", import.meta.url), "utf8")).not.toContain('startsWith("A-")');
  });

  it("produces identical IDs for manual and import callers", () => {
    const manual = resolveTest();
    const imported = resolveGeographyTuple("libya", "west", "tripoli", "test", base);
    expect([manual.countryId, manual.districtId, manual.cityId, manual.areaId]).toEqual([
      imported.countryId, imported.districtId, imported.cityId, imported.areaId,
    ]);
  });

  it("selects the unique valid record over an explicitly deleted legacy duplicate", () => {
    const result = resolveTest({ ...base, areas: [...base.areas, { ...base.areas[0], id: "LEGACY-TEST", isDeleted: true, status: "Legacy" }] });
    expect(result).toMatchObject({ isValid: true, areaId: "A-713066" });
  });

  it("rejects genuinely ambiguous active correctly-parented Areas", () => {
    const result = resolveTest({ ...base, areas: [...base.areas, { ...base.areas[0], id: "A-SECOND" }] });
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("Multiple active Area records");
  });

  it("rejects an unknown Area", () => {
    expect(resolveGeographyTuple("LIBYA", "WEST", "TRIPOLI", "UNKNOWN", base)).toMatchObject({ isValid: false });
  });

  it("rejects wrong parent relationships at Country, District, and City boundaries", () => {
    expect(resolveGeographyTuple("JORDAN", "WEST", "TRIPOLI", "TEST", base).isValid).toBe(false);
    expect(resolveGeographyTuple("LIBYA", "EAST", "TRIPOLI", "TEST", base).isValid).toBe(false);
    expect(resolveGeographyTuple("LIBYA", "WEST", "BENGHAZI", "TEST", base).isValid).toBe(false);
    expect(resolveTest({ ...base, areas: [{ ...base.areas[0], cityId: "CT-OTHER" }] }).isValid).toBe(false);
  });

  it("normalizes import payload geography into ID fields rather than labels", () => {
    const result = resolveTest();
    const payload = { countryId: result.countryId, districtId: result.districtId, cityId: result.cityId, areaId: result.areaId };
    expect(payload).toEqual({ countryId: "C-LIB-1999", districtId: "D-679247", cityId: "CT-694383", areaId: "A-713066" });
    expect(payload.areaId).not.toBe(result.areaName);
  });

  it("uses the same shared resolver in import and both manual creation paths", () => {
    for (const path of ["./components/ImportModule.tsx", "./components/PharmacyList.tsx", "./components/pharmacies/AddPharmacyForm.tsx"]) {
      expect(fs.readFileSync(new URL(path, import.meta.url), "utf8")).toContain("resolveGeographyTuple(");
    }
  });
});
