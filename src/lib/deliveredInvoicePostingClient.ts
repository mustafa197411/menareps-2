import type { User as FirebaseUser } from "firebase/auth";

export async function postDeliveredInvoice(firebaseUser: FirebaseUser, orderId: string) {
  const token = await firebaseUser.getIdToken();
  const response = await fetch("/api/ar/delivered-invoice", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ orderId }),
  });
  const result = await response.json().catch(() => ({ success: false, code: "INVALID_RESPONSE" }));
  if (!response.ok) return { ...result, success: false };
  return result;
}
