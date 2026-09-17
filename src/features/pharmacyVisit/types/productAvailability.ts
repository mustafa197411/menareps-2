export type ProductAvailabilityState = "AVAILABLE" | "OUT_OF_STOCK" | "UNAVAILABLE_ERROR" | "UNRESOLVED_CONTEXT";

export interface ProductAvailability {
  productId: string;
  availabilityState: ProductAvailabilityState;
  canOrder: boolean;
  shortageEligible: boolean;
  showNumericStock: boolean;
  actualAvailableQty?: number;
  code?: string;
}

export function unresolvedAvailability(productId: string, code: string, state: ProductAvailabilityState = "UNAVAILABLE_ERROR"): ProductAvailability {
  return { productId, availabilityState: state, canOrder: false, shortageEligible: false, showNumericStock: false, code };
}
