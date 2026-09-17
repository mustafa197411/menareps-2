import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Role, type Pharmacy, type User } from "../../types";
import { LIBYA_MARKET_DEFAULT } from "../../lib/marketSettings";
import { PharmacyVisitEngine, resolveSelectedPharmacyMarket } from "./PharmacyVisitEngine";

const user = { id: "REP", name: "Representative", role: Role.SALES_REP, active: true, status: "Active" } as User;
const pharmacy = { id: "PHARMACY", name: "Pharmacy", countryId: LIBYA_MARKET_DEFAULT.countryId, areaId: "AREA", active: true } as Pharmacy;

describe("pharmacy visit market currency hydration", () => {
  it("renders a controlled loading state without an application render exception", () => {
    expect(() => renderToStaticMarkup(<PharmacyVisitEngine currentUser={user} authorizedPharmacies={[pharmacy]} entryContext={{ entrySource: "DIRECT_MENU" }} lang="en" marketHydrationOverride={{ status: "LOADING", markets: [] }} />)).not.toThrow();
    expect(renderToStaticMarkup(<PharmacyVisitEngine currentUser={user} authorizedPharmacies={[pharmacy]} entryContext={{ entrySource: "DIRECT_MENU" }} lang="en" marketHydrationOverride={{ status: "LOADING", markets: [] }} />)).toContain("Loading market currency settings");
  });

  it("resolves Libya currency only from hydrated active market settings", () => {
    expect(resolveSelectedPharmacyMarket(pharmacy, { status: "RESOLVED", markets: [LIBYA_MARKET_DEFAULT] })?.currencyCode).toBe("LYD");
  });

  it("returns no currency for genuine missing configuration and renders typed load failure safely", () => {
    expect(resolveSelectedPharmacyMarket(pharmacy, { status: "RESOLVED", markets: [] })).toBeNull();
    const html = renderToStaticMarkup(<PharmacyVisitEngine currentUser={user} authorizedPharmacies={[pharmacy]} entryContext={{ entrySource: "DIRECT_MENU" }} lang="en" marketHydrationOverride={{ status: "CONFIGURATION_ERROR", markets: [], code: "PHARMACY_MARKET_CURRENCY_REQUIRED" }} />);
    expect(html).toContain("PHARMACY_MARKET_CURRENCY_REQUIRED");
  });
});
