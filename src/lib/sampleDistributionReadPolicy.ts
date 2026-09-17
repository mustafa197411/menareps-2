import type { Permissions, SampleDistribution, User, UserProductAssignment } from "../types";
import { getAuthorizedSampleUserIds, getSampleDataScope, hasSampleCapability } from "./sampleAuthorization";

export function canAttachSampleBatchListener(user: Pick<User, "role">, permissions?: Permissions): boolean {
  return hasSampleCapability(user, "VIEW_SAMPLE_INVENTORY", permissions)
    || hasSampleCapability(user, "APPROVE_SAMPLE_REQUEST", permissions);
}

type ReadableDistribution = SampleDistribution & { isDeleted?: boolean; active?: boolean; status?: string };

export function filterAuthorizedSampleDistributions<T extends ReadableDistribution>(params: {
  actor: User;
  users: readonly User[];
  distributions: readonly T[];
  productAssignments: readonly UserProductAssignment[];
  permissions?: Permissions;
}): T[] {
  const { actor, users, distributions, productAssignments, permissions } = params;
  const scope = getSampleDataScope(actor, "VIEW_PHYSICIAN_SAMPLE_HISTORY", permissions);
  const authorizedRepIds = new Set(getAuthorizedSampleUserIds(actor, users, scope));
  const activeProductIds = new Set(productAssignments
    .filter(assignment => assignment.userId === actor.id && assignment.status === "Active" && assignment.active !== false)
    .map(assignment => assignment.productId));
  const applyProductScope = scope === "OWN";

  return distributions.filter(distribution =>
    distribution.isDeleted !== true
    && distribution.active !== false
    && distribution.status !== "INACTIVE"
    && authorizedRepIds.has(distribution.repId)
    && (!applyProductScope || activeProductIds.has(distribution.productId))
  );
}
