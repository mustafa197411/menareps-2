import { assertCustomerCertification, certifiedReceivable, isCanonicalPostingInstant } from "./financialSettlementService";
import { Role, normalizeRole } from "../src/types";
import { calculateDueDate, generateCustomerAccountNumber, financialMinorUnits } from "../src/features/ar/arResolvers";
import {
  createFirestoreDeliveredInvoicePostingRepository,
  type DeliveredInvoicePostingRepository,
  type DeliveredInvoiceTransactionContext,
} from "./deliveredInvoicePostingRepository";
import { resolveFinancialIdentity } from "../src/lib/financialIdentity";
import { validateMarketSettings, resolveMarketForIdentity, type MarketBusinessSettings } from "../src/lib/marketSettings";

export interface DeliveredInvoicePostRequest { orderId: string }
export interface DeliveredInvoicePostResult {
  success: boolean; posted: boolean; code?: string; orderId?: string; invoiceId?: string; ledgerEntryId?: string;
}

interface Dependencies { repository: DeliveredInvoicePostingRepository; now(): string }
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

export function parseDeliveredInvoicePostRequest(input: unknown): DeliveredInvoicePostRequest | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some((key) => key !== "orderId")) return null;
  const orderId = text(body.orderId);
  return orderId && orderId.length <= 512 ? { orderId } : null;
}

function actorOperational(actor: Record<string, any> | null): boolean {
  const statuses = [actor?.status, actor?.accountStatus, actor?.employmentStatus]
    .map((value) => text(value).toUpperCase()).filter(Boolean);
  return Boolean(actor) && actor!.active !== false && actor!.loginAllowed === true && actor!.isDeleted !== true
    && statuses.every((status) => status === "ACTIVE" || status === "OPERATIONAL");
}

function safePart(value: string): string { return value.replace(/[^a-zA-Z0-9_-]/g, "_"); }

export async function postDeliveredInvoiceServer(
  authenticatedActorUid: string,
  request: DeliveredInvoicePostRequest,
  overrides?: Partial<Dependencies>,
): Promise<DeliveredInvoicePostResult> {
  const deps: Dependencies = {
    repository: overrides?.repository || createFirestoreDeliveredInvoicePostingRepository(),
    now: overrides?.now || (() => new Date().toISOString()),
  };
  return deps.repository.runTransaction(authenticatedActorUid, request.orderId, context => prepareDeliveredInvoicePosting(authenticatedActorUid, context, deps.now));
}

