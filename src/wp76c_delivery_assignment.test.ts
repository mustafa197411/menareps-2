import fs from "node:fs";
import { describe, expect, it } from "vitest";

const sales = () => fs.readFileSync(new URL("./components/sales/SalesOrders.tsx", import.meta.url), "utf8");
const server = () => fs.readFileSync(new URL("../server.ts", import.meta.url), "utf8");

describe("WP76C bounded UI and queue integration", () => {
  it("Store selector consumes authenticated server directory", () => expect(sales()).toContain("fetchEligibleDeliveryOfficers(firebaseUser)"));
  it("assignment path consumes server transition", () => expect(sales()).toContain("executeDeliveryAssignment(firebaseUser"));
  it("no client workflow-engine DELIVERY_ASSIGN execution remains", () => expect(sales()).not.toContain('action: "DELIVERY_ASSIGN",\n        actor:'));
  it("assignment path has no mock directory or obsolete UID", () => {
    const source = sales();
    expect(source).not.toContain("deliveryOfficerDirectory");
    expect(source).not.toContain("m6Fh80WOI1P4gEBNihu6lnSMoWd2");
    expect(source).not.toContain("9gfh5EyhTNtRlWdPkExY");
    expect(source).not.toContain("initialUsers");
  });
  it("Delivery Officer queue is resolved by the backend commercial scope", () => expect(sales()).toContain('fetchScopedCommercialRead(auth.currentUser, { kind: "ORDERS" })'));
  it("Delivery Officer visibility has no name fallback", () => expect(sales()).not.toContain("assignment.deliveryOfficerName.toLowerCase() === currentUser.name.toLowerCase()"));
  it("both new routes require Firebase authentication", () => {
    expect(server()).toContain('app.get("/api/orders/delivery-officers", requireFirebaseAuth');
    expect(server()).toContain('app.post("/api/orders/delivery-assign", requireFirebaseAuth');
  });
});
