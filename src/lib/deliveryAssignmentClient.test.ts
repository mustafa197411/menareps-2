import { describe, expect, it, vi } from "vitest";
import { executeDeliveryAssignment, fetchEligibleDeliveryOfficers } from "./deliveryAssignmentClient";

const user = { getIdToken: vi.fn(async () => "TOKEN") };

describe("WP76C delivery assignment client", () => {
  it("sends bearer token to the bounded directory endpoint", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ authorized: true, officers: [] })));
    await fetchEligibleDeliveryOfficers(user, fetcher as typeof fetch);
    expect(fetcher).toHaveBeenCalledWith("/api/orders/delivery-officers", expect.objectContaining({ method: "GET", headers: expect.objectContaining({ Authorization: "Bearer TOKEN" }) }));
  });
  it("sends only canonical assignment inputs", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ success: true })));
    await executeDeliveryAssignment(user, { orderId: "O1", deliveryOfficerUid: "DO1", plannedDeliveryDate: "2026-08-14" }, fetcher as typeof fetch);
    expect(JSON.parse(fetcher.mock.calls[0][1].body as string)).toEqual({ orderId: "O1", deliveryOfficerUid: "DO1", plannedDeliveryDate: "2026-08-14" });
  });
});
