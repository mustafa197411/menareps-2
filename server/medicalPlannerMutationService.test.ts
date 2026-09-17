import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { configuredWorkingDaysBetween, marketDateForInstant, MedicalPlannerMutationError, parseMedicalPlannerMutationRequest, validateMedicalPlannerProposal } from "./medicalPlannerMutationService";
import type { MarketBusinessSettings, BusinessCalendarException } from "../src/lib/marketSettings";

const market = (overrides: Partial<MarketBusinessSettings> = {}): MarketBusinessSettings => ({
  marketId: "M-ARBITRARY", countryId: "COUNTRY-X", countryNameEn: "Synthetic", countryNameAr: "اختبار", active: true,
  currencyCode: "AAA", currencySymbol: "A", symbolPosition: "AFTER", decimalPlaces: 2, numeralLocale: "en",
  timezone: "Pacific/Kiritimati", dateFormat: "YYYY-MM-DD", timeFormat: "24H", weekStartDay: 1,
  workingWeekdays: [1, 2, 3, 4, 5], normalWorkdayStart: "08:00", normalWorkdayEnd: "16:00", checkInOpensAt: "07:30",
  lateToleranceMinutes: 10, autoCheckoutAt: "18:00", maximumWorkdayMinutes: 480, ...overrides,
});
const exception = (date: string, type: BusinessCalendarException["type"]): BusinessCalendarException => ({ id: `${date}-${type}`, marketId: "M-ARBITRARY", countryId: "COUNTRY-X", date, type, active: true, nameEn: "Synthetic", nameAr: "اختبار", createdAt: "", createdBy: "", updatedAt: "", updatedBy: "" });
const base = (overrides: Record<string, any> = {}) => ({
  actorUid: "ACTOR-X", actorRole: "Medical Representative", actorSubjectUids: ["REP-X"],
  targetRep: { id: "REP-X", role: "Medical Representative", active: true }, targetAreaIds: ["AREA-X"],
  targetProductAssignments: [{ assignmentId: "PA-X", userId: "REP-X", productId: "PRODUCT-X", productGroupId: "GROUP-X", status: "Active", active: true }],
  products: [{ id: "PRODUCT-X", promotionGroupId: "GROUP-X", active: true }],
  physician: { id: "PHYSICIAN-X", areaId: "AREA-X", primaryPromotionGroupId: "GROUP-X", targetPromotionGroupIds: [], active: true, classification: "A", targetFrequency: 4 },
  area: { id: "AREA-X", countryId: "COUNTRY-X", districtId: "DISTRICT-X", cityId: "CITY-X", active: true },
  district: { id: "DISTRICT-X", countryId: "COUNTRY-X", active: true }, city: { id: "CITY-X", countryId: "COUNTRY-X", districtId: "DISTRICT-X", active: true }, country: { id: "COUNTRY-X", active: true },
  markets: [market()], exceptions: [], existingVisits: [], mode: "MANUAL" as const, now: "2026-01-01T00:00:00Z",
  proposal: { id: "PLAN-X", repId: "REP-X", physicianId: "PHYSICIAN-X", date: "2026-02-16", time: "09:00", planningType: "monthly" as const, week: "2026-W08", month: "2026-02" }, ...overrides,
});
const code = (fn: () => unknown) => { try { fn(); return "PASS"; } catch (error) { return (error as MedicalPlannerMutationError).code; } };

