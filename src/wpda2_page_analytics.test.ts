import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Firebase Auth and Firestore BEFORE importing detailingUsageService
vi.mock("./lib/firebase", () => {
  return {
    auth: {
      currentUser: {
        uid: "USR-REP-TEST-456",
        email: "rep456@test.com",
      },
    },
    db: {},
  };
});

const mockSetDoc = vi.fn();
const mockUpdateDoc = vi.fn();

let docIdCounter = 1;
const mockDoc = vi.fn((collOrDb: any, pathOrId?: string) => {
  const docId = `DOC-${docIdCounter++}`;
  return { id: docId, path: `collection/${docId}` };
});

const mockCollection = vi.fn((db: any, collName: string) => collName);
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

describe("WP-DA2: Automatic Page Analytics Engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    docIdCounter = 1;
    mockSetDoc.mockResolvedValue(undefined);
    mockUpdateDoc.mockResolvedValue(undefined);
  });

  it("automatically creates Page 1 session (index 1) when brochure opens", async () => {
    const session = await openDetailingMaterialSession({
      visitId: "VIS-200300",
      physicianId: "PHY-1122",
      productId: "PROD-ONCO",
      materialId: "MAT-ONCO-SLIDES",
      initialPage: 1,
      totalPages: 4,
    });

    expect(session).not.toBeNull();

    // setDoc should have been called twice: 1 for parent detailingMaterialUsage, 1 for page 1 detailingPageAnalytics
    expect(mockSetDoc).toHaveBeenCalledTimes(2);

    const [parentRef, parentPayload] = mockSetDoc.mock.calls[0];
    const [pageRef, pagePayload] = mockSetDoc.mock.calls[1];

    expect(parentPayload).toMatchObject({
      visitId: "VIS-200300",
      representativeUid: "USR-REP-TEST-456",
      productId: "PROD-ONCO",
      materialId: "MAT-ONCO-SLIDES",
      status: "OPEN",
    });

    expect(pagePayload).toMatchObject({
      usageSessionId: expect.any(String),
      visitId: "VIS-200300",
      physicianId: "PHY-1122",
      representativeUid: "USR-REP-TEST-456",
      productId: "PROD-ONCO",
      materialId: "MAT-ONCO-SLIDES",
      pageNumber: 1,
      pageVisitIndex: 1,
      exitedAt: null,
      durationSeconds: 0,
      exitReason: "",
    });
  });

  it("handles page navigation (1 -> 2 -> 3 -> 2) closing previous pages with PAGE_CHANGE and creating new sessions with incremented index", async () => {
    const session = await openDetailingMaterialSession({
      visitId: "VIS-200300",
      physicianId: "PHY-1122",
      productId: "PROD-ONCO",
      materialId: "MAT-ONCO-SLIDES",
      initialPage: 1,
      totalPages: 4,
    });

    // Reset setDoc/updateDoc counts after initialization
    mockSetDoc.mockClear();
    mockUpdateDoc.mockClear();

    // Rep navigates: 1 -> 2
    session?.updatePage(2);
    // Page 1 should be closed with PAGE_CHANGE, Page 2 session created with pageVisitIndex = 2
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    expect(mockUpdateDoc.mock.calls[0][1]).toMatchObject({
      exitReason: "PAGE_CHANGE",
    });
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    expect(mockSetDoc.mock.calls[0][1]).toMatchObject({
      pageNumber: 2,
      pageVisitIndex: 2,
    });

    mockSetDoc.mockClear();
    mockUpdateDoc.mockClear();

    // Rep navigates: 2 -> 3
    session?.updatePage(3);
    // Page 2 closed with PAGE_CHANGE, Page 3 created with pageVisitIndex = 3
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    expect(mockUpdateDoc.mock.calls[0][1]).toMatchObject({
      exitReason: "PAGE_CHANGE",
    });
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    expect(mockSetDoc.mock.calls[0][1]).toMatchObject({
      pageNumber: 3,
      pageVisitIndex: 3,
    });

    mockSetDoc.mockClear();
    mockUpdateDoc.mockClear();

    // Rep navigates: 3 -> 2 (return to Page 2)
    session?.updatePage(2);
    // Page 3 closed with PAGE_CHANGE, NEW Page 2 session created with pageVisitIndex = 4
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    expect(mockUpdateDoc.mock.calls[0][1]).toMatchObject({
      exitReason: "PAGE_CHANGE",
    });
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    expect(mockSetDoc.mock.calls[0][1]).toMatchObject({
      pageNumber: 2,
      pageVisitIndex: 4,
    });
  });

  it("does NOT update parent detailingMaterialUsage document on page change", async () => {
    const session = await openDetailingMaterialSession({
      visitId: "VIS-200300",
      physicianId: "PHY-1122",
      productId: "PROD-ONCO",
      materialId: "MAT-ONCO-SLIDES",
      initialPage: 1,
      totalPages: 4,
    });

    const parentDocRef = mockSetDoc.mock.calls[0][0];
    mockUpdateDoc.mockClear();

    session?.updatePage(2);
    session?.updatePage(3);

    // Verify parentDocRef was NEVER updated during page navigation
    const updatedRefs = mockUpdateDoc.mock.calls.map((call) => call[0]);
    expect(updatedRefs).not.toContain(parentDocRef);
  });

  it("finalizes active page session and parent usage session when brochure is closed via CLOSE_ICON", async () => {
    const session = await openDetailingMaterialSession({
      visitId: "VIS-200300",
      physicianId: "PHY-1122",
      productId: "PROD-ONCO",
      materialId: "MAT-ONCO-SLIDES",
      initialPage: 1,
      totalPages: 4,
    });

    mockUpdateDoc.mockClear();

    await session?.closeSession({
      closeReason: "CLOSE_ICON",
      lastPageViewed: 1,
    });

    // updateDoc should be called twice: 1 for active page session, 1 for parent usage session
    expect(mockUpdateDoc).toHaveBeenCalledTimes(2);

    const [pageUpdateRef, pageUpdatePayload] = mockUpdateDoc.mock.calls[0];
    const [parentUpdateRef, parentUpdatePayload] = mockUpdateDoc.mock.calls[1];

    expect(pageUpdatePayload).toMatchObject({
      exitReason: "MATERIAL_CLOSED",
    });

    expect(parentUpdatePayload).toMatchObject({
      status: "CLOSED",
      closeReason: "CLOSE_ICON",
    });
  });

  it("finalizes active page session with MATERIAL_CLOSED when closed via DISMISS_BUTTON", async () => {
    const session = await openDetailingMaterialSession({
      visitId: "VIS-200300",
      physicianId: "PHY-1122",
      productId: "PROD-ONCO",
      materialId: "MAT-ONCO-SLIDES",
      initialPage: 1,
    });

    mockUpdateDoc.mockClear();

    await session?.closeSession({
      closeReason: "DISMISS_BUTTON",
    });

    expect(mockUpdateDoc.mock.calls[0][1]).toMatchObject({
      exitReason: "MATERIAL_CLOSED",
    });
  });

  it("finalizes active page session with MATERIAL_SWITCH when material is switched", async () => {
    const session = await openDetailingMaterialSession({
      visitId: "VIS-200300",
      physicianId: "PHY-1122",
      productId: "PROD-ONCO",
      materialId: "MAT-ONCO-SLIDES",
    });

    mockUpdateDoc.mockClear();

    await session?.closeSession({
      closeReason: "MATERIAL_SWITCH",
    });

    expect(mockUpdateDoc.mock.calls[0][1]).toMatchObject({
      exitReason: "MATERIAL_SWITCH",
    });
  });

  it("finalizes active page session with NAVIGATION_AWAY on navigation away", async () => {
    const session = await openDetailingMaterialSession({
      visitId: "VIS-200300",
      physicianId: "PHY-1122",
      productId: "PROD-ONCO",
      materialId: "MAT-ONCO-SLIDES",
    });

    mockUpdateDoc.mockClear();

    await session?.closeSession({
      closeReason: "NAVIGATION_AWAY",
    });

    expect(mockUpdateDoc.mock.calls[0][1]).toMatchObject({
      exitReason: "NAVIGATION_AWAY",
    });
  });

  it("prevents duplicate close writes when closeSession is invoked repeatedly", async () => {
    const session = await openDetailingMaterialSession({
      visitId: "VIS-200300",
      physicianId: "PHY-1122",
      productId: "PROD-ONCO",
      materialId: "MAT-ONCO-SLIDES",
    });

    mockUpdateDoc.mockClear();

    await session?.closeSession({ closeReason: "CLOSE_ICON" });
    await session?.closeSession({ closeReason: "COMPONENT_UNMOUNT" });

    // Should only execute close updates once
    expect(mockUpdateDoc).toHaveBeenCalledTimes(2);
  });

  it("handles Firestore analytics failure gracefully without throwing or interrupting brochure flow", async () => {
    mockSetDoc.mockRejectedValueOnce(new Error("Firestore permission denied"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Opening brochure should not throw even if setDoc fails
    const session = await openDetailingMaterialSession({
      visitId: "VIS-200300",
      physicianId: "PHY-1122",
      productId: "PROD-ONCO",
      materialId: "MAT-ONCO-SLIDES",
    });

    expect(session).not.toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[detailingUsage] Failed to create open usage record"),
      expect.any(Error)
    );

    // Page updates and closing should also not throw
    mockUpdateDoc.mockRejectedValueOnce(new Error("Update failed"));
    expect(() => session?.updatePage(2)).not.toThrow();

    await expect(session?.closeSession({ closeReason: "CLOSE_ICON" })).resolves.not.toThrow();

    warnSpy.mockRestore();
  });
});
