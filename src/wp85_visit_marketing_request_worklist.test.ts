import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  presentationActionsForVisitMarketingRequest,
  visitMarketingRequestActionRequiresText,
} from "./lib/visitMarketingRequestPresentation";

const worklist = fs.readFileSync(new URL("./components/marketing/VisitMarketingRequestWorklist.tsx", import.meta.url), "utf8");
const router = fs.readFileSync(new URL("./components/SidebarPageRouter.tsx", import.meta.url), "utf8");

describe("WP85 canonical Visit Marketing Request worklist", () => {
  it("routes the canonical worklist distinctly from material and KOL resources", () => {
    expect(router).toMatch(/case "marketing-my-requests":\s*return <VisitMarketingRequestWorklist/);
    expect(router).toContain('case "marketing-materials-requests":');
    expect(router).toContain('<MarketingMaterials currentUser={currentUser} lang={lang} />');
    expect(router).toContain('<MarketingApprovals currentUser={currentUser} lang={lang} />');
  });

  it("uses only canonical request client APIs and no direct Firestore mutation", () => {
    expect(worklist).toContain("queryVisitMarketingRequests(auth.currentUser)");
    expect(worklist).toContain("transitionVisitMarketingRequest(auth.currentUser");
    expect(worklist).not.toMatch(/from "firebase\/firestore"|marketingMaterialRequests|kolSponsorships|onSnapshot|setDoc|updateDoc|addDoc/);
  });

  it("presents creator cancellation only while a canonical pending transition exists", () => {
    expect(presentationActionsForVisitMarketingRequest("PENDING_SUPERVISOR", true)).toEqual(["CANCEL"]);
    expect(presentationActionsForVisitMarketingRequest("PENDING_FINAL_APPROVAL", true)).toEqual(["CANCEL"]);
    expect(presentationActionsForVisitMarketingRequest("APPROVED", true)).toEqual([]);
    expect(presentationActionsForVisitMarketingRequest("EXECUTED", true)).toEqual([]);
  });

  it("maps non-creator presentation to the canonical lifecycle without role-title logic", () => {
    expect(presentationActionsForVisitMarketingRequest("PENDING_SUPERVISOR", false)).toEqual(["SUPERVISOR_APPROVE", "SUPERVISOR_REJECT"]);
    expect(presentationActionsForVisitMarketingRequest("PENDING_FINAL_APPROVAL", false)).toEqual(["FINAL_APPROVE", "FINAL_REJECT"]);
    expect(presentationActionsForVisitMarketingRequest("APPROVED", false)).toEqual(["EXECUTE"]);
    for (const status of ["EXECUTED", "REJECTED", "CANCELLED"] as const) expect(presentationActionsForVisitMarketingRequest(status, false)).toEqual([]);
  });

  it("requires text for rejection, cancellation and execution", () => {
    for (const action of ["SUPERVISOR_REJECT", "FINAL_REJECT", "CANCEL", "EXECUTE"] as const) expect(visitMarketingRequestActionRequiresText(action)).toBe(true);
    expect(visitMarketingRequestActionRequiresText("SUPERVISOR_APPROVE")).toBe(false);
    expect(visitMarketingRequestActionRequiresText("FINAL_APPROVE")).toBe(false);
  });

  it("exposes stable semantic browser identifiers for the governed actions", () => {
    for (const id of ["worklist", "card-", "status-", "action-input-", "confirmation", "error"]) {
      expect(worklist).toContain(`visit-marketing-request-${id}`);
    }
    for (const action of ["supervisor-approve", "supervisor-reject", "final-approve", "final-reject", "cancel", "execute"]) expect(worklist).toContain(`\"${action}\"`);
    expect(worklist).toContain("visit-marketing-request-${ACTION_TEST_ID[action]}-${request.id}");
  });

  it("does not require or infer Product or Promotion Group context", () => {
    expect(worklist).not.toMatch(/productId|promotionGroup|firstProduct|products\[0\]/i);
  });

  it("contains no fixed approver role or identity list", () => {
    expect(worklist).not.toMatch(/Medical Supervisor|Medical Manager|Marketing Manager|General Manager|Super Admin|@|uid\s*===\s*["']/);
  });
});