/** Reuses the existing validated posting policy within a caller-owned transaction. */
export function prepareDeliveredInvoicePosting(authenticatedActorUid: string, context: DeliveredInvoiceTransactionContext, nowProvider: () => string): DeliveredInvoicePostResult {
    if (!actorOperational(context.actor)) return { success: false, posted: false, code: context.actor ? "ACTOR_INACTIVE" : "ACTOR_NOT_FOUND" };
    if (!context.order) return { success: false, posted: false, code: "ORDER_NOT_FOUND" };
    const order = context.order;
    const invoiceId = text(order.invoiceNumber) || text(order.commercialInvoiceNumber) || text(order.invoiceId) || `INV-${text(order.displayNumber) || order.id}`;
    const ledgerEntryId = context.ledgerId;
    const role = normalizeRole(context.actor.role);
    const assignedDeliveryActor = role === Role.DELIVERY_OFFICER && text(order.deliveryOfficerUid) === authenticatedActorUid;
    const privilegedActor = [Role.FINANCE, Role.ADMIN, Role.SUPER_ADMIN, Role.GENERAL_MANAGER].includes(role as Role);
    if (!assignedDeliveryActor && !privilegedActor) return { success: false, posted: false, code: "ACTOR_NOT_AUTHORIZED" };
    if (text(order.status).toUpperCase() !== "DELIVERED" || text(order.stage).toUpperCase() !== "CLOSED") {
      return { success: false, posted: false, code: "ORDER_NOT_DELIVERED" };
    }

    const pharmacyId = text(order.pharmacyId) || text(order.pharmacy);
    const amount = order.grandTotal ?? order.total ?? order.netTotal ?? order.totalAmount ?? order.subtotal;
    if (!pharmacyId) return { success: false, posted: false, code: "MISSING_PHARMACY_ID" };
    if (!(amount > 0)) return { success: false, posted: false, code: "INVALID_AMOUNT" };
    const market = context.market as unknown as MarketBusinessSettings | null;
    if (!market || market.active !== true || validateMarketSettings(market).length > 0) {
      return { success: false, posted: false, code: "FINANCIAL_MARKET_CURRENCY_REQUIRED" };
    }
    const financialIdentity = resolveFinancialIdentity(
      [order, context.profile || {}, context.pharmacy || {}] as Array<Record<string, unknown>>,
      [market],
    );
    if (!financialIdentity) return { success: false, posted: false, code: "FINANCIAL_MARKET_CURRENCY_REQUIRED" };
    const initializationRequired = () => { throw new Error("FINANCIAL_PROJECTION_INITIALIZATION_REQUIRED"); };
    if ((text(order.pharmacyId) && text(order.pharmacy) && text(order.pharmacyId) !== text(order.pharmacy))
      || !context.pharmacy || context.pharmacy.id !== pharmacyId) initializationRequired();
    // Validate every supplied identity, rather than allowing an earlier source to mask a conflict.
    for (const record of [order, context.pharmacy!, ...(context.profile ? [context.profile] : [])]) {
      if ((record.country !== undefined && (!text(record.country) || !resolveMarketForIdentity([market], { country: text(record.country) })))
        || (record.marketId !== undefined && record.marketId !== financialIdentity.marketId)
        || (record.countryId !== undefined && record.countryId !== financialIdentity.countryId)
        || (record.currencyCode !== undefined && record.currencyCode !== financialIdentity.currencyCode)
        || (record.currency !== undefined && record.currency !== financialIdentity.currencyCode)) initializationRequired();
    }
    const identity = { pharmacyId, marketId: financialIdentity.marketId, currencyCode: financialIdentity.currencyCode, decimalPlaces: market.decimalPlaces };
    if (financialMinorUnits(amount, identity.decimalPlaces) <= 0) throw new Error("INVALID_FINANCIAL_AMOUNT");
    if (context.profile) {
      assertCustomerCertification(context.profile.id, context.profile, identity);
    }
    if (context.existingLedger) {
      if (!context.profile) initializationRequired();
      const existing = certifiedReceivable(ledgerEntryId, context.existingLedger, identity);
      if (existing.orderId !== order.id || existing.originalAmount !== amount
        || context.existingLedger.invoiceId !== invoiceId || context.existingLedger.sourceId !== order.id
        || context.existingLedger.debitAmount !== amount || context.existingLedger.creditAmount !== 0
        || context.existingLedger.netAmount !== amount || context.existingLedger.isReversal !== false
        || context.existingLedger.reversesEntryId !== null) initializationRequired();
      return { success: true, posted: false, code: "ALREADY_POSTED", orderId: order.id, invoiceId, ledgerEntryId };
    }
    if (!context.profile) {
      const balance = context.pharmacy!.outstandingBalance;
      if (balance !== undefined && (typeof balance !== "number" || !Number.isFinite(balance) || balance !== 0)) initializationRequired();
      const evidence = context.certificationEvidence;
      if (!evidence) initializationRequired();
      for (const key of ["ledger", "collections", "payments", "visits", "orders", "legacyOrders"] as const) {
        const ids = evidence![key];
        const isOrder = key === "orders" || key === "legacyOrders";
        if (!Array.isArray(ids) || ids.length > (isOrder ? 2 : 1)
          || ids.some(id => typeof id !== "string" || !id || (!isOrder || id !== order.id))) initializationRequired();
      }
    }
    const now = nowProvider();
    if (!isCanonicalPostingInstant(now)) throw new Error("INVALID_POSTING_INSTANT");
    const postingDate = text(order.deliveredAt || order.date || order.createdAt || now).slice(0, 10);
    const paymentTermCode = context.profile?.paymentTermCode || "CASH";
    const paymentTermDays = Number(context.profile?.paymentTermDays ?? 0);
    const accountNumber = context.profile?.customerAccountNumber || generateCustomerAccountNumber({ ...(context.pharmacy || {}), ...financialIdentity, id: pharmacyId }, [market]);
    const ledger = {
      id: ledgerEntryId, pharmacyId, customerAccountNumber: accountNumber, orderId: order.id,
      orderNumber: text(order.displayNumber) || text(order.orderNumber) || order.id,
      invoiceId, invoiceNumber: invoiceId, transactionType: "INVOICE", sourceType: "DELIVERED_ORDER", sourceId: order.id,
      description: `Commercial Invoice ${invoiceId} for Delivered Order #${text(order.displayNumber) || order.id}`,
      debitAmount: amount, creditAmount: 0, netAmount: amount, currency: financialIdentity.currencyCode, currencyCode: financialIdentity.currencyCode, marketId: financialIdentity.marketId, countryId: financialIdentity.countryId, postingDate,
      dueDate: calculateDueDate(postingDate, paymentTermCode, paymentTermDays),
      paymentTermCodeSnapshot: paymentTermCode, paymentTermDaysSnapshot: paymentTermDays,
      invoiceOriginalAmount: amount, invoiceAppliedAmount: 0, invoiceCreditedAmount: 0, invoiceOpenAmount: amount,
      isOpen: true, revision: 1, projectionVersion: 1, decimalPlaces: market.decimalPlaces,
      status: "POSTED", isReversal: false, reversesEntryId: null,
      idempotencyKey: `DELIVERED_INVOICE_${order.id}_${invoiceId}`,
      createdAt: now, createdByUid: authenticatedActorUid,
      createdByName: text(context.actor.name) || text(context.actor.fullName) || text(context.actor.email),
    };
    const existing: Record<string, any> = context.profile || {};
    if (context.profile) {
      for (const field of ["outstandingBalance", "totalInvoiced"]) financialMinorUnits(existing[field], market.decimalPlaces);
      if (!Number.isSafeInteger(existing.openInvoiceCount) || existing.openInvoiceCount < 0) throw new Error("FINANCIAL_PROFILE_RECONCILIATION_REQUIRED");
    }
    const profile = {
      ...(!context.profile ? {
        pharmacyId, pharmacyName: context.pharmacy?.name || context.pharmacy?.pharmacyName || `Pharmacy ${pharmacyId.slice(-4)}`,
        customerAccountNumber: accountNumber, currency: financialIdentity.currencyCode, currencyCode: financialIdentity.currencyCode, marketId: financialIdentity.marketId, countryId: financialIdentity.countryId, paymentTermCode, paymentTermDays,
        openingBalance: 0, overdueBalance: 0, totalCollected: 0, paidInvoiceCount: 0,
        oldestOpenInvoiceDate: postingDate, active: true, createdAt: now, createdByUid: authenticatedActorUid,
      } : {}),
      projectionSource: "customerLedgerEntries", projectionVersion: 1, pharmacyId,
      marketId: financialIdentity.marketId, currencyCode: financialIdentity.currencyCode,
      outstandingBalance: ((context.profile ? financialMinorUnits(existing.outstandingBalance, market.decimalPlaces) : 0) + financialMinorUnits(amount, market.decimalPlaces)) / 10 ** market.decimalPlaces,
      totalInvoiced: ((context.profile ? financialMinorUnits(existing.totalInvoiced, market.decimalPlaces) : 0) + financialMinorUnits(amount, market.decimalPlaces)) / 10 ** market.decimalPlaces,
      openInvoiceCount: Number(existing.openInvoiceCount || 0) + 1,
      lastInvoiceDate: postingDate, lastLedgerActivityAt: now, updatedAt: now, updatedByUid: authenticatedActorUid,
    };
    financialMinorUnits(profile.outstandingBalance, market.decimalPlaces);
    financialMinorUnits(profile.totalInvoiced, market.decimalPlaces);
    context.create(ledger, profile);
    return { success: true, posted: true, orderId: order.id, invoiceId, ledgerEntryId };
}