describe("WP80 authoritative medical planner policy", () => {
  it("resolves an arbitrary persisted market not present in bundled defaults", () => expect(validateMedicalPlannerProposal(base()).market.marketId).toBe("M-ARBITRARY"));
  it("manual and auto proposals use the identical validator", () => expect(validateMedicalPlannerProposal(base({ mode: "AUTO" })).market.marketId).toBe("M-ARBITRARY"));
  it("rejects an out-of-scope physician", () => expect(code(() => validateMedicalPlannerProposal(base({ targetAreaIds: ["AREA-Y"] })))).toBe("PLANNER_CANONICAL_GEOGRAPHY_INVALID"));
  it("rejects Product/Promotion mismatch", () => expect(code(() => validateMedicalPlannerProposal(base({ targetProductAssignments: [] })))).toBe("PLANNER_PHYSICIAN_OUTSIDE_SCOPE"));
  it("rejects inactive physicians", () => expect(code(() => validateMedicalPlannerProposal(base({ physician: { ...base().physician, active: false } })))).toBe("PLANNER_PHYSICIAN_INACTIVE_OR_INVALID"));
  it("rejects invalid ancestry", () => expect(code(() => validateMedicalPlannerProposal(base({ city: { ...base().city, districtId: "OTHER" } })))).toBe("PLANNER_CANONICAL_GEOGRAPHY_INVALID"));
  it("rejects missing and ambiguous markets", () => { expect(code(() => validateMedicalPlannerProposal(base({ markets: [] })))).toBe("PLANNER_MARKET_CONFIGURATION_REQUIRED"); expect(code(() => validateMedicalPlannerProposal(base({ markets: [market(), market({ marketId: "M-2" })] })))).toBe("PLANNER_MARKET_CONFIGURATION_AMBIGUOUS"); });
  it("uses an arbitrary configured working week", () => expect(code(() => validateMedicalPlannerProposal(base({ markets: [market({ workingWeekdays: [2] })] })))).toBe("PLANNER_NON_WORKING_DAY"));
  it("honors an exceptional working day", () => expect(validateMedicalPlannerProposal(base({ proposal: { ...base().proposal, date: "2026-02-15" }, exceptions: [exception("2026-02-15", "EXCEPTIONAL_WORKING")] })).market.marketId).toBe("M-ARBITRARY"));
  it("honors a holiday", () => expect(code(() => validateMedicalPlannerProposal(base({ exceptions: [exception("2026-02-16", "PUBLIC")] })))).toBe("PLANNER_NON_WORKING_DAY"));
  it("counts configured working days and excludes a holiday inside the interval", () => { expect(configuredWorkingDaysBetween("2026-02-02", "2026-02-12", market(), [])).toBe(7); expect(configuredWorkingDaysBetween("2026-02-02", "2026-02-12", market(), [exception("2026-02-05", "PUBLIC")])).toBe(6); });
  it("uses market timezone at an instant boundary", () => expect(marketDateForInstant("2026-01-01T11:00:00Z", "Pacific/Kiritimati")).toBe("2026-01-02"));
  it("uses target frequency rather than class", () => expect(code(() => validateMedicalPlannerProposal(base({ physician: { ...base().physician, classification: "C", targetFrequency: 2 }, proposal: { ...base().proposal, date: "2026-02-11" }, existingVisits: [{ id: "OLD", repId: "REP-X", physicianId: "PHYSICIAN-X", date: "2026-02-01", time: "08:00", kind: "PLANNED", status: "PLANNED" }] })))).toBe("PASS"));
  it("does not require or enforce an exact weekly appointment time", () => { const value = base(); delete (value.proposal as any).time; expect(parseMedicalPlannerMutationRequest({ mode: "AUTO", proposal: value.proposal })).not.toBeNull(); expect(code(() => validateMedicalPlannerProposal(value))).toBe("PASS"); expect(code(() => validateMedicalPlannerProposal(base({ existingVisits: [{ id: "OTHER", repId: "REP-X", physicianId: "OTHER", date: "2026-02-16", time: "09:00" }] })))).toBe("PASS"); });
  it("removes the direct client-write bypass and protects the backend endpoint", () => { const planner = fs.readFileSync(new URL("../src/components/MedicalPlanner.tsx", import.meta.url), "utf8"); const rules = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"); const server = fs.readFileSync(new URL("../server.ts", import.meta.url), "utf8"); expect(planner).not.toContain('setDoc(doc(db, "medicalPlannerVisits"'); expect(rules).toMatch(/match \/medicalPlannerVisits[\s\S]*?allow create, update: if false/); expect(server).toContain('app.post("/api/medical-planner/mutate", requireFirebaseAuth'); });
  it("contains no bundled market, static calendar date, or array-order auto-selection authority", () => { const planner = fs.readFileSync(new URL("../src/components/MedicalPlanner.tsx", import.meta.url), "utf8"); expect(planner).not.toContain("CANONICAL_MARKET_DEFAULTS"); expect(planner).not.toContain("2026-06-29"); expect(planner).not.toContain("unplaced[i]"); expect(planner).not.toContain("slots = ["); });
  it("keeps action permission separate from operational data scope", () => { const service = fs.readFileSync(new URL("./medicalPlannerMutationService.ts", import.meta.url), "utf8"); expect(service).toContain('collection("rolePermissions")'); expect(service).toContain('canAccessView(actorData, "field-medical-planner"'); expect(service).toContain("permissions.create !== true"); });
});
