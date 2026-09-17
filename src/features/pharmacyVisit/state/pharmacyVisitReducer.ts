import { logRuntimeStage } from "../services/customerGpsPolicyService";
import { resolvePharmacyCurrency } from "../utils/currency";
import { 
  PharmacyVisitDraft, 
  PharmacyVisitGps, 
  PharmacyVisitPurpose, 
  PharmacyVisitStatus, 
  PharmacyVisitStep,
  PharmacyOrderInputSource,
  PharmacyOrderLine,
  PharmacyVisitOrder,
  AiOrderParseResult,
  OrderImageAttachment,
  OrderImageExtractionResult,
  PharmacyOfferEligibilityResult,
  AppliedOfferSnapshot,
  OfferCalculationResult,
  OfferConflict,
  PharmacyVisitOffersState,
  PharmacyFinancialContext,
  PharmacyPaymentMethod,
  PharmacyPaymentEntry,
  PharmacyPaymentEvidence,
  PharmacyBalancePreview,
  PharmacyVisitPaymentState,
  PharmacyStockLevel,
  PharmacyStockPriority,
  PharmacyStockRequestReason,
  PharmacyRelationshipQuality,
  PharmacyStockRequestLine,
  PharmacyStockObservation,
  PharmacyCompetitorBrandObservation,
  PharmacyCompetitorPriceObservation,
  PharmacyCompetitorPromotionObservation,
  PharmacyShelfSpaceObservation,
  PharmacyMarketTrendObservation,
  PharmacyCompetitiveIntelligence,
  PharmacyDecisionMakerInsight,
  PharmacyCustomerPainPoint,
  PharmacyNextAction,
  PharmacyCrmNotes,
  PharmacyFollowUp,
  PharmacyVisitStockState,
  createInitialGpsState,
  normalizeDraftGps
} from "../types/domain";

export interface PharmacyVisitState {
  draft: PharmacyVisitDraft;
  isLoading: boolean;
  error?: string;
}

export type PharmacyVisitAction =
  | { type: "SET_PHARMACY"; payload: { pharmacyId: string; snapshot: PharmacyVisitDraft["pharmacySnapshot"]; areaId: string; marketSettings: import("../../../lib/marketSettings").MarketBusinessSettings[] } }
  | { type: "SET_PURPOSE"; payload: PharmacyVisitPurpose }
  | { type: "SET_ADDITIONAL_PURPOSES"; payload: { codes: string[]; objects?: PharmacyVisitPurpose[] } }
  | { type: "SET_GPS"; payload: PharmacyVisitGps }
  | { type: "SET_STEP"; payload: PharmacyVisitStep }
  | { type: "TRANSITION_TO_CHECKED_IN" }
  | { type: "RESTORE_DRAFT"; payload: PharmacyVisitDraft }
  | { type: "RESET_VISIT"; payload: PharmacyVisitDraft }
  | { type: "SET_ORDER_SOURCE"; payload: PharmacyOrderInputSource }
  | { type: "SET_PRODUCT_AVAILABILITY"; payload: import("../types/productAvailability").ProductAvailability[] }
  | { type: "ADD_ORDER_LINE"; payload: PharmacyOrderLine }
  | { type: "UPDATE_ORDER_LINE_QUANTITY"; payload: { lineId: string; quantity: number } }
  | { type: "REMOVE_ORDER_LINE"; payload: { lineId: string } }
  | { type: "MERGE_ORDER_LINE"; payload: PharmacyOrderLine }
  | { type: "SET_AI_PARSE_RESULT"; payload: AiOrderParseResult }
  | { type: "CONFIRM_AI_LINE"; payload: { lineId: string; confirmedLine: PharmacyOrderLine } }
  | { type: "REJECT_AI_LINE"; payload: { lineId: string } }
  | { type: "SET_ORDER_IMAGE_ATTACHMENT"; payload: OrderImageAttachment }
  | { type: "SET_ORDER_EXTRACTION_RESULT"; payload: OrderImageExtractionResult }
  | { type: "CLEAR_ORDER" }
  | { type: "COMPLETE_STEP_2" }
  | { type: "SET_OFFERS_STATE"; payload: PharmacyVisitOffersState }
  | { type: "SET_OFFER_INTENT"; payload: import("../services/canonicalOfferVisit").OfferDraftIntent[] }
  | { type: "REMOVE_PROMOTIONAL_BUNDLE"; payload: { offerId: string; triggerPaidLineIds: string[] } }
  | { type: "APPLY_OFFER"; payload: { offerId: string; isAutoApplied?: boolean } }
  | { type: "REMOVE_OFFER"; payload: { offerId: string } }
  | { type: "CONFIRM_OFFER"; payload: { offerId: string } }
  | { type: "RESOLVE_OFFER_CONFLICT"; payload: { selectedOfferId: string; rejectedOfferId: string } }
  | { type: "SET_OFFER_CALCULATION"; payload: { calculation: OfferCalculationResult; conflicts: OfferConflict[] } }
  | { type: "CLEAR_INVALID_OFFERS" }
  | { type: "COMPLETE_STEP_3" }
  | { type: "SET_FINANCIAL_CONTEXT"; payload: PharmacyFinancialContext }
  | { type: "SET_PAYMENT_METHOD"; payload: PharmacyPaymentMethod }
  | { type: "SET_PAYMENT_AMOUNT"; payload: { amount: number; userUid: string } }
  | { type: "SET_PAYMENT_FIELD"; payload: { field: string; value: any } }
  | { type: "ADD_PAYMENT_EVIDENCE"; payload: PharmacyPaymentEvidence }
  | { type: "REMOVE_PAYMENT_EVIDENCE"; payload: { attachmentId: string } }
  | { type: "SET_BALANCE_PREVIEW"; payload: PharmacyBalancePreview }
  | { type: "CLEAR_PAYMENT" }
  | { type: "COMPLETE_STEP_4" }
  | { type: "SET_STOCK_STATE"; payload: PharmacyVisitStockState }
  | { type: "ADD_STOCK_REQUEST_LINE"; payload: PharmacyStockRequestLine }
  | { type: "UPDATE_STOCK_REQUEST_LINE"; payload: { draftLineId: string; updates: Partial<PharmacyStockRequestLine> } }
  | { type: "REMOVE_STOCK_REQUEST_LINE"; payload: { draftLineId: string } }
  | { type: "SET_NO_STOCK_REQUEST_REQUIRED"; payload: boolean }
  | { type: "SET_OVERALL_STOCK_OBSERVATION"; payload: PharmacyStockObservation }
  | { type: "SET_COMPETITIVE_INTELLIGENCE"; payload: PharmacyCompetitiveIntelligence }
  | { type: "ADD_COMPETITOR_BRAND"; payload: PharmacyCompetitorBrandObservation }
  | { type: "REMOVE_COMPETITOR_BRAND"; payload: { id: string } }
  | { type: "ADD_COMPETITOR_PRICE"; payload: PharmacyCompetitorPriceObservation }
  | { type: "REMOVE_COMPETITOR_PRICE"; payload: { id: string } }
  | { type: "ADD_COMPETITOR_PROMOTION"; payload: PharmacyCompetitorPromotionObservation }
  | { type: "REMOVE_COMPETITOR_PROMOTION"; payload: { id: string } }
  | { type: "SET_SHELF_SPACE_OBSERVATION"; payload: PharmacyShelfSpaceObservation }
  | { type: "SET_MARKET_TREND_OBSERVATION"; payload: PharmacyMarketTrendObservation }
  | { type: "SET_CRM_NOTES"; payload: PharmacyCrmNotes }
  | { type: "SET_RELATIONSHIP_QUALITY"; payload: PharmacyRelationshipQuality }
  | { type: "ADD_DECISION_MAKER_INSIGHT"; payload: PharmacyDecisionMakerInsight }
  | { type: "REMOVE_DECISION_MAKER_INSIGHT"; payload: { id: string } }
  | { type: "ADD_CUSTOMER_PAIN_POINT"; payload: PharmacyCustomerPainPoint }
  | { type: "REMOVE_CUSTOMER_PAIN_POINT"; payload: { id: string } }
  | { type: "ADD_NEXT_ACTION"; payload: PharmacyNextAction }
  | { type: "REMOVE_NEXT_ACTION"; payload: { id: string } }
  | { type: "SET_GENERAL_NOTES"; payload: string }
  | { type: "SET_FOLLOW_UP"; payload: PharmacyFollowUp }
  | { type: "CLEAR_FOLLOW_UP" }
  | { type: "COMPLETE_STEP_5" };

