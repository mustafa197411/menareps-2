import { describe, it, expect } from "vitest";
import React from "react";
import Dashboard, { safeToLocaleString, safeToFixed, resolveDisplayLabel } from "./Dashboard";
import { Role, User, PhysicianVisit, PharmacyVisit } from "../types";

const mockUser: User = {
  id: "USR-001",
  name: "Test User",
  email: "test@menareps.local",
  role: Role.SUPERVISOR,
  active: true,
  status: "Active",
  region: "West",
  country: "LY"
};

describe("Dashboard - Hotfix & Safe Formatter Tests", () => {
  it("1. safeToLocaleString formats numbers correctly and handles null/undefined/NaN", () => {
    expect(safeToLocaleString(12500)).toBe((12500).toLocaleString());
    expect(safeToLocaleString(0)).toBe("0");
    expect(safeToLocaleString(undefined)).toBe("0");
    expect(safeToLocaleString(null)).toBe("0");
    expect(safeToLocaleString(NaN)).toBe("0");
    expect(safeToLocaleString("invalid")).toBe("0");
  });

  it("2. safeToFixed formats numbers correctly and handles null/undefined/NaN", () => {
    expect(safeToFixed(85.456, 1)).toBe("85.5");
    expect(safeToFixed(0, 1)).toBe("0.0");
    expect(safeToFixed(undefined, 1)).toBe("0.0");
    expect(safeToFixed(null, 1)).toBe("0.0");
    expect(safeToFixed(NaN, 1)).toBe("0.0");
  });

  it("3. resolveDisplayLabel renders English labelEn for en language", () => {
    const obj = { code: "ORDER_TAKING", labelEn: "Order Taking", labelAr: "أخذ الطلبيات" };
    expect(resolveDisplayLabel(obj, "en")).toBe("Order Taking");
  });

  it("4. resolveDisplayLabel renders Arabic labelAr for ar language", () => {
    const obj = { code: "ORDER_TAKING", labelEn: "Order Taking", labelAr: "أخذ الطلبيات" };
    expect(resolveDisplayLabel(obj, "ar")).toBe("أخذ الطلبيات");
  });

  it("5. resolveDisplayLabel falls back to code when labelEn is missing", () => {
    const obj = { code: "PURPOSE_CODE_01", labelAr: "أخذ الطلبيات" };
    expect(resolveDisplayLabel(obj, "en")).toBe("PURPOSE_CODE_01");
  });

  it("6. resolveDisplayLabel renders plain strings as-is", () => {
    expect(resolveDisplayLabel("Stock Audit", "en")).toBe("Stock Audit");
  });

  it("7. resolveDisplayLabel renders em dash for null and undefined", () => {
    expect(resolveDisplayLabel(null, "en")).toBe("—");
    expect(resolveDisplayLabel(undefined, "en")).toBe("—");
  });

  it("8. resolveDisplayLabel handles unsupported object without crashing", () => {
    const obj = { randomProp: 123 };
    expect(resolveDisplayLabel(obj, "en")).toBe("—");
  });

  it("9. Visit Purpose object does not crash Dashboard", () => {
    const visitWithStructuredPurpose: PharmacyVisit = {
      id: "PV-STRUCT-01",
      pharmacyId: "PHM-001",
      pharmacyName: "Central Pharmacy",
      repId: "REP-001",
      repName: "Field Rep",
      visitDate: "2026-07-25",
      gpsVerified: true,
      visitPurpose: { code: "STOCK_AUDIT", labelEn: "Stock Audit & Order", labelAr: "جرد وجلب طلبيات" } as any,
      items: [],
      totalAmount: 500,
      discountApplied: 0,
      netAmount: 500,
      stockAudit: [],
      intelNotes: "Routine visit",
      createdAt: "2026-07-25T10:00:00Z"
    };

    expect(() => {
      React.createElement(Dashboard, {
        currentUser: mockUser,
        physicianVisits: [],
        pharmacyVisits: [visitWithStructuredPurpose],
        lang: "en"
      });
    }).not.toThrow();
  });

  it("10. Reaction object in PhysicianVisit detailing does not crash Dashboard", () => {
    const visitWithStructuredReaction: PhysicianVisit = {
      id: "DOC-STRUCT-01",
      physicianId: "PHY-001",
      physicianName: "Dr. Salem",
      repId: "REP-001",
      repName: "Med Rep",
      visitDate: "2026-07-25",
      gpsVerified: true,
      durationSeconds: 120,
      detailing: [
        {
          productId: "PROD-1",
          brandName: { code: "AMOX", labelEn: "Amoxil 500mg", labelAr: "أموكسيل 500ملجم" } as any,
          reaction: { code: "REACTION_POS", labelEn: "Positive Feedback", labelAr: "انطباع إيجابي" } as any,
          prescriptionIntent: { code: "HIGH_COMMITMENT", labelEn: "High Commitment", labelAr: "التزام عالٍ" } as any,
          samplesDropped: []
        }
      ],
      createdAt: "2026-07-25T10:00:00Z"
    };

    expect(() => {
      React.createElement(Dashboard, {
        currentUser: mockUser,
        physicianVisits: [visitWithStructuredReaction],
        pharmacyVisits: [],
        lang: "en"
      });
    }).not.toThrow();
  });

  it("11. Empty data Dashboard still renders without throwing", () => {
    expect(() => {
      React.createElement(Dashboard, {
        currentUser: mockUser,
        physicianVisits: [],
        pharmacyVisits: [],
        lang: "en",
        users: [],
        physicians: [],
        pharmacies: [],
        products: []
      });
    }).not.toThrow();
  });

  it("12. Dashboard executes with undefined optional analytics/visit fields without throwing", () => {
    const incompleteVisit: PharmacyVisit = {
      id: "PV-001",
      pharmacyId: "PHM-001",
      pharmacyName: "Incomplete Pharmacy",
      repId: "REP-001",
      repName: "Test Rep",
      visitDate: "2026-07-25",
      gpsVerified: true,
      visitPurpose: "Stock Audit",
      items: [],
      totalAmount: (undefined as unknown) as number,
      discountApplied: 0,
      netAmount: (undefined as unknown) as number,
      stockAudit: [],
      intelNotes: "",
      createdAt: "2026-07-25T10:00:00Z"
    };

    expect(() => {
      React.createElement(Dashboard, {
        currentUser: mockUser,
        physicianVisits: [],
        pharmacyVisits: [incompleteVisit],
        lang: "en"
      });
    }).not.toThrow();
  });
});


import { getSalesAnalytics } from "../lib/analyticsService";
it("current financial KPIs use supplied canonical profile totals rather than Visit fields",()=>{
 const state:any={users:[],products:[],physicians:[],pharmacies:[],physicianVisits:[],pharmacyVisits:[{id:"VISIT-SYNTHETIC",repId:mockUser.id,visitDate:"2026-01-01",paymentCollected:999999,outstandingBalanceAfter:999999,items:[]}],userTerritoryAssignments:[],userProductAssignments:[],physicianAssignments:[],pharmacyAssignments:[]};
 const filters:any={};
 expect(getSalesAnalytics(mockUser,state,filters,{outstandingBalance:1500,paymentsCollected:500})).toMatchObject({outstandingBalance:1500,paymentsCollected:500});
 expect(getSalesAnalytics(mockUser,state,filters)).toMatchObject({outstandingBalance:null,paymentsCollected:null});
 expect(getSalesAnalytics(mockUser,state,filters,{outstandingBalance:1200,paymentsCollected:800})).toMatchObject({outstandingBalance:1200,paymentsCollected:800});
});
