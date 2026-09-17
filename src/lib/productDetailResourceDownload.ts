import { downloadResourceBinary, type ResourceBinaryReference } from "./resourceBinaryResolver";

export type ProductDetailResourceDownloader = (resource: ResourceBinaryReference) => Promise<void>;

/** UI concurrency guard; the trusted backend remains authoritative for every retrieval. */
export async function runProductDetailResourceDownload(
  resource: ResourceBinaryReference,
  inFlightResourceIds: Set<string>,
  downloader: ProductDetailResourceDownloader = downloadResourceBinary,
): Promise<boolean> {
  const resourceId = resource.resourceId?.trim() || resource.id?.trim() || "";
  if (!resourceId || resource.readContext?.purpose !== "PRODUCT_DETAIL" || !resource.readContext.productId.trim()) {
    throw new Error("PRODUCT_DETAIL_RESOURCE_CONTEXT_REQUIRED");
  }
  if (inFlightResourceIds.has(resourceId)) return false;
  inFlightResourceIds.add(resourceId);
  try {
    await downloader(resource);
    return true;
  } finally {
    inFlightResourceIds.delete(resourceId);
  }
}