function logStockRequestDiagnostic(draftId: string, stockState?: PharmacyVisitStockState): void {
  console.info(
    "[PHARMACY_VISIT_STOCK_REQUEST_JSON]",
    JSON.stringify({
      draftId,
      lineCount: stockState?.requestLines?.length || 0,
      noStockRequestRequired: stockState?.noStockRequestRequired ?? false,
      lines: (stockState?.requestLines || []).map((l) => ({
        draftLineId: l.draftLineId,
        canonicalProductId: l.canonicalProductId,
        productCode: l.productCode,
        productName: l.productNameSnapshot,
        observedQuantity: l.observedQuantity,
        targetQuantity: l.targetQuantity,
        requestedQuantity: l.requestedQuantity,
        priority: l.priority,
        reason: l.reason
      })),
      timestamp: new Date().toISOString()
    })
  );
}

function logStockObservationDiagnostic(draftId: string, obs?: PharmacyStockObservation): void {
  console.info(
    "[PHARMACY_VISIT_STOCK_OBSERVATION_JSON]",
    JSON.stringify({
      draftId,
      scope: obs?.scope || "PHARMACY",
      overallStockLevel: obs?.overallStockLevel || "NOT_CHECKED",
      notes: obs?.notes || "",
      timestamp: new Date().toISOString()
    })
  );
}

function logCompetitiveIntelligenceDiagnostic(draftId: string, ci?: PharmacyCompetitiveIntelligence): void {
  console.info(
    "[PHARMACY_VISIT_COMPETITIVE_INTELLIGENCE_JSON]",
    JSON.stringify({
      draftId,
      brandCount: ci?.competitorBrands?.length || 0,
      priceCount: ci?.competitorPricing?.length || 0,
      promoCount: ci?.competitorPromotions?.length || 0,
      hasShelfSpace: !!ci?.shelfSpace,
      hasMarketTrend: !!ci?.marketTrends,
      timestamp: new Date().toISOString()
    })
  );
}

function logCrmNotesDiagnostic(draftId: string, crm?: PharmacyCrmNotes): void {
  console.info(
    "[PHARMACY_VISIT_CRM_NOTES_JSON]",
    JSON.stringify({
      draftId,
      relationshipQuality: crm?.relationshipQuality || "NOT_ASSESSED",
      decisionMakerCount: crm?.decisionMakerInsights?.length || 0,
      painPointCount: crm?.customerPainPoints?.length || 0,
      nextActionCount: crm?.nextActions?.length || 0,
      hasGeneralNotes: !!crm?.generalNotes && crm.generalNotes.trim().length > 0,
      timestamp: new Date().toISOString()
    })
  );
}

function logFollowUpDiagnostic(draftId: string, fu?: PharmacyFollowUp): void {
  console.info(
    "[PHARMACY_VISIT_FOLLOW_UP_JSON]",
    JSON.stringify({
      draftId,
      required: fu?.required ?? false,
      followUpDate: fu?.followUpDate || "",
      purpose: fu?.purpose || "",
      ownerUid: fu?.ownerUid || "",
      priority: fu?.priority || "NORMAL",
      taskPersistencePending: fu?.taskPersistencePending ?? true,
      timestamp: new Date().toISOString()
    })
  );
}

function calculateSubtotal(lines: PharmacyOrderLine[]): number {
  return lines.reduce((acc, line) => {
    const total = line.lineTotalPreview ?? (line.unitPricePreview * line.quantity);
    return acc + (isNaN(total) ? 0 : total);
  }, 0);
}

function updateOrderDraft(
  existingOrder: PharmacyVisitOrder | undefined,
  updatedLines: PharmacyOrderLine[],
  inputSource?: PharmacyOrderInputSource
): PharmacyVisitOrder {
  const roundedSubtotal = Math.round(calculateSubtotal(updatedLines) * 100) / 100;
  return {
    ...existingOrder,
    lines: updatedLines,
    inputSource: inputSource || existingOrder?.inputSource || "MANUAL",
    subtotalPreview: roundedSubtotal,
    currency: existingOrder?.currency || "",
    updatedAt: new Date().toISOString()
  };
}

function logOrderLineDiagnostic(draftId: string, lines: PharmacyOrderLine[], subtotal: number): void {
  console.info(
    "[PHARMACY_VISIT_ORDER_LINE_JSON]",
    JSON.stringify({
      draftId,
      lineCount: lines.length,
      subtotalPreview: subtotal,
      lines: lines.map((l) => ({
        id: l.id,
        canonicalProductId: l.canonicalProductId,
        productCode: l.productCode,
        productName: l.productNameSnapshot,
        quantity: l.quantity,
        unitPrice: l.unitPricePreview,
        lineTotal: l.lineTotalPreview,
        source: l.inputSource,
        userConfirmed: l.userConfirmed
      })),
      timestamp: new Date().toISOString()
    })
  );
}

