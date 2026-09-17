import type { SampleSku } from "../types";
import { sanitizeAndAuditPayload } from "../utils/importNormalization";
import { decorateRecord } from "./firebaseSync";

type SampleWriteAction = "create" | "update";

function validateSampleCatalogPayload(payload: Partial<SampleSku>): string[] {
  const errors: string[] = [];
  if (!payload.id?.trim()) errors.push("id is required");
  if (!payload.productId?.trim()) errors.push("productId is required");
  if (!payload.name?.trim()) errors.push("name is required");
  if (!payload.descriptor?.trim()) errors.push("descriptor is required");
  if (!payload.status) errors.push("status is required");
  if (typeof payload.active !== "boolean") errors.push("active must be boolean");
  if (payload.unitsPerPack !== undefined && (!Number.isInteger(payload.unitsPerPack) || payload.unitsPerPack <= 0)) errors.push("unitsPerPack must be a positive integer");
  return errors;
}

export function prepareSampleCatalogWrite(
  sample: SampleSku,
  actorId: string,
  action: SampleWriteAction = "create"
): Record<string, unknown> {
  const decorated = decorateRecord(sample, actorId, action);
  return sanitizeAndAuditPayload("sampleCatalog", sample.id, decorated, validateSampleCatalogPayload) as unknown as Record<string, unknown>;
}

export function prepareSampleWrite<T extends object>(
  collectionName: string,
  documentId: string,
  record: T,
  actorId: string,
  action: SampleWriteAction
): T {
  return sanitizeAndAuditPayload(collectionName, documentId, decorateRecord(record, actorId, action));
}
