import { describe, expect, it } from "vitest";
import { classifyInventoryContract, INVENTORY_CONTRACT_INTEGRITY_ERROR } from "./inventoryContractClassifier";

const tenants = [
  { companyId: "COMPANY-ALPHA", countryId: "COUNTRY-ALPHA", marketId: "MARKET-ALPHA", userId: "USER-ALPHA", orderId: "ORDER-ALPHA" },
  { companyId: "COMPANY-BETA", countryId: "COUNTRY-BETA", marketId: "MARKET-BETA", userId: "USER-BETA", orderId: "ORDER-BETA" },
] as const;

const order = (tenant: typeof tenants[number], inventoryContractVersion: unknown, reservationEvidence = false) => ({
  ...tenant,
  inventoryContractVersion,
  ...(reservationEvidence ? { reservationIds: [`RESERVATION-${tenant.orderId}`], physicalDemand: [{ productId: `PRODUCT-${tenant.companyId}` }] } : {}),
});

describe("shared fail-closed inventory contract classifier", () => {
  it.each(tenants)("classifies numeric and normalized string Version 2 for $companyId", tenant => {
    expect(classifyInventoryContract(order(tenant, 2, true)).kind).toBe("VERSION_2");
    expect(classifyInventoryContract(order(tenant, " 2 ", true)).kind).toBe("VERSION_2");
  });

  it.each([undefined, null, ""])("fails closed for reservation-backed missing marker %s", version => {
    expect(classifyInventoryContract(order(tenants[0], version, true))).toMatchObject({ kind: "INTEGRITY_ERROR", code: INVENTORY_CONTRACT_INTEGRITY_ERROR });
  });

  it.each(["two", "02", "2.0", 3, {}, false])("rejects malformed or unsupported marker %s", version => {
    expect(classifyInventoryContract(order(tenants[0], version, false)).kind).toBe("INTEGRITY_ERROR");
  });

  it.each([{ reservationIds: [null] }, { reservationIds: {} }, { physicalDemand: {} }, { inventoryReservationId: 123 }])(
    "treats malformed non-empty reservation metadata as fail-closed evidence: %j",
    evidence => {
      expect(classifyInventoryContract({ ...order(tenants[0], undefined, false), ...evidence })).toMatchObject({ kind: "INTEGRITY_ERROR", reservationEvidence: true });
    },
  );

  it("rejects explicit legacy metadata that conflicts with reservation evidence", () => {
    expect(classifyInventoryContract(order(tenants[1], 1, true))).toMatchObject({ kind: "INTEGRITY_ERROR", reservationEvidence: true });
  });

  it.each([undefined, null, "", 1, "1"])("preserves genuine legacy orders without reservation evidence for marker %s", version => {
    expect(classifyInventoryContract(order(tenants[1], version, false))).toMatchObject({ kind: "LEGACY", legacy: true });
  });
});
