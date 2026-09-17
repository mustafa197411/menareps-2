import type { KeyMessage, Physician, Product, PhysicianVisitDetailing } from "../types";

type VisitProductDisplayFields = Partial<PhysicianVisitDetailing> & {
  productName?: string;
  brand?: string;
};

export function resolveCanonicalVisitProduct(
  detailing: VisitProductDisplayFields,
  products: readonly Product[]
): Product | undefined {
  if (!detailing.productId) return undefined;
  return products.find(product => product.id === detailing.productId);
}

export function resolveCanonicalVisitProductName(
  detailing: VisitProductDisplayFields,
  products: readonly Product[]
): string {
  return resolveCanonicalVisitProduct(detailing, products)?.name ||
    detailing.productName ||
    detailing.brandName ||
    detailing.brand ||
    detailing.productId ||
    "Product";
}

export function resolveCanonicalPhysicianAlignedProducts(
  physician: Pick<Physician, "alignedProductIds" | "primaryPromotionGroupId" | "targetPromotionGroupIds">,
  products: readonly Product[]
): Product[] {
  const alignedIds = new Set(physician.alignedProductIds || []);
  const promotionGroupIds = new Set([
    physician.primaryPromotionGroupId,
    ...(physician.targetPromotionGroupIds || [])
  ].filter((id): id is string => Boolean(id)));

  return products.filter(product =>
    alignedIds.has(product.id) &&
    product.isActive !== false &&
    Boolean(product.promotionGroupId) &&
    promotionGroupIds.has(product.promotionGroupId!)
  );
}

export function getPersistedDetailingKeyMessageIds(
  detailing: Pick<PhysicianVisitDetailing, "keyMessageIds" | "presentedKeyMessages">
): string[] {
  const source = Array.isArray(detailing.keyMessageIds)
    ? detailing.keyMessageIds
    : detailing.presentedKeyMessages || [];
  return [...new Set(source.filter(Boolean))];
}

export function resolveDetailingKeyMessages(
  detailing: Pick<PhysicianVisitDetailing, "keyMessageIds" | "presentedKeyMessages">,
  keyMessages: readonly KeyMessage[],
  lang: "en" | "ar" = "en"
): Array<{ id: string; text: string }> {
  return getPersistedDetailingKeyMessageIds(detailing).map(id => {
    const master = keyMessages.find(message => message.id === id);
    const text = lang === "ar"
      ? master?.messageAr || master?.message || id
      : master?.message || master?.messageAr || id;
    return { id, text };
  });
}
