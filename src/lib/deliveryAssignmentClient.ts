import type { User as FirebaseUser } from "firebase/auth";

export interface DeliveryOfficerSelectorDto {
  uid: string;
  name: string;
  email: string;
  role: "Delivery Officer";
  managerId: string;
  country: string;
  readiness: "COMPLETE";
}

export interface DeliveryOfficerDirectoryResponse {
  authorized: boolean;
  code?: string;
  officers: DeliveryOfficerSelectorDto[];
}

async function bearer(user: Pick<FirebaseUser, "getIdToken">): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" };
}

export async function fetchEligibleDeliveryOfficers(
  user: Pick<FirebaseUser, "getIdToken">,
  fetchImplementation: typeof fetch = fetch,
): Promise<DeliveryOfficerDirectoryResponse> {
  const response = await fetchImplementation("/api/orders/delivery-officers", { method: "GET", headers: await bearer(user) });
  const payload = await response.json();
  if (!payload || typeof payload.authorized !== "boolean" || !Array.isArray(payload.officers)) throw new Error("Malformed delivery-officer directory response");
  return payload;
}

export async function executeDeliveryAssignment(
  user: Pick<FirebaseUser, "getIdToken">,
  request: { orderId: string; deliveryOfficerUid: string; plannedDeliveryDate: string; plannedDeliveryWindow?: string; comments?: string },
  fetchImplementation: typeof fetch = fetch,
): Promise<{ success: boolean; code?: string; orderId?: string; currentStatus?: string; stage?: string; deliveryOfficerUid?: string }> {
  const response = await fetchImplementation("/api/orders/delivery-assign", {
    method: "POST", headers: await bearer(user), body: JSON.stringify(request),
  });
  const payload = await response.json();
  if (!payload || typeof payload.success !== "boolean") throw new Error("Malformed delivery assignment response");
  return payload;
}
