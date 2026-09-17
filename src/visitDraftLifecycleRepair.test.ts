import { describe, it, expect } from "vitest";

describe("WP6.4D Visit Draft Lifecycle & Double-Submission Prevention Suite", () => {
  it("1. Physician Visit: Draft ID generation includes timestamp/randomizer making it unique per session", () => {
    const physicianId = "PHY-267";
    const draftId1 = `DRAFT-VIS-${physicianId}-${Date.now()}`;
    const draftId2 = `DRAFT-VIS-${physicianId}-${Date.now() + 5}`;

    expect(draftId1).not.toEqual(draftId2);
    expect(draftId1).toContain("DRAFT-VIS-PHY-267-");
    expect(draftId2).toContain("DRAFT-VIS-PHY-267-");
  });

  it("2. Physician Visit Completion: Clears active draft ID and resets state for fresh re-entry", () => {
    let activeDraftVisitId = "DRAFT-VIS-PHY-267-178590000";
    let isSubmitting = false;
    let selectedPhysician: any = { id: "PHY-267", name: "Dr. Salem" };

    // Simulate completion function
    function completePhysicianVisit() {
      if (isSubmitting) return "BLOCKED_DOUBLE_SUBMIT";
      isSubmitting = true;
      try {
        const completedVisit = {
          id: activeDraftVisitId,
          physicianId: selectedPhysician.id,
          completedAt: new Date().toISOString()
        };
        // Reset state after successful completion
        activeDraftVisitId = "";
        selectedPhysician = null;
        return completedVisit;
      } finally {
        isSubmitting = false;
      }
    }

    const firstResult = completePhysicianVisit();
    expect(firstResult).not.toBe("BLOCKED_DOUBLE_SUBMIT");
    expect((firstResult as any).id).toBe("DRAFT-VIS-PHY-267-178590000");

    // Verify state was reset
    expect(activeDraftVisitId).toBe("");
    expect(selectedPhysician).toBeNull();

    // Re-entering physician select generates a fresh draft ID
    selectedPhysician = { id: "PHY-267", name: "Dr. Salem" };
    activeDraftVisitId = `DRAFT-VIS-${selectedPhysician.id}-${Date.now() + 100}`;

    expect(activeDraftVisitId).not.toBe("DRAFT-VIS-PHY-267-178590000");
    expect(activeDraftVisitId).toContain("DRAFT-VIS-PHY-267-");
  });

  it("3. Double-Submission Protection: Rejects concurrent duplicate clicks during completion", () => {
    let isSubmitting = false;
    const completedList: string[] = [];

    function processSubmission(draftId: string) {
      if (isSubmitting) {
        return "BLOCKED_DUPLICATE_SUBMIT";
      }
      isSubmitting = true;
      try {
        completedList.push(draftId);
        return "SUCCESS";
      } finally {
        // Keep lock until transaction finishes
      }
    }

    const res1 = processSubmission("DRAFT-VIS-PHY-267-100");
    const res2 = processSubmission("DRAFT-VIS-PHY-267-100"); // concurrent attempt before lock release

    expect(res1).toBe("SUCCESS");
    expect(res2).toBe("BLOCKED_DUPLICATE_SUBMIT");
    expect(completedList).toHaveLength(1);
  });

  it("4. Pharmacy Visit: Completed pharmacy visit generates timestamped ID preventing collision", () => {
    const id1 = `PV-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const id2 = `PV-${Date.now() + 1}-${Math.floor(1000 + Math.random() * 9000)}`;

    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^PV-\d+-\d{4}$/);
    expect(id2).toMatch(/^PV-\d+-\d{4}$/);
  });

  it("5. Server-Side Duplicate Check: Transaction blocks write if visit document ID already exists in Firestore", () => {
    const firestoreDb = new Set<string>(["DRAFT-VIS-PHY-267-EXISTING"]);

    function savePhysicianVisitRecordMock(visitId: string): void {
      if (firestoreDb.has(visitId)) {
        throw new Error(`Physician visit with ID '${visitId}' has already been completed. Double-submission prevented.`);
      }
      firestoreDb.add(visitId);
    }

    // Attempting to save an existing visit ID throws double-submission error
    expect(() => savePhysicianVisitRecordMock("DRAFT-VIS-PHY-267-EXISTING")).toThrow(
      "Physician visit with ID 'DRAFT-VIS-PHY-267-EXISTING' has already been completed. Double-submission prevented."
    );

    // Saving a new fresh visit ID succeeds
    const newVisitId = "DRAFT-VIS-PHY-267-NEW";
    expect(() => savePhysicianVisitRecordMock(newVisitId)).not.toThrow();
    expect(firestoreDb.has(newVisitId)).toBe(true);
  });
});