export function pharmacyVisitReducer(
  state: PharmacyVisitState,
  action: PharmacyVisitAction
): PharmacyVisitState {
  const previousStep = state.draft.currentStep;
  const previousStatus = state.draft.status;

  let newState: PharmacyVisitState;

  switch (action.type) {
    case "SET_PHARMACY": {
      const isPharmacyChanged = action.payload.pharmacyId !== state.draft.pharmacyId;
      const currencyCtx = resolvePharmacyCurrency({ ...action.payload.snapshot, countryId: action.payload.snapshot?.countryId || state.draft.countryId }, action.payload.marketSettings);
      const isCountryChanged = isPharmacyChanged && Boolean(state.draft.currencyCode) && state.draft.currencyCode !== currencyCtx.currencyCode;

      const updatedOrder = state.draft.order ? {
        ...state.draft.order,
        currency: currencyCtx.currencyCode,
        lines: isCountryChanged ? [] : state.draft.order.lines.map((l) => ({ ...l, currency: currencyCtx.currencyCode })),
        subtotalPreview: isCountryChanged ? 0 : state.draft.order.subtotalPreview
      } : undefined;

      newState = {
        ...state,
        draft: {
          ...state.draft,
          pharmacyId: action.payload.pharmacyId,
          pharmacySnapshot: action.payload.snapshot,
          countryId: currencyCtx.pharmacyCountryId,
          currencyCode: currencyCtx.currencyCode,
          currencySymbol: currencyCtx.currencySymbol,
          areaId: action.payload.areaId,
          order: updatedOrder,
          offers: isCountryChanged ? undefined : state.draft.offers,
          payment: isCountryChanged ? undefined : state.draft.payment,
          status: state.draft.status === "NEW" ? "DRAFT" : state.draft.status,
          updatedAt: new Date().toISOString(),
          gps: isPharmacyChanged ? createInitialGpsState() : (state.draft.gps ? normalizeDraftGps(state.draft).gps : createInitialGpsState())
        }
      };
      break;
    }

    case "SET_PURPOSE": {
      newState = {
        ...state,
        draft: {
          ...state.draft,
          visitPurpose: action.payload,
          primaryVisitPurposeCode: action.payload.code,
          status: state.draft.status === "NEW" ? "DRAFT" : state.draft.status,
          updatedAt: new Date().toISOString()
        }
      };
      break;
    }

    case "SET_ADDITIONAL_PURPOSES": {
      newState = {
        ...state,
        draft: {
          ...state.draft,
          additionalVisitPurposeCodes: action.payload.codes,
          additionalVisitPurposes: action.payload.objects,
          updatedAt: new Date().toISOString()
        }
      };
      break;
    }

    case "SET_GPS": {
      const gps = action.payload;
      newState = {
        ...state,
        draft: {
          ...state.draft,
          gps,
          updatedAt: new Date().toISOString()
        }
      };
      logRuntimeStage({
        stage: "4_REDUCER_DISPATCH",
        draftId: state.draft.draftId,
        pharmacyId: state.draft.pharmacyId,
        latitude: gps.latitude,
        longitude: gps.longitude,
        accuracyMeters: gps.accuracyMeters ?? gps.accuracy,
        source: gps.source || "device",
        captureStatus: gps.status || "NOT_ACQUIRED",
        captureAccepted: gps.latitude != null && gps.longitude != null && gps.status !== "NOT_ACQUIRED",
        policyCanProceed: true,
        validationCanProceed: true,
        buttonDisabled: false
      });
      break;
    }

    case "SET_STEP": {
      newState = {
        ...state,
        draft: {
          ...state.draft,
          currentStep: action.payload,
          updatedAt: new Date().toISOString()
        }
      };
      break;
    }

    case "TRANSITION_TO_CHECKED_IN": {
      newState = {
        ...state,
        draft: {
          ...state.draft,
          status: "CHECKED_IN",
          currentStep: 2,
          updatedAt: new Date().toISOString()
        }
      };
      break;
    }

    case "RESTORE_DRAFT": {
      newState = {
        ...state,
        draft: normalizeDraftGps(action.payload),
        isLoading: false,
        error: undefined
      };
      break;
    }

    case "RESET_VISIT": {
      newState = {
        draft: normalizeDraftGps(action.payload),
        isLoading: false,
        error: undefined
      };
      break;
    }

    case "SET_ORDER_SOURCE": {
      const currentOrder = state.draft.order || {
        lines: [],
        subtotalPreview: 0,
        currency: "",
        updatedAt: new Date().toISOString()
      };
      newState = {
        ...state,
        draft: {
          ...state.draft,
          order: {
            ...currentOrder,
            inputSource: action.payload,
            updatedAt: new Date().toISOString()
          }
        }
      };
      break;
    }

    case "SET_PRODUCT_AVAILABILITY": {
      const currentOrder = updateOrderDraft(state.draft.order, state.draft.order?.lines || []);
      newState = { ...state, draft: { ...state.draft, order: { ...currentOrder, productAvailability: action.payload }, updatedAt: new Date().toISOString() } };
      break;
    }

    case "ADD_ORDER_LINE": {
      const currentLines = state.draft.order?.lines || [];
      const existingIdx = currentLines.findIndex(
        (l) => l.canonicalProductId === action.payload.canonicalProductId
      );

      let newLines: PharmacyOrderLine[];
      if (existingIdx >= 0) {
        // Merge quantity if product already exists in order
        newLines = [...currentLines];
        const existing = newLines[existingIdx];
        const mergedQty = existing.quantity + action.payload.quantity;
        newLines[existingIdx] = {
          ...existing,
          quantity: mergedQty,
          lineTotalPreview: Math.round(existing.unitPricePreview * mergedQty * 100) / 100,
          updatedAt: new Date().toISOString()
        };
      } else {
        newLines = [...currentLines, action.payload];
      }

      const updatedOrder = updateOrderDraft(state.draft.order, newLines, action.payload.inputSource);
      logOrderLineDiagnostic(state.draft.draftId, newLines, updatedOrder.subtotalPreview);

      newState = {
        ...state,
        draft: {
          ...state.draft,
          order: updatedOrder,
          updatedAt: new Date().toISOString()
        }
      };
      break;
    }

    case "UPDATE_ORDER_LINE_QUANTITY": {
      const currentLines = state.draft.order?.lines || [];
      const newLines = currentLines.map((line) => {
        if (line.id === action.payload.lineId) {
          const qty = Math.max(1, Math.floor(action.payload.quantity));
          return {
            ...line,
            quantity: qty,
            lineTotalPreview: Math.round(line.unitPricePreview * qty * 100) / 100,
            updatedAt: new Date().toISOString()
          };
        }
        return line;
      });

      const updatedOrder = updateOrderDraft(state.draft.order, newLines);
      logOrderLineDiagnostic(state.draft.draftId, newLines, updatedOrder.subtotalPreview);

      newState = {
        ...state,
        draft: {
          ...state.draft,
          order: updatedOrder,
          updatedAt: new Date().toISOString()
        }
      };
      break;
    }

    case "REMOVE_ORDER_LINE": {
      const currentLines = state.draft.order?.lines || [];
      const newLines = currentLines.filter((line) => line.id !== action.payload.lineId);

      const updatedOrder = updateOrderDraft(state.draft.order, newLines);
      logOrderLineDiagnostic(state.draft.draftId, newLines, updatedOrder.subtotalPreview);

      newState = {
        ...state,
        draft: {
          ...state.draft,
          order: updatedOrder,
          updatedAt: new Date().toISOString()
        }
      };
      break;
    }

    case "MERGE_ORDER_LINE": {
      const currentLines = state.draft.order?.lines || [];
      const targetProduct = action.payload;
      const existingIdx = currentLines.findIndex(
        (l) => l.canonicalProductId === targetProduct.canonicalProductId
      );

      let newLines: PharmacyOrderLine[];
      if (existingIdx >= 0) {
        newLines = [...currentLines];
        const existing = newLines[existingIdx];
        const newQty = existing.quantity + targetProduct.quantity;
        newLines[existingIdx] = {
          ...existing,
          quantity: newQty,
          lineTotalPreview: Math.round(existing.unitPricePreview * newQty * 100) / 100,
          updatedAt: new Date().toISOString()
        };
      } else {
        newLines = [...currentLines, targetProduct];
      }

      const updatedOrder = updateOrderDraft(state.draft.order, newLines, targetProduct.inputSource);
      logOrderLineDiagnostic(state.draft.draftId, newLines, updatedOrder.subtotalPreview);

      newState = {
        ...state,
        draft: {
          ...state.draft,
          order: updatedOrder,
          updatedAt: new Date().toISOString()
        }
      };
      break;
    }

    case "SET_AI_PARSE_RESULT": {
      const currentOrder = state.draft.order || {
        lines: [],
        subtotalPreview: 0,
        currency: "",
        updatedAt: new Date().toISOString()
      };

      newState = {
        ...state,
        draft: {
          ...state.draft,
          order: {
            ...currentOrder,
            lastParseResult: action.payload,
            updatedAt: new Date().toISOString()
          }
        }
      };
      break;
    }

    case "CONFIRM_AI_LINE": {
      const currentLines = state.draft.order?.lines || [];
      const confirmedLine = action.payload.confirmedLine;

      // Add or replace line in confirmed order lines
      const existingIdx = currentLines.findIndex(
        (l) => l.canonicalProductId === confirmedLine.canonicalProductId
      );

      let newLines: PharmacyOrderLine[];
      if (existingIdx >= 0) {
        newLines = [...currentLines];
        newLines[existingIdx] = confirmedLine;
      } else {
        newLines = [...currentLines, confirmedLine];
      }

      const updatedOrder = updateOrderDraft(state.draft.order, newLines, confirmedLine.inputSource);
      logOrderLineDiagnostic(state.draft.draftId, newLines, updatedOrder.subtotalPreview);

      newState = {
        ...state,
        draft: {
          ...state.draft,
          order: updatedOrder,
          updatedAt: new Date().toISOString()
        }
      };
      break;
    }

    case "REJECT_AI_LINE": {
      // Handled primarily in UI local state for review table
      newState = state;
      break;
    }

    case "SET_ORDER_IMAGE_ATTACHMENT": {
      const currentOrder = state.draft.order || {
        lines: [],
        subtotalPreview: 0,
        currency: "",
        updatedAt: new Date().toISOString()
      };
      const existingAttachments = currentOrder.imageAttachments || [];

      newState = {
        ...state,
        draft: {
          ...state.draft,
          order: {
            ...currentOrder,
            imageAttachments: [...existingAttachments, action.payload],
            updatedAt: new Date().toISOString()
          }
        }
      };
      break;
    }

    case "SET_ORDER_EXTRACTION_RESULT": {
      const currentOrder = state.draft.order || {
        lines: [],
        subtotalPreview: 0,
        currency: "",
        updatedAt: new Date().toISOString()
      };
      const existingResults = currentOrder.extractionResults || [];

      newState = {
        ...state,
        draft: {
          ...state.draft,
          order: {
            ...currentOrder,
            extractionResults: [...existingResults, action.payload],
            updatedAt: new Date().toISOString()
          }
        }
      };
      break;
    }

    case "CLEAR_ORDER": {
      newState = {
        ...state,
        draft: {
          ...state.draft,
          order: {
            lines: [],
            subtotalPreview: 0,
            currency: state.draft.order?.currency || state.draft.currencyCode || "",
            updatedAt: new Date().toISOString()
          },
          updatedAt: new Date().toISOString()
        }
      };
      break;
    }

    case "COMPLETE_STEP_2": {
      newState = {
        ...state,
        draft: {
          ...state.draft,
          currentStep: 3,
          status: "IN_PROGRESS",
          updatedAt: new Date().toISOString()
        }
      };
      break;
    }

    case "SET_OFFERS_STATE": {
      newState = {
        ...state,
        draft: {
          ...state.draft,
          offers: action.payload,
          updatedAt: new Date().toISOString()
        }
      };
      break;
    }

    case "SET_OFFER_INTENT": {
      newState = { ...state, draft: { ...state.draft, offerIntent: action.payload, updatedAt: new Date().toISOString() } };
      break;
    }

    case "REMOVE_PROMOTIONAL_BUNDLE": {
      const lineIds = new Set(action.payload.triggerPaidLineIds);
      const updatedLines = (state.draft.order?.lines || []).filter(line => !lineIds.has(line.id));
      newState = {
        ...state,
        draft: {
          ...state.draft,
          order: updateOrderDraft(state.draft.order, updatedLines),
          offerIntent: (state.draft.offerIntent || []).filter(item => item.offerId !== action.payload.offerId).map(item => ({ ...item, confirmed: false, confirmedAt: undefined })),
          // Canonical previews are derived, never persisted. Clear any legacy
          // calculation state so Step 3 must recalculate remaining selections.
          offers: undefined,
          updatedAt: new Date().toISOString()
        }
      };
      break;
    }

    case "APPLY_OFFER": {
      const currentOffers = state.draft.offers;
      if (!currentOffers) {
        newState = state;
        break;
      }

      const eligibleItem = currentOffers.eligibleOffers.find((e) => e.offer.id === action.payload.offerId);
      if (!eligibleItem || !eligibleItem.isEligible) {
        newState = state;
        break;
      }

      const offer = eligibleItem!.offer;
      const alreadyApplied = currentOffers.appliedOffers.some((a) => a.offerId === offer.id);
      if (alreadyApplied) {
        newState = state;
        break;
      }

      const newSnapshot: AppliedOfferSnapshot = {
        offerId: offer.id,
        offerCode: offer.code,
        offerNameSnapshot: offer.name,
        version: "1.0",
        type: offer.type,
        discountAmountPreview: eligibleItem!.previewDiscountAmount || 0,
        bonusLinesPreview: eligibleItem!.previewBonusQuantity ? [{
          id: `bonus_${offer.id}`,
          offerId: offer.id,
          offerCode: offer.code,
          offerName: offer.name,
          productId: offer.freeProductId || offer.productId || "PRD-BONUS",
          productCode: offer.freeProductCode || "BONUS",
          productName: eligibleItem!.previewBonusProductName || `${offer.name} Free Bonus`,
          bonusQuantity: eligibleItem!.previewBonusQuantity,
          unitPricePreview: 0,
          currency: state.draft.currencyCode || ""
        }] : [],
        currency: state.draft.currencyCode || "",
        isAutoApplied: action.payload.isAutoApplied ?? false,
        isUserConfirmed: true,
        backendRevalidationRequired: true,
        appliedAt: new Date().toISOString()
      };

      const updatedApplied = [...currentOffers.appliedOffers, newSnapshot];
      
      console.info(
        "[PHARMACY_VISIT_OFFER_APPLIED_JSON]",
        JSON.stringify({
          offerId: offer.id,
          offerCode: offer.code,
          offerName: offer.name,
          isAutoApplied: newSnapshot.isAutoApplied,
          discountAmountPreview: newSnapshot.discountAmountPreview,
          bonusQuantityPreview: eligibleItem!.previewBonusQuantity || 0,
          timestamp: new Date().toISOString()
        })
      );

      newState = {
        ...state,
        draft: {
          ...state.draft,
          offers: {
            ...currentOffers,
            appliedOffers: updatedApplied,
            lastEvaluatedAt: new Date().toISOString()
          },
          updatedAt: new Date().toISOString()
        }
      };
      break;
    }

    case "REMOVE_OFFER": {
      const currentOffers = state.draft.offers;
      if (!currentOffers) {
        newState = state;
        break;
      }

      const filteredApplied = currentOffers.appliedOffers.filter((a) => a.offerId !== action.payload.offerId);

      newState = {
        ...state,
        draft: {
          ...state.draft,
          offers: {
            ...currentOffers,
            appliedOffers: filteredApplied,
            lastEvaluatedAt: new Date().toISOString()
          },
          updatedAt: new Date().toISOString()
        }
      };
      break;
    }

    case "CONFIRM_OFFER": {
      const currentOffers = state.draft.offers;
      if (!currentOffers) {
        newState = state;
        break;
      }

      const updatedApplied = currentOffers.appliedOffers.map((a) => {
        if (a.offerId === action.payload.offerId) {
          return { ...a, isUserConfirmed: true };
        }
        return a;
      });

      newState = {
        ...state,
        draft: {
          ...state.draft,
          offers: {
            ...currentOffers,
            appliedOffers: updatedApplied,
            lastEvaluatedAt: new Date().toISOString()
          },
          updatedAt: new Date().toISOString()
        }
      };
      break;
    }

    case "RESOLVE_OFFER_CONFLICT": {
      const currentOffers = state.draft.offers;
      if (!currentOffers) {
        newState = state;
        break;
      }

      const filteredApplied = currentOffers.appliedOffers.filter(
        (a) => a.offerId !== action.payload.rejectedOfferId
      );

      const resolvedConflicts = currentOffers.conflicts.map((c) => {
        if (
          (c.offerIdA === action.payload.selectedOfferId && c.offerIdB === action.payload.rejectedOfferId) ||
          (c.offerIdB === action.payload.selectedOfferId && c.offerIdA === action.payload.rejectedOfferId)
        ) {
          return { ...c, resolvedOfferId: action.payload.selectedOfferId };
        }
        return c;
      });

      newState = {
        ...state,
        draft: {
          ...state.draft,
          offers: {
            ...currentOffers,
            appliedOffers: filteredApplied,
            conflicts: resolvedConflicts,
            lastEvaluatedAt: new Date().toISOString()
          },
          updatedAt: new Date().toISOString()
        }
      };
      break;
    }

    case "SET_OFFER_CALCULATION": {
      const currentOffers = state.draft.offers;
      if (!currentOffers) {
        newState = state;
        break;
      }

      newState = {
        ...state,
        draft: {
          ...state.draft,
          offers: {
            ...currentOffers,
            calculation: action.payload.calculation,
            conflicts: action.payload.conflicts,
            lastEvaluatedAt: new Date().toISOString()
          },
          updatedAt: new Date().toISOString()
        }
      };
      break;
    }

    case "CLEAR_INVALID_OFFERS": {
      const currentOffers = state.draft.offers;
      if (!currentOffers) {
        newState = state;
        break;
      }

      const eligibleIds = new Set(currentOffers.eligibleOffers.map((e) => e.offer.id));
      const validApplied = currentOffers.appliedOffers.filter((a) => eligibleIds.has(a.offerId));

      newState = {
        ...state,
        draft: {
          ...state.draft,
          offers: {
            ...currentOffers,
            appliedOffers: validApplied,
            isStale: false,
            lastEvaluatedAt: new Date().toISOString()
          },
          updatedAt: new Date().toISOString()
        }
      };
      break;
    }

    case "COMPLETE_STEP_3": {
      newState = {
        ...state,
        draft: {
          ...state.draft,
          currentStep: 4,
          status: "IN_PROGRESS",
          updatedAt: new Date().toISOString()
        }
      };
      break;
    }

    case "SET_FINANCIAL_CONTEXT": {
      const currentPayment = state.draft.payment || {};
      const fin = action.payload;
      const currentNetTotal = state.draft.offers?.calculation?.netTotal ?? state.draft.order?.subtotalPreview ?? 0;
      const currentPaymentEntry = currentPayment.paymentEntry || {
        paymentId: `pay_${Date.now()}`,
        method: "CASH",
        amount: 0,
        currency: fin.currency || state.draft.currencyCode || "",
        evidences: [],
        enteredAt: new Date().toISOString(),
        enteredBy: state.draft.repUid || "",
        userConfirmed: false,
        source: "DRAFT",
        backendRevalidationRequired: true
      };

      const outstandingBefore = fin.outstandingBalanceBefore ?? 0;
      const paymentAmt = currentPaymentEntry.amount || 0;
      const totalDue = Math.round((outstandingBefore + currentNetTotal) * 100) / 100;
      const projected = Math.round((totalDue - paymentAmt) * 100) / 100;

      newState = {
        ...state,
        draft: {
          ...state.draft,
          payment: {
            ...currentPayment,
            financialContext: fin,
            paymentEntry: currentPaymentEntry,
            balancePreview: {
              outstandingBalanceBefore: outstandingBefore,
              currentVisitNetTotal: currentNetTotal,
              paymentAmount: paymentAmt,
              projectedBalanceAfter: projected,
              currency: fin.currency || state.draft.currencyCode || "",
              formula: "before + netOrder - payment",
              isOverpayment: paymentAmt > totalDue,
              overpaymentAmount: paymentAmt > totalDue ? Math.round((paymentAmt - totalDue) * 100) / 100 : undefined,
              backendRevalidationRequired: true
            },
            isStale: false,
            lastEvaluatedAt: new Date().toISOString()
          },
          updatedAt: new Date().toISOString()
        }
      };
      break;
    }

    case "SET_PAYMENT_METHOD": {
      const currentPayment = state.draft.payment || {};
      const currentEntry = currentPayment.paymentEntry || {
        paymentId: `pay_${Date.now()}`,
        method: "CASH",
        amount: 0,
        currency: state.draft.currencyCode || "",
        evidences: [],
        enteredAt: new Date().toISOString(),
        enteredBy: state.draft.repUid || "",
        userConfirmed: false,
        source: "DRAFT",
        backendRevalidationRequired: true
      };

      const updatedEntry: PharmacyPaymentEntry = {
        ...currentEntry,
        method: action.payload,
        userConfirmed: true
      };

      newState = {
        ...state,
        draft: {
          ...state.draft,
          payment: {
            ...currentPayment,
            paymentEntry: updatedEntry,
            isStale: false,
            lastEvaluatedAt: new Date().toISOString()
          },
          updatedAt: new Date().toISOString()
        }
      };

      console.info(
        "[PHARMACY_VISIT_PAYMENT_ENTRY_JSON]",
        JSON.stringify({
          draftId: state.draft.draftId,
          paymentId: updatedEntry.paymentId,
          method: updatedEntry.method,
          amount: updatedEntry.amount,
          currency: updatedEntry.currency,
          evidenceCount: updatedEntry.evidences.length,
          timestamp: new Date().toISOString()
        })
      );
      break;
    }

    case "SET_PAYMENT_AMOUNT": {
      const currentPayment = state.draft.payment || {};
      const currentEntry = currentPayment.paymentEntry || {
        paymentId: `pay_${Date.now()}`,
        method: "CASH",
        amount: 0,
        currency: state.draft.currencyCode || "",
        evidences: [],
        enteredAt: new Date().toISOString(),
        enteredBy: action.payload.userUid || state.draft.repUid || "",
        userConfirmed: false,
        source: "DRAFT",
        backendRevalidationRequired: true
      };

      const safeAmt = isNaN(action.payload.amount) || action.payload.amount < 0 ? 0 : Math.round(action.payload.amount * 100) / 100;
      const updatedEntry: PharmacyPaymentEntry = {
        ...currentEntry,
        amount: safeAmt,
        userConfirmed: true
      };

      const outstandingBefore = currentPayment.financialContext?.outstandingBalanceBefore ?? 0;
      const currentNetTotal = state.draft.offers?.calculation?.netTotal ?? state.draft.order?.subtotalPreview ?? 0;
      const totalDue = Math.round((outstandingBefore + currentNetTotal) * 100) / 100;
      const projected = Math.round((totalDue - safeAmt) * 100) / 100;

      newState = {
        ...state,
        draft: {
          ...state.draft,
          payment: {
            ...currentPayment,
            paymentEntry: updatedEntry,
            balancePreview: {
              outstandingBalanceBefore: outstandingBefore,
              currentVisitNetTotal: currentNetTotal,
              paymentAmount: safeAmt,
              projectedBalanceAfter: projected,
              currency: updatedEntry.currency || state.draft.currencyCode || "",
              formula: "before + netOrder - payment",
              isOverpayment: safeAmt > totalDue,
              overpaymentAmount: safeAmt > totalDue ? Math.round((safeAmt - totalDue) * 100) / 100 : undefined,
              backendRevalidationRequired: true
            },
            isStale: false,
            lastEvaluatedAt: new Date().toISOString()
          },
          updatedAt: new Date().toISOString()
        }
      };

      console.info(
        "[PHARMACY_VISIT_PAYMENT_ENTRY_JSON]",
        JSON.stringify({
          draftId: state.draft.draftId,
          paymentId: updatedEntry.paymentId,
          method: updatedEntry.method,
          amount: updatedEntry.amount,
          currency: updatedEntry.currency,
          evidenceCount: updatedEntry.evidences.length,
          timestamp: new Date().toISOString()
        })
      );
      break;
    }

    case "SET_PAYMENT_FIELD": {
      const currentPayment = state.draft.payment || {};
      const currentEntry = currentPayment.paymentEntry || {
        paymentId: `pay_${Date.now()}`,
        method: "CASH",
        amount: 0,
        currency: state.draft.currencyCode || "",
        evidences: [],
        enteredAt: new Date().toISOString(),
        enteredBy: state.draft.repUid || "",
        userConfirmed: false,
        source: "DRAFT",
        backendRevalidationRequired: true
      };

      const updatedEntry: PharmacyPaymentEntry = {
        ...currentEntry,
        [action.payload.field]: action.payload.value
      };

      newState = {
        ...state,
        draft: {
          ...state.draft,
          payment: {
            ...currentPayment,
            paymentEntry: updatedEntry,
            updatedAt: new Date().toISOString()
          } as any,
          updatedAt: new Date().toISOString()
        }
      };
      break;
    }

    case "ADD_PAYMENT_EVIDENCE": {
      const currentPayment = state.draft.payment || {};
      const currentEntry = currentPayment.paymentEntry || {
        paymentId: `pay_${Date.now()}`,
        method: "CASH",
        amount: 0,
        currency: state.draft.currencyCode || "",
        evidences: [],
        enteredAt: new Date().toISOString(),
        enteredBy: state.draft.repUid || "",
        userConfirmed: false,
        source: "DRAFT",
        backendRevalidationRequired: true
      };

      const updatedEvidences = [...currentEntry.evidences.filter((e) => e.attachmentId !== action.payload.attachmentId), action.payload];
      const updatedEntry: PharmacyPaymentEntry = {
        ...currentEntry,
        evidences: updatedEvidences
      };

      newState = {
        ...state,
        draft: {
          ...state.draft,
          payment: {
            ...currentPayment,
            paymentEntry: updatedEntry
          },
          updatedAt: new Date().toISOString()
        }
      };

      console.info(
        "[PHARMACY_VISIT_PAYMENT_EVIDENCE_JSON]",
        JSON.stringify({
          draftId: state.draft.draftId,
          attachmentId: action.payload.attachmentId,
          fileName: action.payload.fileName,
          sizeBytes: action.payload.sizeBytes,
          mimeType: action.payload.mimeType,
          totalEvidences: updatedEvidences.length,
          timestamp: new Date().toISOString()
        })
      );
      break;
    }

    case "REMOVE_PAYMENT_EVIDENCE": {
      const currentPayment = state.draft.payment || {};
      const currentEntry = currentPayment.paymentEntry;
      if (!currentEntry) {
        newState = state;
        break;
      }

      const updatedEvidences = currentEntry.evidences.filter((e) => e.attachmentId !== action.payload.attachmentId);
      newState = {
        ...state,
        draft: {
          ...state.draft,
          payment: {
            ...currentPayment,
            paymentEntry: {
              ...currentEntry,
              evidences: updatedEvidences
            }
          },
          updatedAt: new Date().toISOString()
        }
      };
      break;
    }

    case "SET_BALANCE_PREVIEW": {
      const currentPayment = state.draft.payment || {};
      newState = {
        ...state,
        draft: {
          ...state.draft,
          payment: {
            ...currentPayment,
            balancePreview: action.payload,
            isStale: false,
            lastEvaluatedAt: new Date().toISOString()
          },
          updatedAt: new Date().toISOString()
        }
      };
      break;
    }

    case "CLEAR_PAYMENT": {
      const currentPayment = state.draft.payment || {};
      newState = {
        ...state,
        draft: {
          ...state.draft,
          payment: {
            ...currentPayment,
            paymentEntry: undefined,
            balancePreview: undefined
          },
          updatedAt: new Date().toISOString()
        }
      };
      break;
    }

    case "COMPLETE_STEP_4": {
      newState = {
        ...state,
        draft: {
          ...state.draft,
          currentStep: 5,
          status: "IN_PROGRESS",
          updatedAt: new Date().toISOString()
        }
      };
      break;
    }

    case "SET_STOCK_STATE": {
      newState = {
        ...state,
        draft: {
          ...state.draft,
          stock: action.payload,
          updatedAt: new Date().toISOString()
        }
      };
      logStockRequestDiagnostic(state.draft.draftId, action.payload);
      break;
    }

    case "ADD_STOCK_REQUEST_LINE": {
      const currentStock = state.draft.stock || { noStockRequestRequired: false, requestLines: [] };
      const lines = currentStock.requestLines || [];
      const existingIdx = lines.findIndex(l => l.canonicalProductId === action.payload.canonicalProductId);
      let newLines: PharmacyStockRequestLine[];
      if (existingIdx >= 0) {
        newLines = [...lines];
        const existing = newLines[existingIdx];
        newLines[existingIdx] = {
          ...existing,
          requestedQuantity: existing.requestedQuantity + action.payload.requestedQuantity,
          updatedAt: new Date().toISOString()
        };
      } else {
        newLines = [...lines, action.payload];
      }
      const updatedStock: PharmacyVisitStockState = {
        ...currentStock,
        noStockRequestRequired: false,
        requestLines: newLines,
        lastEvaluatedAt: new Date().toISOString()
      };
      newState = {
        ...state,
        draft: {
          ...state.draft,
          stock: updatedStock,
          updatedAt: new Date().toISOString()
        }
      };
      logStockRequestDiagnostic(state.draft.draftId, updatedStock);
      break;
    }

    case "UPDATE_STOCK_REQUEST_LINE": {
      const currentStock = state.draft.stock || { noStockRequestRequired: false, requestLines: [] };
      const lines = (currentStock.requestLines || []).map(l => {
        if (l.draftLineId === action.payload.draftLineId) {
          return {
            ...l,
            ...action.payload.updates,
            updatedAt: new Date().toISOString()
          };
        }
        return l;
      });
      const updatedStock: PharmacyVisitStockState = {
        ...currentStock,
        requestLines: lines,
        lastEvaluatedAt: new Date().toISOString()
      };
      newState = {
        ...state,
        draft: {
          ...state.draft,
          stock: updatedStock,
          updatedAt: new Date().toISOString()
        }
      };
      logStockRequestDiagnostic(state.draft.draftId, updatedStock);
      break;
    }

    case "REMOVE_STOCK_REQUEST_LINE": {
      const currentStock = state.draft.stock || { noStockRequestRequired: false, requestLines: [] };
      const lines = (currentStock.requestLines || []).filter(l => l.draftLineId !== action.payload.draftLineId);
      const updatedStock: PharmacyVisitStockState = {
        ...currentStock,
        requestLines: lines,
        lastEvaluatedAt: new Date().toISOString()
      };
      newState = {
        ...state,
        draft: {
          ...state.draft,
          stock: updatedStock,
          updatedAt: new Date().toISOString()
        }
      };
      logStockRequestDiagnostic(state.draft.draftId, updatedStock);
      break;
    }

    case "SET_NO_STOCK_REQUEST_REQUIRED": {
      const currentStock = state.draft.stock || { noStockRequestRequired: false, requestLines: [] };
      const updatedStock: PharmacyVisitStockState = {
        ...currentStock,
        noStockRequestRequired: action.payload,
        requestLines: action.payload ? [] : currentStock.requestLines,
        lastEvaluatedAt: new Date().toISOString()
      };
      newState = {
        ...state,
        draft: {
          ...state.draft,
          stock: updatedStock,
          updatedAt: new Date().toISOString()
        }
      };
      logStockRequestDiagnostic(state.draft.draftId, updatedStock);
      break;
    }

    case "SET_OVERALL_STOCK_OBSERVATION": {
      const currentStock = state.draft.stock || { noStockRequestRequired: false, requestLines: [] };
      const updatedStock: PharmacyVisitStockState = {
        ...currentStock,
        stockObservation: action.payload,
        lastEvaluatedAt: new Date().toISOString()
      };
      newState = {
        ...state,
        draft: {
          ...state.draft,
          stock: updatedStock,
          updatedAt: new Date().toISOString()
        }
      };
      logStockObservationDiagnostic(state.draft.draftId, action.payload);
      break;
    }

    case "SET_COMPETITIVE_INTELLIGENCE": {
      const currentStock = state.draft.stock || { noStockRequestRequired: false, requestLines: [] };
      const updatedStock: PharmacyVisitStockState = {
        ...currentStock,
        competitiveIntelligence: action.payload,
        lastEvaluatedAt: new Date().toISOString()
      };
      newState = {
        ...state,
        draft: {
          ...state.draft,
          stock: updatedStock,
          updatedAt: new Date().toISOString()
        }
      };
      logCompetitiveIntelligenceDiagnostic(state.draft.draftId, action.payload);
      break;
    }

    case "ADD_COMPETITOR_BRAND": {
      const currentStock = state.draft.stock || { noStockRequestRequired: false, requestLines: [] };
      const currentCi = currentStock.competitiveIntelligence || {};
      const brands = [...(currentCi.competitorBrands || []), action.payload];
      const updatedCi: PharmacyCompetitiveIntelligence = {
        ...currentCi,
        competitorBrands: brands,
        lastUpdated: new Date().toISOString()
      };
      const updatedStock: PharmacyVisitStockState = {
        ...currentStock,
        competitiveIntelligence: updatedCi,
        lastEvaluatedAt: new Date().toISOString()
      };
      newState = {
        ...state,
        draft: {
          ...state.draft,
          stock: updatedStock,
          updatedAt: new Date().toISOString()
        }
      };
      logCompetitiveIntelligenceDiagnostic(state.draft.draftId, updatedCi);
      break;
    }

    case "REMOVE_COMPETITOR_BRAND": {
      const currentStock = state.draft.stock || { noStockRequestRequired: false, requestLines: [] };
      const currentCi = currentStock.competitiveIntelligence || {};
      const brands = (currentCi.competitorBrands || []).filter(b => b.id !== action.payload.id);
      const updatedCi: PharmacyCompetitiveIntelligence = {
        ...currentCi,
        competitorBrands: brands,
        lastUpdated: new Date().toISOString()
      };
      const updatedStock: PharmacyVisitStockState = {
        ...currentStock,
        competitiveIntelligence: updatedCi,
        lastEvaluatedAt: new Date().toISOString()
      };
      newState = {
        ...state,
        draft: {
          ...state.draft,
          stock: updatedStock,
          updatedAt: new Date().toISOString()
        }
      };
      logCompetitiveIntelligenceDiagnostic(state.draft.draftId, updatedCi);
      break;
    }

    case "ADD_COMPETITOR_PRICE": {
      const currentStock = state.draft.stock || { noStockRequestRequired: false, requestLines: [] };
      const currentCi = currentStock.competitiveIntelligence || {};
      const pricing = [...(currentCi.competitorPricing || []), action.payload];
      const updatedCi: PharmacyCompetitiveIntelligence = {
        ...currentCi,
        competitorPricing: pricing,
        lastUpdated: new Date().toISOString()
      };
      const updatedStock: PharmacyVisitStockState = {
        ...currentStock,
        competitiveIntelligence: updatedCi,
        lastEvaluatedAt: new Date().toISOString()
      };
      newState = {
        ...state,
        draft: {
          ...state.draft,
          stock: updatedStock,
          updatedAt: new Date().toISOString()
        }
      };
      logCompetitiveIntelligenceDiagnostic(state.draft.draftId, updatedCi);
      break;
    }

    case "REMOVE_COMPETITOR_PRICE": {
      const currentStock = state.draft.stock || { noStockRequestRequired: false, requestLines: [] };
      const currentCi = currentStock.competitiveIntelligence || {};
      const pricing = (currentCi.competitorPricing || []).filter(p => p.id !== action.payload.id);
      const updatedCi: PharmacyCompetitiveIntelligence = {
        ...currentCi,
        competitorPricing: pricing,
        lastUpdated: new Date().toISOString()
      };
      const updatedStock: PharmacyVisitStockState = {
        ...currentStock,
        competitiveIntelligence: updatedCi,
        lastEvaluatedAt: new Date().toISOString()
      };
      newState = {
        ...state,
        draft: {
          ...state.draft,
          stock: updatedStock,
          updatedAt: new Date().toISOString()
        }
      };
      logCompetitiveIntelligenceDiagnostic(state.draft.draftId, updatedCi);
      break;
    }

    case "ADD_COMPETITOR_PROMOTION": {
      const currentStock = state.draft.stock || { noStockRequestRequired: false, requestLines: [] };
      const currentCi = currentStock.competitiveIntelligence || {};
      const promos = [...(currentCi.competitorPromotions || []), action.payload];
      const updatedCi: PharmacyCompetitiveIntelligence = {
        ...currentCi,
        competitorPromotions: promos,
        lastUpdated: new Date().toISOString()
      };
      const updatedStock: PharmacyVisitStockState = {
        ...currentStock,
        competitiveIntelligence: updatedCi,
        lastEvaluatedAt: new Date().toISOString()
      };
      newState = {
        ...state,
        draft: {
          ...state.draft,
          stock: updatedStock,
          updatedAt: new Date().toISOString()
        }
      };
      logCompetitiveIntelligenceDiagnostic(state.draft.draftId, updatedCi);
      break;
    }

    case "REMOVE_COMPETITOR_PROMOTION": {
      const currentStock = state.draft.stock || { noStockRequestRequired: false, requestLines: [] };
      const currentCi = currentStock.competitiveIntelligence || {};
      const promos = (currentCi.competitorPromotions || []).filter(p => p.id !== action.payload.id);
      const updatedCi: PharmacyCompetitiveIntelligence = {
        ...currentCi,
        competitorPromotions: promos,
        lastUpdated: new Date().toISOString()
      };
      const updatedStock: PharmacyVisitStockState = {
        ...currentStock,
        competitiveIntelligence: updatedCi,
        lastEvaluatedAt: new Date().toISOString()
      };
      newState = {
        ...state,
        draft: {
          ...state.draft,
          stock: updatedStock,
          updatedAt: new Date().toISOString()
        }
      };
      logCompetitiveIntelligenceDiagnostic(state.draft.draftId, updatedCi);
      break;
    }

    case "SET_SHELF_SPACE_OBSERVATION": {
      const currentStock = state.draft.stock || { noStockRequestRequired: false, requestLines: [] };
      const currentCi = currentStock.competitiveIntelligence || {};
      const updatedCi: PharmacyCompetitiveIntelligence = {
        ...currentCi,
        shelfSpace: action.payload,
        lastUpdated: new Date().toISOString()
      };
      const updatedStock: PharmacyVisitStockState = {
        ...currentStock,
        competitiveIntelligence: updatedCi,
        lastEvaluatedAt: new Date().toISOString()
      };
      newState = {
        ...state,
        draft: {
          ...state.draft,
          stock: updatedStock,
          updatedAt: new Date().toISOString()
        }
      };
      logCompetitiveIntelligenceDiagnostic(state.draft.draftId, updatedCi);
      break;
    }

    case "SET_MARKET_TREND_OBSERVATION": {
      const currentStock = state.draft.stock || { noStockRequestRequired: false, requestLines: [] };
      const currentCi = currentStock.competitiveIntelligence || {};
      const updatedCi: PharmacyCompetitiveIntelligence = {
        ...currentCi,
        marketTrends: action.payload,
        lastUpdated: new Date().toISOString()
      };
      const updatedStock: PharmacyVisitStockState = {
        ...currentStock,
        competitiveIntelligence: updatedCi,
        lastEvaluatedAt: new Date().toISOString()
      };
      newState = {
        ...state,
        draft: {
          ...state.draft,
          stock: updatedStock,
          updatedAt: new Date().toISOString()
        }
      };
      logCompetitiveIntelligenceDiagnostic(state.draft.draftId, updatedCi);
      break;
    }

    case "SET_CRM_NOTES": {
      const currentStock = state.draft.stock || { noStockRequestRequired: false, requestLines: [] };
      const updatedStock: PharmacyVisitStockState = {
        ...currentStock,
        crmNotes: action.payload,
        lastEvaluatedAt: new Date().toISOString()
      };
      newState = {
        ...state,
        draft: {
          ...state.draft,
          stock: updatedStock,
          updatedAt: new Date().toISOString()
        }
      };
      logCrmNotesDiagnostic(state.draft.draftId, action.payload);
      break;
    }

    case "SET_RELATIONSHIP_QUALITY": {
      const currentStock = state.draft.stock || { noStockRequestRequired: false, requestLines: [] };
      const currentCrm = currentStock.crmNotes || {};
      const updatedCrm: PharmacyCrmNotes = {
        ...currentCrm,
        relationshipQuality: action.payload
      };
      const updatedStock: PharmacyVisitStockState = {
        ...currentStock,
        crmNotes: updatedCrm,
        lastEvaluatedAt: new Date().toISOString()
      };
      newState = {
        ...state,
        draft: {
          ...state.draft,
          stock: updatedStock,
          updatedAt: new Date().toISOString()
        }
      };
      logCrmNotesDiagnostic(state.draft.draftId, updatedCrm);
      break;
    }

    case "ADD_DECISION_MAKER_INSIGHT": {
      const currentStock = state.draft.stock || { noStockRequestRequired: false, requestLines: [] };
      const currentCrm = currentStock.crmNotes || {};
      const insights = [...(currentCrm.decisionMakerInsights || []), action.payload];
      const updatedCrm: PharmacyCrmNotes = {
        ...currentCrm,
        decisionMakerInsights: insights
      };
      const updatedStock: PharmacyVisitStockState = {
        ...currentStock,
        crmNotes: updatedCrm,
        lastEvaluatedAt: new Date().toISOString()
      };
      newState = {
        ...state,
        draft: {
          ...state.draft,
          stock: updatedStock,
          updatedAt: new Date().toISOString()
        }
      };
      logCrmNotesDiagnostic(state.draft.draftId, updatedCrm);
      break;
    }

    case "REMOVE_DECISION_MAKER_INSIGHT": {
      const currentStock = state.draft.stock || { noStockRequestRequired: false, requestLines: [] };
      const currentCrm = currentStock.crmNotes || {};
      const insights = (currentCrm.decisionMakerInsights || []).filter(i => i.id !== action.payload.id);
      const updatedCrm: PharmacyCrmNotes = {
        ...currentCrm,
        decisionMakerInsights: insights
      };
      const updatedStock: PharmacyVisitStockState = {
        ...currentStock,
        crmNotes: updatedCrm,
        lastEvaluatedAt: new Date().toISOString()
      };
      newState = {
        ...state,
        draft: {
          ...state.draft,
          stock: updatedStock,
          updatedAt: new Date().toISOString()
        }
      };
      logCrmNotesDiagnostic(state.draft.draftId, updatedCrm);
      break;
    }

    case "ADD_CUSTOMER_PAIN_POINT": {
      const currentStock = state.draft.stock || { noStockRequestRequired: false, requestLines: [] };
      const currentCrm = currentStock.crmNotes || {};
      const painPoints = [...(currentCrm.customerPainPoints || []), action.payload];
      const updatedCrm: PharmacyCrmNotes = {
        ...currentCrm,
        customerPainPoints: painPoints
      };
      const updatedStock: PharmacyVisitStockState = {
        ...currentStock,
        crmNotes: updatedCrm,
        lastEvaluatedAt: new Date().toISOString()
      };
      newState = {
        ...state,
        draft: {
          ...state.draft,
          stock: updatedStock,
          updatedAt: new Date().toISOString()
        }
      };
      logCrmNotesDiagnostic(state.draft.draftId, updatedCrm);
      break;
    }

    case "REMOVE_CUSTOMER_PAIN_POINT": {
      const currentStock = state.draft.stock || { noStockRequestRequired: false, requestLines: [] };
      const currentCrm = currentStock.crmNotes || {};
      const painPoints = (currentCrm.customerPainPoints || []).filter(p => p.id !== action.payload.id);
      const updatedCrm: PharmacyCrmNotes = {
        ...currentCrm,
        customerPainPoints: painPoints
      };
      const updatedStock: PharmacyVisitStockState = {
        ...currentStock,
        crmNotes: updatedCrm,
        lastEvaluatedAt: new Date().toISOString()
      };
      newState = {
        ...state,
        draft: {
          ...state.draft,
          stock: updatedStock,
          updatedAt: new Date().toISOString()
        }
      };
      logCrmNotesDiagnostic(state.draft.draftId, updatedCrm);
      break;
    }

    case "ADD_NEXT_ACTION": {
      const currentStock = state.draft.stock || { noStockRequestRequired: false, requestLines: [] };
      const currentCrm = currentStock.crmNotes || {};
      const actions = [...(currentCrm.nextActions || []), action.payload];
      const updatedCrm: PharmacyCrmNotes = {
        ...currentCrm,
        nextActions: actions
      };
      const updatedStock: PharmacyVisitStockState = {
        ...currentStock,
        crmNotes: updatedCrm,
        lastEvaluatedAt: new Date().toISOString()
      };
      newState = {
        ...state,
        draft: {
          ...state.draft,
          stock: updatedStock,
          updatedAt: new Date().toISOString()
        }
      };
      logCrmNotesDiagnostic(state.draft.draftId, updatedCrm);
      break;
    }

    case "REMOVE_NEXT_ACTION": {
      const currentStock = state.draft.stock || { noStockRequestRequired: false, requestLines: [] };
      const currentCrm = currentStock.crmNotes || {};
      const actions = (currentCrm.nextActions || []).filter(a => a.id !== action.payload.id);
      const updatedCrm: PharmacyCrmNotes = {
        ...currentCrm,
        nextActions: actions
      };
      const updatedStock: PharmacyVisitStockState = {
        ...currentStock,
        crmNotes: updatedCrm,
        lastEvaluatedAt: new Date().toISOString()
      };
      newState = {
        ...state,
        draft: {
          ...state.draft,
          stock: updatedStock,
          updatedAt: new Date().toISOString()
        }
      };
      logCrmNotesDiagnostic(state.draft.draftId, updatedCrm);
      break;
    }

    case "SET_GENERAL_NOTES": {
      const currentStock = state.draft.stock || { noStockRequestRequired: false, requestLines: [] };
      const currentCrm = currentStock.crmNotes || {};
      const updatedCrm: PharmacyCrmNotes = {
        ...currentCrm,
        generalNotes: action.payload
      };
      const updatedStock: PharmacyVisitStockState = {
        ...currentStock,
        crmNotes: updatedCrm,
        lastEvaluatedAt: new Date().toISOString()
      };
      newState = {
        ...state,
        draft: {
          ...state.draft,
          stock: updatedStock,
          updatedAt: new Date().toISOString()
        }
      };
      logCrmNotesDiagnostic(state.draft.draftId, updatedCrm);
      break;
    }

    case "SET_FOLLOW_UP": {
      const currentStock = state.draft.stock || { noStockRequestRequired: false, requestLines: [] };
      const updatedStock: PharmacyVisitStockState = {
        ...currentStock,
        followUp: action.payload,
        lastEvaluatedAt: new Date().toISOString()
      };
      newState = {
        ...state,
        draft: {
          ...state.draft,
          stock: updatedStock,
          updatedAt: new Date().toISOString()
        }
      };
      logFollowUpDiagnostic(state.draft.draftId, action.payload);
      break;
    }

    case "CLEAR_FOLLOW_UP": {
      const currentStock = state.draft.stock || { noStockRequestRequired: false, requestLines: [] };
      const updatedStock: PharmacyVisitStockState = {
        ...currentStock,
        followUp: { required: false, taskPersistencePending: true },
        lastEvaluatedAt: new Date().toISOString()
      };
      newState = {
        ...state,
        draft: {
          ...state.draft,
          stock: updatedStock,
          updatedAt: new Date().toISOString()
        }
      };
      logFollowUpDiagnostic(state.draft.draftId, updatedStock.followUp);
      break;
    }

    case "COMPLETE_STEP_5": {
      newState = {
        ...state,
        draft: {
          ...state.draft,
          currentStep: 6,
          status: "IN_PROGRESS",
          updatedAt: new Date().toISOString()
        }
      };
      break;
    }

    default:
      return state;
  }

  if (previousStep !== newState.draft.currentStep || previousStatus !== newState.draft.status) {
    console.info(
      "[PHARMACY_VISIT_STEP_TRANSITION_JSON]",
      JSON.stringify({
        fromStep: previousStep,
        toStep: newState.draft.currentStep,
        fromStatus: previousStatus,
        toStatus: newState.draft.status,
        pharmacyId: newState.draft.pharmacyId,
        timestamp: new Date().toISOString()
      })
    );
  }

  return newState;
}
