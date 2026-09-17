import { PharmacyBalancePreview } from "../types/domain";

export function calculateBalancePreview(
  outstandingBalanceBefore: number,
  currentVisitNetTotal: number,
  paymentAmount: number,
  currency: string
): PharmacyBalancePreview {
  const safeBefore = isNaN(outstandingBalanceBefore) ? 0 : outstandingBalanceBefore;
  const safeNetOrder = isNaN(currentVisitNetTotal) ? 0 : currentVisitNetTotal;
  const safePayment = isNaN(paymentAmount) || paymentAmount < 0 ? 0 : paymentAmount;

  const totalDue = Math.round((safeBefore + safeNetOrder) * 100) / 100;
  const roundedPayment = Math.round(safePayment * 100) / 100;
  const projectedBalanceAfter = Math.round((totalDue - roundedPayment) * 100) / 100;

  const isOverpayment = roundedPayment > totalDue;
  const overpaymentAmount = isOverpayment ? Math.round((roundedPayment - totalDue) * 100) / 100 : undefined;

  const preview: PharmacyBalancePreview = {
    outstandingBalanceBefore: safeBefore,
    currentVisitNetTotal: safeNetOrder,
    paymentAmount: roundedPayment,
    projectedBalanceAfter,
    currency,
    formula: "before + netOrder - payment",
    isOverpayment,
    overpaymentAmount,
    backendRevalidationRequired: true
  };

  console.info(
    "[PHARMACY_VISIT_BALANCE_PREVIEW_JSON]",
    JSON.stringify(preview)
  );

  return preview;
}
