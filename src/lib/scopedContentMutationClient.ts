import { auth } from "./firebase";
export async function mutateScopedContent(input: { domain: "CAMPAIGN" | "ACTIVITY" | "PROMOTION_GROUP"; operation: "UPSERT" | "DELETE"; id: string; payload?: Record<string, unknown> }) {
  if (!auth.currentUser) throw new Error("AUTHENTICATION_REQUIRED");
  const response = await fetch("/api/content/mutate", { method: "POST", headers: { Authorization: `Bearer ${await auth.currentUser.getIdToken()}`, "Content-Type": "application/json" }, body: JSON.stringify(input) });
  const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.code || "CONTENT_MUTATION_FAILED"); return body;
}
