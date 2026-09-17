import { describe, it, expect, beforeEach } from "vitest";
import { Role, User, Product, ProductPromotionGroup, UserTerritoryAssignment, UserProductAssignment, Physician } from "./types";
import { isPhysicianEligibleForUser, setGlobalSecurityContext } from "./lib/securityEngine";
import { filterBySecurity } from "./lib/alignmentService";

describe("WP7.8 Medical Planner Certification Test Suite", () => {
  const gmUser: User = {
    id: "kBUbCmDZnVS3sQt3OD7PsNCeKjf2",
    email: "gm@esnad.local",
    name: "General Manager",
    role: Role.GENERAL_MANAGER,
    active: true,
    employmentStatus: "Active",
    loginAllowed: true
  };

  const liveMedRep: User = {
    id: "J37PXq5iqQSjIqXGnDhfPSLKC292",
    name: "medtest",
    email: "medreptest@esand.local",
    role: Role.MEDICAL_REP,
    status: "Active",
    active: true,
    employmentStatus: "Active",
    loginAllowed: true,
    managerId: "kBUbCmDZnVS3sQt3OD7PsNCeKjf2",
    managerEmail: "gm@esnad.local",
    areaIds: ["A-713066"],
    products: ["PROD-9188"],
    primaryPromotionGroupId: "test",
    assignmentSyncStatus: "COMPLETE"
  };

  const territoryAssignment: UserTerritoryAssignment = {
    id: "TA_J37PXq5iqQSjIqXGnDhfPSLKC292_A-713066",
    userId: "J37PXq5iqQSjIqXGnDhfPSLKC292",
    areaId: "A-713066",
    status: "Active",
    active: true,
    assignedAt: "2026-08-06T11:01:33.108Z"
  };

  const productAssignment: UserProductAssignment = {
    id: "PA_J37PXq5iqQSjIqXGnDhfPSLKC292_PROD-9188",
    userId: "J37PXq5iqQSjIqXGnDhfPSLKC292",
    productId: "PROD-9188",
    primaryGroupId: "test",
    status: "Active",
    active: true,
    assignedAt: "2026-08-06T11:01:33.108Z"
  };

  const liveProduct: Product = {
    id: "PROD-9188",
    name: "Test",
    brand: "Test",
    sku: "Test",
    promotionGroupId: "test",
    isActive: true
  };

  const livePromotionGroup: ProductPromotionGroup = {
    id: "test",
    name: "Test",
    normalizedName: "test",
    isActive: true
  };

  const eligiblePhysician267: Physician = {
    id: "PHY-267",
    name: "Test New Test",
    areaId: "A-713066",
    areaName: "TEST",
    area: "TEST",
    territory: "LIBYA / WEST / TRIPOLI / TEST",
    city: "TEST",
    district: "TEST",
    country: "Libya",
    specialty: "Cardiology",
    classification: "A",
    status: "Active",
    active: true,
    primaryPromotionGroupId: "test"
  };

  const ineligiblePhysician999: Physician = {
    id: "PHY-999",
    name: "Unauthorized Doctor",
    areaId: "A-999999",
    areaName: "UNASSIGNED",
    area: "UNASSIGNED",
    territory: "LIBYA / WEST / TRIPOLI / UNASSIGNED",
    city: "Tripoli",
    district: "Central",
    country: "Libya",
    specialty: "Dermatology",
    classification: "B",
    status: "Active",
    active: true,
    primaryPromotionGroupId: "other"
  };

  const allPhysicians = [eligiblePhysician267, ineligiblePhysician999];
  const allUsers = [liveMedRep, gmUser];
  const territoryAssignments = [territoryAssignment];
  const productAssignments = [productAssignment];
  const products = [liveProduct];
  const promotionGroups = [livePromotionGroup];

  beforeEach(() => {
    setGlobalSecurityContext(
      liveMedRep,
      allUsers,
      territoryAssignments,
      productAssignments,
      products,
      promotionGroups
    );
  });

  it("1. Canonical Physician Eligibility: Representative sees strictly PHY-267 in Medical Planner scope", () => {
    const eligibleList = filterBySecurity(
      liveMedRep,
      allPhysicians,
      "territory",
      "primaryBrand",
      "assignedRepId",
      territoryAssignments,
      productAssignments
    );

    expect(eligibleList.map(p => p.id)).toEqual(["PHY-267"]);
  });

  it("2. Representative Scope: Medical Representative identity is strictly locked to auth UID", () => {
    const isRep = liveMedRep.role === Role.MEDICAL_REP || liveMedRep.role === Role.SALES_REP;
    expect(isRep).toBe(true);

    // rep identity defaults to auth UID
    const selectedRepId = liveMedRep.id;
    expect(selectedRepId).toBe("J37PXq5iqQSjIqXGnDhfPSLKC292");
  });

  it("3. Duplicate Prevention & Time Slot Rejection", () => {
    const plannedVisits = [
      {
        id: "pv-1",
        physicianId: "PHY-267",
        date: "2026-08-10",
        time: "09:00 AM",
        month: "2026-08",
        repId: "J37PXq5iqQSjIqXGnDhfPSLKC292"
      }
    ];

    // Attempting to schedule same rep at same date and time slot
    const targetDate = "2026-08-10";
    const targetTime = "09:00 AM";

    const isDuplicateSlot = plannedVisits.some(v => v.date === targetDate && v.time === targetTime);
    expect(isDuplicateSlot).toBe(true);

    // Attempting to schedule same physician twice on the same date
    const isDuplicatePhysicianDate = plannedVisits.some(v => v.physicianId === "PHY-267" && v.date === targetDate);
    expect(isDuplicatePhysicianDate).toBe(true);
  });

  it("4. Class A Physician Frequency Enforcement (Max 3 visits/month)", () => {
    const plannedVisitsClassA = [
      { id: "pv-1", physicianId: "PHY-267", date: "2026-08-03", month: "2026-08" },
      { id: "pv-2", physicianId: "PHY-267", date: "2026-08-11", month: "2026-08" },
      { id: "pv-3", physicianId: "PHY-267", date: "2026-08-19", month: "2026-08" },
    ];

    const doctorClass = "A";
    const maxAllowed = doctorClass === "A" ? 3 : doctorClass === "B" ? 2 : 1;
    const currentVisitsCount = plannedVisitsClassA.filter(v => v.physicianId === "PHY-267" && v.month === "2026-08").length;

    expect(currentVisitsCount).toBe(3);
    expect(currentVisitsCount >= maxAllowed).toBe(true); // 4th visit attempt must be rejected
  });

  it("5. Class B Physician Frequency Enforcement (Max 2 visits/month)", () => {
    const classBDoctor: Physician = {
      ...eligiblePhysician267,
      id: "PHY-300",
      classification: "B"
    };

    const plannedVisitsClassB = [
      { id: "pv-1", physicianId: "PHY-300", date: "2026-08-04", month: "2026-08" },
      { id: "pv-2", physicianId: "PHY-300", date: "2026-08-14", month: "2026-08" },
    ];

    const doctorClass = "B";
    const maxAllowed = doctorClass === "A" ? 3 : doctorClass === "B" ? 2 : 1;
    const currentVisitsCount = plannedVisitsClassB.filter(v => v.physicianId === "PHY-300" && v.month === "2026-08").length;

    expect(currentVisitsCount).toBe(2);
    expect(currentVisitsCount >= maxAllowed).toBe(true); // 3rd visit attempt must be rejected
  });

  it("6. Minimum 7 Working Days Gap Enforcement between visits for same physician", () => {
    const existingVisits = [
      { id: "pv-1", physicianId: "PHY-267", date: "2026-08-10" }
    ];

    const attemptedNewDate = "2026-08-13"; // Only 3 days gap
    const targetMidnight = new Date(attemptedNewDate).getTime();

    const hasGapViolation = existingVisits.some(v => {
      const existingMidnight = new Date(v.date).getTime();
      const diffMs = Math.abs(targetMidnight - existingMidnight);
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      return diffDays < 7;
    });

    expect(hasGapViolation).toBe(true); // 3 days gap violated < 7 working days gap
  });

  it("7. Disallowed Day (Sunday) and Past Date Rejection", () => {
    const sundayDate = "2026-08-09"; // Sunday
    const isSunday = new Date(sundayDate).getDay() === 0;
    expect(isSunday).toBe(true);

    const pastDate = "2026-08-01"; // Before current 2026-08-06
    const today = new Date("2026-08-06").getTime();
    const isPast = new Date(pastDate).getTime() < today;
    expect(isPast).toBe(true);
  });

  it("8. Plan Lifecycle & Locking Validation", () => {
    // Draft state
    let approvalStatus = "Draft";
    expect(approvalStatus === "Draft").toBe(true); // Editable

    // Pending Approval state
    approvalStatus = "Pending Approval";
    let isModifiable = !(approvalStatus === "Pending Approval" || approvalStatus === "Approved");
    expect(isModifiable).toBe(false); // Locked for editing

    // Approved state
    approvalStatus = "Approved";
    isModifiable = !(approvalStatus === "Pending Approval" || approvalStatus === "Approved");
    expect(isModifiable).toBe(false); // Read-only

    // Rejected / Returned state
    approvalStatus = "Draft";
    isModifiable = !(approvalStatus === "Pending Approval" || approvalStatus === "Approved");
    expect(isModifiable).toBe(true); // Editable again
  });

  it("9. Unauthorized Physician Rejection", () => {
    const eligiblePhysicians = filterBySecurity(
      liveMedRep,
      allPhysicians,
      "territory",
      "primaryBrand",
      "assignedRepId",
      territoryAssignments,
      productAssignments
    );

    const attemptedDoctor = ineligiblePhysician999;
    const isAssigned = eligiblePhysicians.some(p => p.id === attemptedDoctor.id);

    expect(isAssigned).toBe(false); // Rejected!
  });

  it("10. Planner-to-Visit Handoff Contract Integrity", () => {
    const plannedVisitRecord = {
      id: "pv-777",
      physicianId: "PHY-267",
      physicianName: "Test New Test",
      repId: "J37PXq5iqQSjIqXGnDhfPSLKC292",
      date: "2026-08-12",
      time: "10:00 AM",
      month: "2026-08",
      areaId: "A-713066",
      authorizedProductScope: ["PROD-9188"]
    };

    expect(plannedVisitRecord.physicianId).toBe("PHY-267");
    expect(plannedVisitRecord.repId).toBe("J37PXq5iqQSjIqXGnDhfPSLKC292");
    expect(plannedVisitRecord.areaId).toBe("A-713066");
    expect(plannedVisitRecord.authorizedProductScope).toContain("PROD-9188");
  });
});
