import { type Product, type User } from "../types";
import type { OperationalScopeSessionState } from "./operationalScopeSession";
import { filterProductsByCanonicalAuthority } from "./productMarketingAuthority";

export interface ProductListPresentationFilters {
  searchTerm: string;
  selectedPromotionType: string;
  selectedBrand: string;
  sortOrder: string;
  showInactive: boolean;
  showUat: boolean;
}

/**
 * Applies canonical product authorization before any Product List presentation
 * filtering. All roles fail closed unless a backend-issued scope belongs to
 * the authenticated actor and authorizes each product.
 */
export function authorizeProductListProducts({
  currentUser,
  products,
  operationalScopeSession,
}: {
  currentUser: User;
  products: Product[];
  operationalScopeSession: OperationalScopeSessionState;
}): Product[] {
  return filterProductsByCanonicalAuthority({ user: currentUser, operationalScopeSession }, products);
}

/** Presentation-only processing; input must already be authorization-filtered. */
export function filterProductListForPresentation(
  products: Product[],
  filters: ProductListPresentationFilters,
): Product[] {
  const search = filters.searchTerm.toLowerCase();
  const list = products.filter((product) => {
    if (!filters.showInactive && product.isActive === false) return false;
    if (!filters.showUat && product.isTestData === true) return false;

    const codeValue = product.sku || product.code || product.id.replace(/[A-Za-z]/g, "") || "306";
    const matchesSearch =
      product.name.toLowerCase().includes(search)
      || Boolean(product.brand?.toLowerCase().includes(search))
      || Boolean(product.promotionGroupName?.toLowerCase().includes(search))
      || Boolean(product.productFamily?.toLowerCase().includes(search))
      || codeValue.toLowerCase().includes(search)
      || Boolean(product.description?.toLowerCase().includes(search));
    const matchesPromotion = filters.selectedPromotionType === "All"
      || product.therapeuticArea === filters.selectedPromotionType;
    const matchesBrand = filters.selectedBrand === "All"
      || product.brand === filters.selectedBrand
      || product.promotionGroupName === filters.selectedBrand;
    return matchesSearch && matchesPromotion && matchesBrand;
  });

  if (filters.sortOrder === "price-asc") list.sort((a, b) => a.price - b.price);
  else if (filters.sortOrder === "price-desc") list.sort((a, b) => b.price - a.price);
  else if (filters.sortOrder === "stock-asc") list.sort((a, b) => a.stock - b.stock);
  else if (filters.sortOrder === "stock-desc") list.sort((a, b) => b.stock - a.stock);
  return list;
}
