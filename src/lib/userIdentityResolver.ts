import { User } from "../types";

export function resolveUserIdentity(
  userId: string | null | undefined,
  users: Partial<User>[],
  fallback = "Unknown user"
): string {
  const canonicalId = userId?.trim();
  if (!canonicalId) return fallback;
  const user = users.find((candidate) => candidate.id === canonicalId || candidate.uid === canonicalId);
  if (!user) return fallback;
  return user.name?.trim() || user.email?.trim() || fallback;
}
