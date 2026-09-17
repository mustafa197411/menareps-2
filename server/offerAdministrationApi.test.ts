import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transpileModule, ScriptTarget, JsxEmit } from "typescript";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../src/components/sales/SalesOffers.tsx", import.meta.url), "utf8");
const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

describe("Offer administration API contract", () => {
  it("protects list, detail, create and lifecycle commands with the established Firebase middleware", () => {
    expect(server).toContain('app.get("/api/offers", requireFirebaseAuth');
    expect(server).toContain('app.get("/api/offers/:offerId", requireFirebaseAuth');
    expect(server).toContain('app.post("/api/offers/drafts", requireFirebaseAuth');
    expect(server).toContain('app.post("/api/offers/actions", requireFirebaseAuth');
  });

  it("reserves stale GET /drafts before the dynamic Offer detail route", () => {
    const stale = 'app.get("/api/offers/drafts", requireFirebaseAuth';
    const detail = 'app.get("/api/offers/:offerId", requireFirebaseAuth';
    expect(server).toContain(stale);
    expect(server.indexOf(stale)).toBeLessThan(server.indexOf(detail));
    expect(server).toContain('code: "OFFER_LIST_ENDPOINT_REQUIRED"');
  });

  it("authenticates bounded option routes before detail capture", () => {
    for (const route of ['app.get("/api/offers/product-options", requireFirebaseAuth', 'app.post("/api/offers/representative-options", requireFirebaseAuth']) {
      expect(server).toContain(route);
      expect(server.indexOf(route)).toBeLessThan(server.indexOf('app.get("/api/offers/:offerId"'));
    }
    expect(server).not.toContain('/api/offers/commercial-options');
    expect(server).toContain('parseOfferRepresentativeRequest(req.body)');
    expect(server).toContain('parseOfferProductRequest(req.query)');
  });

  it("sanitizes expected and unexpected errors", () => {
    expect(server).toContain('json({ code: error.code })');
    expect(server).toContain('json({ code: "OFFER_READ_FAILED" })');
    expect(server).toContain('fallbackCode = "OFFER_WRITE_FAILED"');
    expect(server).toContain('json({ code: fallbackCode })');
    const candidates = server.slice(server.indexOf('app.get("/api/offers/product-options"'), server.indexOf("const productConfigurationActor"));
    expect(candidates.match(/offerError\(res, error, "OFFER_READ_FAILED"\)/g)).toHaveLength(2);
  });

  it("uses backend-only Firestore access and no browser persistence", () => {
    expect(rules).toMatch(/match \/offers\/\{offerId\}[\s\S]*?allow read, create, update, delete: if false/);
    expect(page).not.toContain("localStorage");
    expect(page).toContain("listAdminOffers");
    expect(page).toContain("OFFER_STALE_REVISION_REFRESH");
  });

  it("separates Offer hierarchy dependencies from preserved Product commercial configuration", () => {
    expect(server).toContain("createOfferDraft(actor, definition, offerRepository, offerHierarchyRepository)");
    expect(server).toContain("mutateOffer(actor, command, offerRepository, offerHierarchyRepository)");
    expect(server).toContain("listOffers(actor, offerRepository, offerHierarchyRepository, req.query)");
    expect(server).toContain("createFirestoreCommercialMarketRegistryRepository(firebaseAdmin.db)");
    expect(server).toContain("await productConfigurationActor(req)");
    expect(server).toContain("offerCommercialDependencies");
    expect(server).not.toContain("createOfferDraft(actor, definition, offerRepository, offerCommercialDependencies)");
  });

  it("renders loading, empty, denied, retry, capability and lifecycle states", () => {
    expect(page).toContain("Loading Offers…");
    expect(page).toContain("No offers found");
    expect(page).toContain("You do not have permission to administer Offers.");
    expect(page).toContain("Retry");
    for (const capability of ["offers.create", "offers.editDraft", "offers.submit", "offers.approve", "offers.activate", "offers.pause", "offers.cancel"]) expect(page).toContain(capability);
    for (const action of ["SUBMIT", "RETURN_TO_DRAFT", "APPROVE", "ACTIVATE", "PAUSE", "REACTIVATE", "CANCEL"]) expect(page).toContain(action);
  });

  it("does not expose deletion or Pharmacy Visit application operations", () => {
    expect(server).not.toContain('app.delete("/api/offers');
    expect(page).not.toContain("applyDuringVisit\"] &&");
  });
});

describe("pending approval action rendering", () => {
  function markup(status: string, approvedAt?: string, allowed = true) {
    const source = page.slice(page.indexOf("function OfferActions("), page.indexOf("function OfferRow("));
    const code = transpileModule(source, { compilerOptions: { target: ScriptTarget.ES2022, jsx: JsxEmit.React }, fileName: "actions.tsx" }).outputText;
    const Actions = new Function("React", "isLegacyOffer", code + "; return OfferActions;")(React, () => false);
    return renderToStaticMarkup(React.createElement(Actions, { offer: { lifecycleStatus: status, canonical: { approvedAt }, name: "Synthetic", type: "PRODUCT_PERCENTAGE" }, rtl: false, capabilities: { "offers.approve": allowed, "offers.activate": true }, onEdit: () => {}, onAction: () => {} }));
  }
  it.each([undefined, "2026-01-01T00:00:00Z"])("shows Approve for pending state even with prior approval %s", approvedAt => {
    const html = markup("PENDING_APPROVAL", approvedAt);
    expect(html).toContain(">Approve</button>");
    expect(html).not.toContain(">Activate</button>");
  });
  it("hides Approve when permission is denied or the lifecycle is already active/scheduled", () => {
    expect(markup("PENDING_APPROVAL", undefined, false)).not.toContain(">Approve</button>");
    for (const status of ["ACTIVE", "SCHEDULED"]) expect(markup(status)).not.toContain(">Approve</button>");
  });
});
