import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Firebase Auth and Firestore BEFORE importing detailingUsageService
vi.mock("./lib/firebase", () => {
  return {
    auth: {
      currentUser: {
        uid: "USR-REP-TEST-123",
        email: "rep@test.com",
      },
    },
    db: {},
  };
});

const mockSetDoc = vi.fn();
const mockUpdateDoc = vi.fn();
const mockDoc = vi.fn(() => ({ id: "USAGE-DOC-001" }));
const mockCollection = vi.fn();
const mockServerTimestamp = vi.fn(() => "SERVER_TIMESTAMP");

vi.mock("firebase/firestore", () => {
  return {
    collection: (...args: any[]) => mockCollection(...args),
    doc: (...args: any[]) => mockDoc(...args),
    setDoc: (...args: any[]) => mockSetDoc(...args),
    updateDoc: (...args: any[]) => mockUpdateDoc(...args),
    serverTimestamp: () => mockServerTimestamp(),
  };
});

vi.mock("./lib/firebaseError", () => {
  return {
    handleFirestoreError: vi.fn(),
    OperationType: { WRITE: "WRITE", UPDATE: "UPDATE" },
  };
});

import { openDetailingMaterialSession } from "./lib/detailingUsageService";

describe("WP-DA1 / WP-DA1A: Detailing Material Usage Tracking Engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an OPEN session document in detailingMaterialUsage upon opening", async () => {
    mockSetDoc.mockResolvedValueOnce(undefined);

    const session = await openDetailingMaterialSession({
      visitId: "VIS-100200",
      physicianId: "PHY-9988",
      productId: "PROD-CARDIO",
      materialId: "MAT-CARDIO-BROCHURE",
      materialName: "CardioMax Clinical Study Brochure",
    });

    expect(session).not.toBeNull();
    expect(session?.usageDocId).toBe("USAGE-DOC-001");

    // Verify setDoc payload for parent detailingMaterialUsage
    expect(mockSetDoc).toHaveBeenCalled();
    const [, payload] = mockSetDoc.mock.calls[0];
    expect(payload).toMatchObject({
      visitId: "VIS-100200",
      physicianId: "PHY-9988",
      representativeUid: "USR-REP-TEST-123", // Firebase Auth UID
      productId: "PROD-CARDIO",
      materialId: "MAT-CARDIO-BROCHURE",
      materialName: "CardioMax Clinical Study Brochure",
      status: "OPEN",
      durationSeconds: 0,
      closedAt: null,
    });
    expect(payload.openedAt).toBe("SERVER_TIMESTAMP");
    expect(payload.createdAt).toBe("SERVER_TIMESTAMP");
  });

  it("stores the canonical Promotion Group ID and visit stage when provided", async () => {
    mockSetDoc.mockResolvedValue(undefined);

    const session = await openDetailingMaterialSession({
      visitId: "VIS-100200",
      physicianId: "PHY-9988",
      productId: "PROD-CARDIO",
      promotionGroupId: "PG-CARDIO-VASCULAR",
      materialId: "MAT-CARDIO-BROCHURE",
      visitStage: "PRODUCT_DETAILING",
      initialPage: 1,
      totalPages: 3,
    });

    expect(mockSetDoc).toHaveBeenCalled();
    const [, payload] = mockSetDoc.mock.calls[0];
    expect(payload).toMatchObject({
      promotionGroupId: "PG-CARDIO-VASCULAR",
      visitStage: "PRODUCT_DETAILING",
      lastPageViewed: 1,
      totalPages: 3,
    });
  });

  it("logs diagnostic warning and DOES NOT invent a fake Promotion Group ID if missing", async () => {
    mockSetDoc.mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const session = await openDetailingMaterialSession({
      visitId: "VIS-100200",
      physicianId: "PHY-9988",
      productId: "PROD-NOPG",
      materialId: "MAT-BROCHURE-1",
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Development diagnostic: Product (PROD-NOPG) has no valid promotionGroupId assigned.")
    );

    const [, payload] = mockSetDoc.mock.calls[0];
    expect(payload.promotionGroupId).toBeUndefined();

    warnSpy.mockRestore();
  });

  it("updates the usage record to CLOSED with calculated durationSeconds on closeSession", async () => {
    mockSetDoc.mockResolvedValue(undefined);
    mockUpdateDoc.mockResolvedValue(undefined);

    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(1000000); // start time during open

    const session = await openDetailingMaterialSession({
      visitId: "VIS-100200",
      physicianId: "PHY-9988",
      productId: "PROD-CARDIO",
      materialId: "MAT-CARDIO-BROCHURE",
    });

    nowSpy.mockReturnValue(1005000); // end time on close (5s difference)

    // Close session
    await session?.closeSession({ closeReason: "DISMISS_BUTTON" });

    expect(mockUpdateDoc).toHaveBeenCalled();
    const [, updatePayload] = mockUpdateDoc.mock.calls[mockUpdateDoc.mock.calls.length - 1];
    expect(updatePayload).toMatchObject({
      status: "CLOSED",
      durationSeconds: 5,
      closeReason: "DISMISS_BUTTON",
    });
    expect(updatePayload.closedAt).toBe("SERVER_TIMESTAMP");
    expect(updatePayload.updatedAt).toBe("SERVER_TIMESTAMP");

    nowSpy.mockRestore();
  });

  it("stores final page reached, total pages, and closeReason when closing via DISMISS_BUTTON", async () => {
    mockSetDoc.mockResolvedValue(undefined);
    mockUpdateDoc.mockResolvedValue(undefined);

    const session = await openDetailingMaterialSession({
      visitId: "VIS-100200",
      physicianId: "PHY-9988",
      productId: "PROD-CARDIO",
      materialId: "MAT-CARDIO-BROCHURE",
      initialPage: 1,
      totalPages: 5,
    });

    session?.updatePage(3, 5);

    await session?.closeSession({
      lastPageViewed: 4,
      totalPages: 5,
      closeReason: "DISMISS_BUTTON",
    });

    expect(mockUpdateDoc).toHaveBeenCalled();
    const [, updatePayload] = mockUpdateDoc.mock.calls[mockUpdateDoc.mock.calls.length - 1];
    expect(updatePayload).toMatchObject({
      status: "CLOSED",
      lastPageViewed: 4,
      totalPages: 5,
      closeReason: "DISMISS_BUTTON",
    });
  });

  it("records CLOSE_ICON closeReason when closed via close icon", async () => {
    mockSetDoc.mockResolvedValue(undefined);
    mockUpdateDoc.mockResolvedValue(undefined);

    const session = await openDetailingMaterialSession({
      visitId: "VIS-100200",
      physicianId: "PHY-9988",
      productId: "PROD-CARDIO",
      materialId: "MAT-CARDIO-BROCHURE",
    });

    await session?.closeSession({
      closeReason: "CLOSE_ICON",
    });

    const [, updatePayload] = mockUpdateDoc.mock.calls[mockUpdateDoc.mock.calls.length - 1];
    expect(updatePayload.closeReason).toBe("CLOSE_ICON");
  });

  it("records MATERIAL_SWITCH closeReason when material is switched", async () => {
    mockSetDoc.mockResolvedValue(undefined);
    mockUpdateDoc.mockResolvedValue(undefined);

    const session = await openDetailingMaterialSession({
      visitId: "VIS-100200",
      physicianId: "PHY-9988",
      productId: "PROD-CARDIO",
      materialId: "MAT-CARDIO-BROCHURE-1",
    });

    await session?.closeSession({
      closeReason: "MATERIAL_SWITCH",
    });

    const [, updatePayload] = mockUpdateDoc.mock.calls[mockUpdateDoc.mock.calls.length - 1];
    expect(updatePayload.closeReason).toBe("MATERIAL_SWITCH");
  });

  it("does NOT overwrite original closeReason when duplicate close events occur", async () => {
    mockSetDoc.mockResolvedValue(undefined);
    mockUpdateDoc.mockResolvedValue(undefined);

    const session = await openDetailingMaterialSession({
      visitId: "VIS-100200",
      physicianId: "PHY-9988",
      productId: "PROD-CARDIO",
      materialId: "MAT-CARDIO-BROCHURE",
    });

    mockUpdateDoc.mockClear();

    // First close via CLOSE_ICON
    await session?.closeSession({
      closeReason: "CLOSE_ICON",
      lastPageViewed: 2,
    });

    const callsAfterFirstClose = mockUpdateDoc.mock.calls.length;

    // Second close via COMPONENT_UNMOUNT (duplicate)
    await session?.closeSession({
      closeReason: "COMPONENT_UNMOUNT",
      lastPageViewed: 1,
    });

    // Should only have called updateDoc for the first close execution
    expect(mockUpdateDoc.mock.calls.length).toBe(callsAfterFirstClose);
    const [, updatePayload] = mockUpdateDoc.mock.calls[mockUpdateDoc.mock.calls.length - 1];
    expect(updatePayload.closeReason).toBe("CLOSE_ICON");
    expect(updatePayload.lastPageViewed).toBe(2);
    expect(session?.firstCloseReason).toBe("CLOSE_ICON");
  });

  it("creates separate documents for separate viewing sessions of the same material", async () => {
    mockSetDoc.mockResolvedValue(undefined);
    mockUpdateDoc.mockResolvedValue(undefined);

    // Session 1
    const session1 = await openDetailingMaterialSession({
      visitId: "VIS-100200",
      physicianId: "PHY-9988",
      productId: "PROD-CARDIO",
      materialId: "MAT-CARDIO-BROCHURE",
    });
    await session1?.closeSession({ closeReason: "DISMISS_BUTTON" });

    // Session 2 (re-opening the same material)
    const session2 = await openDetailingMaterialSession({
      visitId: "VIS-100200",
      physicianId: "PHY-9988",
      productId: "PROD-CARDIO",
      materialId: "MAT-CARDIO-BROCHURE",
    });
    await session2?.closeSession({ closeReason: "CLOSE_ICON" });

    // setDoc should be called at least 4 times (2 parent sessions + 2 page sessions)
    expect(mockSetDoc.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(mockUpdateDoc.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("correctly tracks highestPageViewed and pageSequence on page navigation (UAT Scenario 1)", async () => {
    mockSetDoc.mockResolvedValue(undefined);
    mockUpdateDoc.mockResolvedValue(undefined);

    const session = await openDetailingMaterialSession({
      visitId: "VIS-100200",
      physicianId: "PHY-9988",
      productId: "PROD-CARDIO",
      materialId: "MAT-CARDIO-BROCHURE",
      initialPage: 1,
      totalPages: 5,
    });

    // Representative navigates: Page 1 -> Page 2 -> Page 5 -> Page 3
    session?.updatePage(2);
    session?.updatePage(5);
    session?.updatePage(3);

    await session?.closeSession({
      closeReason: "CLOSE_ICON",
    });

    expect(mockUpdateDoc).toHaveBeenCalled();
    const [, updatePayload] = mockUpdateDoc.mock.calls[mockUpdateDoc.mock.calls.length - 1];
    expect(updatePayload).toMatchObject({
      status: "CLOSED",
      lastPageViewed: 3,
      highestPageViewed: 5,
      pageSequence: [1, 2, 5, 3],
      closeReason: "CLOSE_ICON",
    });
  });

  it("correctly tracks navigation loop 1 -> 2 -> 3 -> 2 (UAT Scenario 2)", async () => {
    mockSetDoc.mockResolvedValue(undefined);
    mockUpdateDoc.mockResolvedValue(undefined);

    const session = await openDetailingMaterialSession({
      visitId: "VIS-100200",
      physicianId: "PHY-9988",
      productId: "PROD-CARDIO",
      materialId: "MAT-CARDIO-BROCHURE",
      initialPage: 1,
      totalPages: 3,
    });

    // Representative navigates: Page 1 -> Page 2 -> Page 3 -> Page 2
    session?.updatePage(2);
    session?.updatePage(3);
    session?.updatePage(2);

    await session?.closeSession({
      closeReason: "CLOSE_ICON",
    });

    expect(mockUpdateDoc).toHaveBeenCalled();
    const [, updatePayload] = mockUpdateDoc.mock.calls[mockUpdateDoc.mock.calls.length - 1];
    expect(updatePayload).toMatchObject({
      status: "CLOSED",
      lastPageViewed: 2,
      highestPageViewed: 3,
      pageSequence: [1, 2, 3, 2],
      closeReason: "CLOSE_ICON",
    });
  });

  it("handles missing visitId safely without throwing, skipping Firestore writes and logging diagnostic", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const session = await openDetailingMaterialSession({
      visitId: "",
      physicianId: "PHY-9988",
      productId: "PROD-CARDIO",
      materialId: "MAT-CARDIO-BROCHURE",
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Development diagnostic: Brochure opened without an active or draft visit ID. Skipping Firestore tracking.")
    );

    // No setDoc call should be made
    expect(mockSetDoc).not.toHaveBeenCalled();

    // Closing NOOP session should execute without throwing
    await session?.closeSession({ closeReason: "CLOSE_ICON" });
    expect(mockUpdateDoc).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
