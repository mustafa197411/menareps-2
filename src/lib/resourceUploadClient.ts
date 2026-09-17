import { auth } from "./firebase";
import type { UploadProgress } from "./resourceMaterialService";

async function token(): Promise<string> {
  const current = auth.currentUser;
  if (!current) throw new Error("RESOURCE_AUTHENTICATION_REQUIRED");
  return current.getIdToken();
}
async function json(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.code || "RESOURCE_UPLOAD_FAILED");
  return body;
}

export async function uploadAcademicResourceThroughBackend(input: {
  file: File; promotionGroupId: string; productIds: string[]; metadata: Record<string, unknown>; replaceResourceId?: string; onProgress?: (progress: UploadProgress) => void;
}) {
  const mimeType = typeof input.metadata.mimeType === "string" && input.metadata.mimeType
    ? input.metadata.mimeType
    : input.file.type;
  const authorization = await json(await fetch("/api/resources/uploads/initiate", {
    method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ promotionGroupId: input.promotionGroupId, productIds: input.productIds, originalFileName: input.file.name, mimeType, expectedSize: input.file.size, metadata: input.metadata, replaceResourceId: input.replaceResourceId }),
  }));
  input.onProgress?.({ percentage: 0, bytesTransferred: 0, totalBytes: input.file.size, status: "UPLOADING" });
  const response = await fetch(authorization.uploadSessionUri, { method: "PUT", headers: { "Content-Type": mimeType, "Content-Range": `bytes 0-${input.file.size - 1}/${input.file.size}` }, body: input.file });
  if (!response.ok) throw new Error("RESOURCE_BINARY_UPLOAD_FAILED");
  input.onProgress?.({ percentage: 100, bytesTransferred: input.file.size, totalBytes: input.file.size, status: "COMPLETE" });
  return json(await fetch("/api/resources/uploads/finalize", { method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" }, body: JSON.stringify({ authorizationId: authorization.authorizationId }) }));
}

export async function mutateAcademicResourceMetadata(resourceId: string, patch: Record<string, unknown>) {
  return json(await fetch("/api/resources/metadata/mutate", { method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" }, body: JSON.stringify({ resourceId, patch }) }));
}
