import { fetchAuthorizedResourceBlob, type ResourceReadContext } from "./resourceReadClient";

export interface ResourceBinaryReference {
  id?: string;
  resourceId?: string;
  readContext?: ResourceReadContext;
  storagePath?: string;
  mimeType?: string;
  originalFileName?: string;
  fileName?: string;
  sanitizedFileName?: string;
}

export interface ResolvedResourceBinary {
  url: string;
  mimeType: string;
  filename: string;
  cleanup: () => void;
}

export interface ResourceBinaryResolverDependencies {
  fetchStorageBlob?: (storagePath: string) => Promise<Blob>;
  fetchAuthorizedBlob?: (resourceId: string, context: ResourceReadContext) => Promise<{ blob: Blob; filename?: string }>;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  createDownloadAnchor?: () => HTMLAnchorElement;
  appendDownloadAnchor?: (anchor: HTMLAnchorElement) => void;
}

const canonicalFilename = (resource: ResourceBinaryReference): string =>
  resource.originalFileName?.trim()
  || resource.fileName?.trim()
  || resource.sanitizedFileName?.trim()
  || "resource-material";

/** Resolves canonical objects through the independently authorized backend. */
export async function resolveResourceBinary(
  resource: ResourceBinaryReference,
  dependencies: ResourceBinaryResolverDependencies = {},
): Promise<ResolvedResourceBinary> {
  const filename = canonicalFilename(resource);
  const resourceId = resource.resourceId?.trim() || resource.id?.trim();
  if (resourceId && resource.readContext) {
    const createObjectUrl = dependencies.createObjectUrl || URL.createObjectURL.bind(URL);
    const revokeObjectUrl = dependencies.revokeObjectUrl || URL.revokeObjectURL.bind(URL);
    const fetched = dependencies.fetchAuthorizedBlob
      ? await dependencies.fetchAuthorizedBlob(resourceId, resource.readContext)
      : await fetchAuthorizedResourceBlob(resourceId, resource.readContext);
    const blob = fetched.blob;
    const url = createObjectUrl(blob);
    let cleaned = false;
    return {
      url,
      mimeType: blob.type || resource.mimeType || "application/octet-stream",
      filename: fetched.filename || filename,
      cleanup: () => {
        if (cleaned) return;
        cleaned = true;
        revokeObjectUrl(url);
      },
    };
  }
  // Test-only compatibility dependency for the pre-Fix-4 resolver contract.
  if (resource.storagePath?.trim() && dependencies.fetchStorageBlob) {
    const blob = await dependencies.fetchStorageBlob(resource.storagePath.trim()), createObjectUrl = dependencies.createObjectUrl || URL.createObjectURL.bind(URL), revokeObjectUrl = dependencies.revokeObjectUrl || URL.revokeObjectURL.bind(URL), url = createObjectUrl(blob);
    let cleaned = false;
    return { url, mimeType: blob.type || resource.mimeType || "application/octet-stream", filename, cleanup: () => { if (!cleaned) { cleaned = true; revokeObjectUrl(url); } } };
  }
  throw new Error("RESOURCE_AUTHORIZED_CONTEXT_REQUIRED");
}

export async function downloadResourceBinary(
  resource: ResourceBinaryReference,
  dependencies: ResourceBinaryResolverDependencies = {},
): Promise<void> {
  const resolved = await resolveResourceBinary(resource, dependencies);
  try {
    const anchor = dependencies.createDownloadAnchor?.() || document.createElement("a");
    anchor.href = resolved.url;
    anchor.download = resolved.filename;
    anchor.style.display = "none";
    if (dependencies.appendDownloadAnchor) dependencies.appendDownloadAnchor(anchor);
    else document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    resolved.cleanup();
  }
}
