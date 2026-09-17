import { describe, it, expect, vi } from "vitest";
import { removeUndefinedRecursively, getUndefinedPaths, isPlainObject } from "./utils/importNormalization";
import { handleFirestoreError, OperationType } from "./lib/firebaseError";
import { formatFileSize } from "./lib/resourceMaterialService";

describe("Physician Visit Persistence & Normalization", () => {
  it("1. omits followUpDate when followUpDate is undefined or followUpRequired is false", () => {
    const rawPayload = {
      id: "DRAFT-VIS-PHY-290",
      physicianId: "PHY-101",
      physicianName: "Dr. Ahmed",
      repId: "REP-01",
      repName: "Rep User",
      visitDate: "2026-07-31",
      durationSeconds: 120,
      followUpRequired: false,
      followUpDate: undefined,
      followUpNotes: undefined,
      prescriptionIntent: 5
    };

    const sanitized = removeUndefinedRecursively(rawPayload);

    expect(sanitized).not.toHaveProperty("followUpDate");
    expect(sanitized).not.toHaveProperty("followUpNotes");
    expect(sanitized.followUpRequired).toBe(false);
    expect(sanitized.prescriptionIntent).toBe(5);
  });

  it("2. persists valid followUpDate when provided", () => {
    const rawPayload = {
      id: "VIS-300",
      physicianId: "PHY-102",
      physicianName: "Dr. Fatima",
      repId: "REP-01",
      repName: "Rep User",
      visitDate: "2026-07-31",
      durationSeconds: 180,
      followUpRequired: true,
      followUpDate: "2026-08-15",
      followUpNotes: "Check sample response",
      prescriptionIntent: 8
    };

    const sanitized = removeUndefinedRecursively(rawPayload);

    expect(sanitized.followUpRequired).toBe(true);
    expect(sanitized.followUpDate).toBe("2026-08-15");
    expect(sanitized.followUpNotes).toBe("Check sample response");
  });

  it("3. preserves null values where canonical schema intentionally supplies null", () => {
    const rawPayload = {
      id: "VIS-301",
      physicianId: "PHY-103",
      approvedBy: null,
      rejectionReason: null,
      notes: "Standard visit"
    };

    const sanitized = removeUndefinedRecursively(rawPayload);

    expect(sanitized.approvedBy).toBeNull();
    expect(sanitized.rejectionReason).toBeNull();
    expect(sanitized.notes).toBe("Standard visit");
  });

  it("4. recursively removes nested undefined values from objects and arrays", () => {
    const rawPayload = {
      id: "VIS-302",
      detailing: [
        {
          productId: "PROD-01",
          brandName: "Eramax",
          reaction: "Positive",
          notes: undefined,
          presentedKeyMessages: undefined
        }
      ],
      gps: {
        latitude: 32.8872,
        longitude: 13.1913,
        accuracy: undefined,
        timestamp: undefined
      },
      marketingRequest: undefined
    };

    const sanitized = removeUndefinedRecursively(rawPayload);

    expect(sanitized.detailing[0]).toHaveProperty("productId", "PROD-01");
    expect(sanitized.detailing[0]).not.toHaveProperty("notes");
    expect(sanitized.detailing[0]).not.toHaveProperty("presentedKeyMessages");
    expect(sanitized.gps).toEqual({ latitude: 32.8872, longitude: 13.1913 });
    expect(sanitized).not.toHaveProperty("marketingRequest");
  });

  it("5. preserves valid boolean false and numeric zero values", () => {
    const rawPayload = {
      id: "VIS-303",
      followUpRequired: false,
      gpsVerified: false,
      durationSeconds: 0,
      prescriptionIntent: 0,
      samples: []
    };

    const sanitized = removeUndefinedRecursively(rawPayload);

    expect(sanitized.followUpRequired).toBe(false);
    expect(sanitized.gpsVerified).toBe(false);
    expect(sanitized.durationSeconds).toBe(0);
    expect(sanitized.prescriptionIntent).toBe(0);
    expect(sanitized.samples).toEqual([]);
  });

  it("6. preserves Firestore Date objects without converting them into plain objects", () => {
    const dateObj = new Date("2026-07-31T12:00:00Z");
    const mockTimestamp = {
      seconds: 1785500000,
      nanoseconds: 0,
      toDate: () => dateObj,
      constructor: { name: "Timestamp" }
    };

    const rawPayload = {
      id: "VIS-304",
      createdAtDate: dateObj,
      serverTime: mockTimestamp,
      notes: "Timestamp test"
    };

    const sanitized = removeUndefinedRecursively(rawPayload);

    expect(sanitized.createdAtDate).toEqual(dateObj);
    expect(sanitized.serverTime).toEqual(mockTimestamp);
  });

  it("7. does not mutate the original source payload object", () => {
    const original = {
      id: "VIS-305",
      followUpDate: undefined,
      details: {
        notes: undefined,
        valid: "yes"
      }
    };

    const clone = JSON.parse(JSON.stringify(original));
    const sanitized = removeUndefinedRecursively(original);

    expect(original.followUpDate).toBeUndefined();
    expect(original.details.notes).toBeUndefined();
    expect(sanitized).not.toHaveProperty("followUpDate");
    expect(sanitized.details).not.toHaveProperty("notes");
  });

  it("8. verifies getUndefinedPaths accurately records all removed field paths", () => {
    const rawPayload = {
      id: "VIS-306",
      followUpDate: undefined,
      gps: {
        accuracy: undefined,
        altitude: undefined
      },
      items: [
        { name: "Item 1", note: undefined }
      ]
    };

    const paths = getUndefinedPaths(rawPayload);

    expect(paths).toContain("followUpDate");
    expect(paths).toContain("gps.accuracy");
    expect(paths).toContain("gps.altitude");
    expect(paths).toContain("items[0].note");
  });

  it("9. handleFirestoreError receives the sanitized payload and logs removed field paths", () => {
    const spyError = vi.spyOn(console, "error").mockImplementation(() => {});

    const mockPayload = {
      id: "DRAFT-VIS-PHY-290",
      physicianName: "Dr. Ali",
      followUpRequired: false
    };

    handleFirestoreError(
      new Error("Simulated Firestore Exception"),
      OperationType.WRITE,
      "physicianVisits/DRAFT-VIS-PHY-290",
      mockPayload,
      false,
      "N/A",
      "N/A",
      ["followUpDate", "followUpNotes"]
    );

    expect(spyError).toHaveBeenCalled();
    const payloadCall = spyError.mock.calls.find(c => c[0] === "4. Complete Object Being Written:");
    const removedCall = spyError.mock.calls.find(c => c[0] === "5. Removed Undefined Field Paths:");

    expect(payloadCall?.[1]).toEqual(mockPayload);
    expect(removedCall?.[1]).toEqual(["followUpDate", "followUpNotes"]);

    spyError.mockRestore();
  });

  it("10. formatFileSize correctly formats bytes (278260 bytes -> 271.7 KB)", () => {
    const bytes = 278260;
    const formatted = formatFileSize(bytes);
    expect(formatted).toBe("271.7 KB");
  });
});
