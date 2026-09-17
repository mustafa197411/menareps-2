import { executeCollectionReversal, resolveCollectionReversal } from "./server/collectionReversalService";
import { executeCollectionVerification } from "./server/collectionVerificationService";
import { executeCollectionSubmission } from "./server/collectionSubmissionService";
import { OfferRuntimeError } from "./server/pharmacyOfferReadService";
import express, { Request, Response } from "express";
import path from "path";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { requireFirebaseAuth, AuthenticatedRequest } from "./server/authMiddleware";
import { requireAttendanceSchedulerAuth, type SchedulerAuthenticatedRequest } from "./server/attendanceSchedulerAuth";
import { isFirebaseAdminAvailable, getFirebaseAdminServices } from "./server/firebaseAdmin";
import { runTargetCalculation } from "./src/lib/targetCalculationService";
import { createTargetCalculationRunId } from "./src/lib/productTargetIdService";
import { validateImportBatch, commitImportBatch, rollbackImportBatch } from "./src/lib/targetImportService";
import { rebuildPerformanceData, getPerformanceSummary } from "./src/lib/productTargetPerformanceServerService";
import { claimActivationProfileServer } from "./server/authActivationService";
import { createFirestoreOrganizationalHierarchyRepository } from "./server/organizationalHierarchyRepository";
import { OrganizationalHierarchyError, resolveOrganizationalScope } from "./server/organizationalHierarchyService";
import {
  createFirestoreOperationalScopeRepository,
  resolveOperationalScopeForActor,
  readActorMarketContext,
} from "./server/operationalScopeRepository";
import { OperationalScopeError } from "./server/operationalScopeService";
import { isValidScopedPhysicianReadRequest, resolveScopedPhysicianRead } from "./server/physicianReadService";
import { isValidScopedPharmacyReadRequest, resolveScopedPharmacyRead } from "./server/pharmacyReadService";
import { parsePhysicianVisitReadControls, resolveScopedPhysicianVisitRead } from "./server/physicianVisitReadService";
import { parsePhysicianVisitHistoryRequest, resolveScopedPhysicianVisitHistory } from "./server/physicianVisitHistoryService";
import { resolveAiUnavailableResponse } from "./server/aiAvailabilityService";
import { executeScopedVisitMarketingRequestRead, executeVisitMarketingRequestCreate, executeVisitMarketingRequestTransition, parseVisitMarketingRequestCreate, parseVisitMarketingRequestTransition, VisitMarketingRequestError } from "./server/visitMarketingRequestService";
import { executeMedicalPlannerMutation, MedicalPlannerMutationError, parseMedicalPlannerMutationRequest } from "./server/medicalPlannerMutationService";
import {
  executeMedicalPlannerScopedAction,
  MedicalPlannerScopeError,
  parseMedicalPlannerActionRequest,
  parseMedicalPlannerReadRequest,
  resolveMedicalPlannerScopedRead,
} from "./server/medicalPlannerScopeService";
import { parsePharmacyVisitReadControls, resolveScopedPharmacyVisitRead } from "./server/pharmacyVisitReadService";
import { parsePharmacyOrderReadRequest, resolveScopedPharmacyOrderRead } from "./server/pharmacyOrderReadService";
import {
  executeOrderOperationsTransition,
  parseOrderOperationsTransitionRequest,
} from "./server/orderOperationsTransitionService";
import {
  parseOrderWorkflowDetailReadRequest,
  resolveOrderWorkflowDetailRead,
} from "./server/orderWorkflowDetailReadService";
import {
  parseOrderWorkflowQueueControls,
  resolveOrderWorkflowQueueRead,
} from "./server/orderWorkflowQueueReadService";
import {
  executeDeliveryAssign,
  parseDeliveryAssignRequest,
  resolveEligibleDeliveryOfficers,
} from "./server/deliveryAssignmentService";
import { parseAllocatedBatchRequest, resolveAllocatedBatchesForRepresentative } from "./server/sampleAllocatedBatchService";
import { resolveSampleVisitOptions } from "./server/sampleVisitOptionsService";
import { CanonicalSampleDistributionError, executeStandaloneSampleDistribution, parseStandaloneSampleDistributionRequest } from "./server/sampleDistributionService";
import { executeSampleApprovalDecision, parseSampleApprovalDecisionRequest, SampleApprovalError } from "./server/sampleApprovalService";
import { executeStandaloneSampleRequest, parseStandaloneSampleRequestInput, SampleRequestError } from "./server/sampleRequestService";
import { executeSampleAdjustment, executeSampleAllocation, executeSampleReceipt, executeSampleVariantMutation, parseSampleAdjustmentCommand, parseSampleAllocationCommand, parseSampleReceiptCommand, parseSampleVariantCommand, SampleMutationError } from "./server/sampleMutationService";
import { parseTeamActivityReadControls, resolveScopedTeamActivityRead } from "./server/teamActivityReadService";
import { executeLeaveRequestMutation, parseLeaveRequestMutation } from "./server/leaveRequestMutationService";
import { resolveScopedProductAnalytics } from "./server/productAnalyticsReadService";
import { executeAttendanceRecovery, executeScheduledAttendanceRecovery, parseAttendanceRecoveryRequest } from "./server/attendanceRecoveryService";
import { executeAttendanceMutation, parseAttendanceMutation } from "./server/attendanceMutationService";
import { parseCommercialReadRequest, resolveScopedCommercialRead } from "./server/commercialReadService";
import { parsePharmacyOfferReadRequest, resolveScopedPharmacyOffers } from "./server/pharmacyOfferReadService";
import { executeAtomicCommercialDeliveryCompletion, executeCommercialOrderTransition, parseCommercialOrderTransition } from "./server/commercialOrderTransitionService";
import { executePharmacyOrderCreate, parsePharmacyOrderCreateRequest } from "./server/pharmacyOrderCreateService";
import { parsePharmacyProductAvailabilityRequest, resolvePharmacyProductAvailability } from "./server/pharmacyProductAvailabilityService";
import { executePharmacyVisitCompletion, parsePharmacyVisitCompletionRequest, PharmacyVisitCompletionError } from "./server/pharmacyVisitCompletionService";
import { executePhysicianVisitWrite, parsePhysicianVisitWriteRequest, PhysicianVisitWriteError } from "./server/physicianVisitWriteService";
import { executePhysicianCreate, parsePhysicianCreateRequest, PhysicianCreateError } from "./server/physicianCreateService";
import { executeProductMutation, executeProductMutationBatch, MAX_PRODUCT_IMPORT_COMMANDS, parseProductMutationBatchRequest, parseProductMutationRequest, ProductPersistenceError } from "./server/productPersistenceService";
import { executeKeyMessageMutation, KeyMessageMutationError, parseKeyMessageMutation } from "./server/keyMessageMutationService";
import { executeNavigationGovernanceMutation, NavigationGovernanceMutationError, parseNavigationGovernanceMutation } from "./server/navigationGovernanceMutationService";
import { finalizeResourceUpload, initiateResourceUpload, mutateResourceMetadata, parseResourceUploadAuthorization, ResourceUploadError, validateResourceUploadOrigin } from "./server/resourceUploadService";
import { authorizeResourceRead, createPhysicianVisitContext, discoverManagementResources, discoverProductResources, discoverVisitResources, parseSingleRange, parseVisitContextCreate, publicResourceReadError, readActiveHotspots, ResourceReadError, type ResourceReadContext } from "./server/resourceReadService";
import { createHotspot, deactivateHotspot, discoverManagedHotspots, HotspotError, parseHotspotMutation, publicHotspotReadError, recordHotspotInteraction, updateHotspot } from "./server/hotspotService";
import { executeScopedContentMutation, parseScopedContentMutation, ScopedContentMutationError } from "./server/scopedContentMutationService";
import { createSupervisorAppraisal, createSupervisorVisit, finalReviewSupervisorAppraisal, keepSupervisorAppraisalUnchanged, openSupervisorAppraisalRevision, parseAppraisalCreate, parseAppraisalDraftSave, parseAppraisalFinalRepresentativeReview, parseAppraisalKeepUnchanged, parseAppraisalOpenRevision, parseAppraisalRepresentativeReview, parseAppraisalRevisionSave, parseAppraisalSignOff, parseAppraisalSubmit, parseSupervisorCustomerVisitHistoryRequest, parseSupervisorRepresentativeEligibilityRequest, parseSupervisorVisitCreate, parseSupervisorVisitReschedule, parseSupervisorVisitTransition, readEligibleSupervisorRepresentatives, readSupervisorAppraisals, readSupervisorCustomerVisitHistory, readSupervisorVisitOptions, readSupervisorVisits, rescheduleSupervisorVisit, reviewSupervisorAppraisal, saveSupervisorAppraisalDraft, saveSupervisorAppraisalRevision, signOffSupervisorAppraisal, submitSupervisorAppraisal, submitSupervisorAppraisalRevision, SupervisorVisitError, transitionSupervisorVisit } from "./server/supervisorVisitService";
import { canAccessView } from "./src/lib/userPolicyEngine";
import type { Permissions, Role, User } from "./src/types";
import { parseProvisioningRequest, authorizeProvisioning, assertSingletonProvisioningRoleAvailable } from "./server/userProvisioningService";
import { persistAuthoritativeAuditEvent } from "./server/auditEventService";
import {
  createFirestoreOfferRepository,
  createOfferDraft,
  listOffers,
  mutateOffer,
  OfferAdministrationError,
  readOffer,
  readOfferProductOptions,
  readOfferRepresentativeOptions,
  resolveProductConfigurationActor,
  resolveOfferAdministrationActor,
  offerAdministrationResponse,
} from "./server/offerAdministrationService";
import { parseOfferDraftRequest, parseOfferMutationRequest, parseOfferRepresentativeRequest, parseOfferProductRequest } from "./server/offerAdministrationRequestContract";
import { createFirestoreCommercialMarketRegistryRepository } from "./server/commercialMarketRegistryRepository";
import { createOfferCommercialRegistryDependencies } from "./server/offerCommercialRegistryAdapter";
import {
  parseProductMarketCatalogRequest,
  ProductMarketCatalogError,
  readProductMarketRelationships,
  saveProductMarketCatalog,
} from "./server/productMarketCatalogConfigurationService";
import { getFirebaseRuntimeIdentity } from "./server/firebaseRuntimeIdentity";
import { assertProductionAssets, resolveReleaseRuntime } from "./server/releaseRuntime";
import { 
  submitPlan, 
  approvePlan, 
  rejectPlan, 
  activatePlan, 
  amendPlan, 
  closePlan, 
  cancelPlan 
} from "./src/lib/productTargetLifecycleService";


dotenv.config();

// Initialize Gemini client lazily/safely
let aiClient: GoogleGenAI | null = null;
function getAi(): GoogleGenAI | null {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (key && key !== "MY_GEMINI_API_KEY") {
      try {
        aiClient = new GoogleGenAI({
          apiKey: key,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            }
          }
        });
      } catch (err) {
        console.error("Failed to initialize Gemini AI SDK client:", err);
      }
    }
  }
  return aiClient;
}

// Track API rate limiting/quota state globally to bypass slow retries when key is exhausted
let lastRateLimitTime = 0;
const RATE_LIMIT_COOLDOWN_MS = 60000; // 1 minute cooldown

function isApiRateLimited(): boolean {
  if (lastRateLimitTime === 0) return false;
  const elapsed = Date.now() - lastRateLimitTime;
  if (elapsed < RATE_LIMIT_COOLDOWN_MS) {
    return true;
  }
  return false;
}

// Robust helper function to execute Gemini requests with retries and model fallback
async function generateContentWithRetry(
  ai: GoogleGenAI,
  model: string,
  contents: string,
  config: { temperature: number },
  retries = 3,
  delay = 1000
): Promise<any> {
  let lastError: any = null;
  for (let i = 0; i <= retries; i++) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents,
        config,
      });
      return response;
    } catch (err: any) {
      lastError = err;
      const errMsg = (err.message || (typeof err === "object" ? JSON.stringify(err) : String(err))).toUpperCase();
      
      // If we hit a 429 rate limit or quota exhausted, immediately update global throttle to prevent slow loops
      if (errMsg.includes("429") || errMsg.includes("RESOURCE_EXHAUSTED") || errMsg.includes("QUOTA") || errMsg.includes("LIMIT")) {
        console.warn("[Gemini SDK] Quota limit reached (429). Activating local dynamic CRM intelligence backup for 60 seconds.");
        lastRateLimitTime = Date.now();
        break; // Stop retrying instantly to preserve performance
      }

      const isRetryable = 
        errMsg.includes("503") || 
        errMsg.includes("UNAVAILABLE") || 
        errMsg.includes("500") || 
        errMsg.includes("TIMEOUT") ||
        errMsg.includes("OVERLOADED") ||
        errMsg.includes("DEMAND");

      if (isRetryable && i < retries) {
        const backoff = delay * Math.pow(2, i);
        console.warn(`[Gemini SDK] Model temporarily busy/unavailable. Retrying in ${backoff}ms (attempt ${i + 1}/${retries})...`);
        await new Promise(resolve => setTimeout(resolve, backoff));
      } else {
        break;
      }
    }
  }

  // Fallback to stable alternatives if primary fails and API is not fully blocked
  if (model === "gemini-3.5-flash" && !isApiRateLimited()) {
    console.warn(`[Gemini SDK] Primary model busy after retries. Trying alternative model gemini-3.1-flash-lite...`);
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite",
        contents,
        config,
      });
      return response;
    } catch (fallbackErr: any) {
      // Do not log full stack/JSON
      console.warn(`[Gemini SDK] Alternative model gemini-3.1-flash-lite also busy.`);
    }

    console.warn(`[Gemini SDK] Trying secondary alternative model gemini-flash-latest...`);
    try {
      const response = await ai.models.generateContent({
        model: "gemini-flash-latest",
        contents,
        config,
      });
      return response;
    } catch (fallbackErr2: any) {
      // Do not log full stack/JSON
      console.warn(`[Gemini SDK] Alternative model gemini-flash-latest also busy.`);
    }
  }

  throw lastError;
}

// Sequence API requests via a promise chain to prevent parallel bursts of quota-consuming operations
let apiQueueChain: Promise<any> = Promise.resolve();

async function serializedGenerate(ai: GoogleGenAI, prompt: string, action: string, payload: any): Promise<string> {
  return new Promise((resolve, reject) => {
    apiQueueChain = apiQueueChain.then(async () => {
      // Re-evaluate rate limit state inside the queue execution sequence
      if (isApiRateLimited()) {
        reject(new Error("AI_RATE_LIMITED"));
        return;
      }

      try {
        const response = await generateContentWithRetry(ai, "gemini-3.5-flash", prompt, {
          temperature: 0.7,
        });
        const responseText = response.text;
        if (!responseText) throw new Error("AI_EMPTY_RESPONSE");
        resolve(responseText);
      } catch (error: any) {
        const errMsg = [
          error?.message,
          error?.status,
          error?.code,
          typeof error === "object" ? JSON.stringify(error) : ""
        ].filter(Boolean).join(" ").toUpperCase();

        if (errMsg.includes("429") || errMsg.includes("RESOURCE_EXHAUSTED") || errMsg.includes("QUOTA") || errMsg.includes("LIMIT")) {
          console.warn("[Gemini SDK] Rate limit triggered in serialized queue. Throttling subsequent requests.");
          lastRateLimitTime = Date.now();
        } else {
          console.warn(`[Gemini SDK] Insight request failed for action '${action}'.`);
        }
        reject(error);
      }
    });
  });
}


async function startServer() {
  // Resolve once before binding a port so a production process cannot start
  // against an implicit or inconsistent Firebase project/database identity.
  const firebaseRuntimeIdentity = getFirebaseRuntimeIdentity();
  const releaseRuntime = resolveReleaseRuntime(process.env);
  assertProductionAssets(releaseRuntime, fs.existsSync(path.join(process.cwd(), "dist", "index.html")));
  // Initialize the governed backend before binding. Invalid runtime identity or
  // unavailable Admin initialization must leave the revision unable to receive traffic.
  const firebaseAdmin = getFirebaseAdminServices();
  const offerRepository = createFirestoreOfferRepository(firebaseAdmin.db);
  const offerHierarchyRepository = createFirestoreOrganizationalHierarchyRepository();
  const offerProductRepository = createFirestoreCommercialMarketRegistryRepository(firebaseAdmin.db);
  const offerCommercialDependencies = createOfferCommercialRegistryDependencies(
    createFirestoreCommercialMarketRegistryRepository(firebaseAdmin.db),
  );
  const app = express();
  app.use(express.json());

  // Alive health check
  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      service: "menareps-crm-backend",
    });
  });

  // Readiness is distinct from process liveness and reports only non-secret
  // release/runtime identity required to verify the serving revision.
  app.get("/api/ready", (_req: Request, res: Response) => {
    if (!isFirebaseAdminAvailable()) {
      return res.status(503).json({ status: "not-ready", code: "ADMIN_CREDENTIALS_UNAVAILABLE" });
    }
    return res.json({
      status: "ready",
      releaseId: releaseRuntime.releaseId,
      gitCommit: releaseRuntime.gitCommit,
      firebaseProjectId: firebaseRuntimeIdentity.projectId,
      firestoreDatabaseId: firebaseRuntimeIdentity.databaseId,
      finalS2Fingerprint: releaseRuntime.finalS2Fingerprint,
    });
  });

  app.get("/api/runtime-identity", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      appVersion: process.env.npm_package_version || "2.0.0",
      gitCommit: releaseRuntime.gitCommit,
      buildTimestamp: releaseRuntime.buildTimestamp,
      cloudRunRevision: releaseRuntime.cloudRunRevision,
      releaseId: releaseRuntime.releaseId,
      firebaseProjectId: firebaseRuntimeIdentity.projectId,
      firestoreDatabaseId: firebaseRuntimeIdentity.databaseId,
      finalS2Fingerprint: releaseRuntime.finalS2Fingerprint,
    });
  });

  // Firebase Admin health check
  app.get("/api/health/firebase-admin", (req: Request, res: Response) => {
    if (isFirebaseAdminAvailable()) {
      return res.json({
        status: "ok",
        firebaseAdmin: true,
        firestore: true
      });
    } else {
      return res.status(503).json({
        status: "degraded",
        firebaseAdmin: false,
        firestore: false,
        code: "ADMIN_CREDENTIALS_UNAVAILABLE"
      });
    }
  });

  app.post("/api/organizational-scope", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    try {
      const result = await resolveOrganizationalScope(
        authReq.authUid,
        req.body || {},
        createFirestoreOrganizationalHierarchyRepository(),
      );
      console.info("[ORGANIZATIONAL_SCOPE_AUDIT]", JSON.stringify({
        actorUid: authReq.authUid,
        depth: req.body?.depth || "descendants",
        resultCount: result.allHierarchyUids.length,
      }));
      return res.json(result);
    } catch (error) {
      if (error instanceof OrganizationalHierarchyError) {
        return res.status(error.httpStatus).json({ error: error.message, code: error.code });
      }
      console.error("[ORGANIZATIONAL_SCOPE_ERROR]", error);
      return res.status(500).json({ error: "Hierarchy resolution failed", code: "HIERARCHY_RESOLUTION_FAILED" });
    }
  });

  app.post("/api/operational-scope", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    try {
      const result = await resolveOperationalScopeForActor(
        authReq.authUid!,
        { actorUid: req.body?.actorUid },
        createFirestoreOperationalScopeRepository(),
      );
      console.info("[OPERATIONAL_SCOPE_AUDIT]", JSON.stringify({
        actorUid: authReq.authUid,
        authorized: result.authorized,
        code: result.code || "AUTHORIZED",
        subjectCount: result.subjectUids.length,
        areaCount: result.areaIds.length,
        productCount: result.productIds.length,
      }));
      const countryId = result.countryIds.length === 1 ? result.countryIds[0] : undefined;
      const marketContext = result.authorized && !result.queryPlan.denyAll
        && result.actorUid === authReq.authUid && typeof countryId === "string"
        && countryId.length > 0 && countryId === countryId.trim() && !countryId.includes("/")
        ? await readActorMarketContext({ countryId }, firebaseAdmin.db)
        : { status: "UNRESOLVED" as const };
      return res.status(result.authorized ? 200 : 403).json({ ...result, marketContext });
    } catch (error) {
      if (error instanceof OrganizationalHierarchyError) {
        return res.status(error.httpStatus).json({ error: error.message, code: error.code });
      }
      if (error instanceof OperationalScopeError) {
        return res.status(500).json({ error: "Operational scope resolution failed closed", code: error.code });
      }
      console.error("[OPERATIONAL_SCOPE_ERROR]", error);
      return res.status(500).json({ error: "Operational scope resolution failed closed", code: "OPERATIONAL_SCOPE_RESOLUTION_FAILED" });
    }
  });

  const offerError = (res: Response, error: unknown, fallbackCode = "OFFER_WRITE_FAILED") => {
    if (error instanceof OfferAdministrationError) return res.status(error.status).json({ code: error.code });
    console.error("[OFFER_ADMINISTRATION_ERROR]", error);
    return res.status(500).json({ code: fallbackCode });
  };
  const offerActor = async (request: Request) => {
    const authenticated = request as AuthenticatedRequest;
    return resolveOfferAdministrationActor(authenticated.authUid!, authenticated.user, getFirebaseAdminServices().db);
  };

  app.get("/api/offers", requireFirebaseAuth, async (req: Request, res: Response) => {
    try {
      const actor = await offerActor(req);
      return res.status(200).json({ ...offerAdministrationResponse(actor), ...await listOffers(actor, offerRepository, offerHierarchyRepository, req.query) });
    } catch (error) {
      if (!(error instanceof OfferAdministrationError)) console.error("[OFFER_ADMINISTRATION_READ_ERROR]", error);
      return error instanceof OfferAdministrationError
        ? res.status(error.status).json({ code: error.code })
        : res.status(500).json({ code: "OFFER_READ_FAILED" });
    }
  });

  app.get("/api/offers/drafts", requireFirebaseAuth, (_req: Request, res: Response) => {
    return res.status(400).json({ code: "OFFER_LIST_ENDPOINT_REQUIRED" });
  });

  app.get("/api/offers/product-options", requireFirebaseAuth, async (req: Request, res: Response) => {
    try {
      const controls = parseOfferProductRequest(req.query);
      if (!controls) throw new OfferAdministrationError("OFFER_INVALID_REQUEST", 400);
      return res.status(200).json(await readOfferProductOptions(await offerActor(req), offerProductRepository, controls.continuation, { offerId: controls.offerId, repository: offerRepository, hierarchy: offerHierarchyRepository }));
    } catch (error) { return offerError(res, error, "OFFER_READ_FAILED"); }
  });
  app.post("/api/offers/representative-options", requireFirebaseAuth, async (req: Request, res: Response) => {
    try {
      const controls = parseOfferRepresentativeRequest(req.body);
      if (!controls) throw new OfferAdministrationError("OFFER_INVALID_REQUEST", 400);
      return res.status(200).json(await readOfferRepresentativeOptions(await offerActor(req), controls, offerRepository, offerHierarchyRepository));
    } catch (error) {
      if (error instanceof OrganizationalHierarchyError) return res.status(error.httpStatus).json({ code: error.code });
      return offerError(res, error, "OFFER_READ_FAILED");
    }
  });
  const productConfigurationActor = (request: Request) => {
    const authenticated = request as AuthenticatedRequest;
    return resolveProductConfigurationActor(authenticated.authUid!, authenticated.user, firebaseAdmin.db);
  };

  app.post("/api/products/market-catalog/options", requireFirebaseAuth, async (req: Request, res: Response) => {
    try {
      const actor = await productConfigurationActor(req);
      const productIds = Array.isArray(req.body?.productIds) ? req.body.productIds : [];
      return res.status(200).json({ relationships: await readProductMarketRelationships(actor, productIds, offerCommercialDependencies) });
    } catch (error) { return productMarketError(res, error, "PRODUCT_MARKET_READ_FAILED"); }
  });

  const productMarketError = (res: Response, error: unknown, fallback: "PRODUCT_MARKET_READ_FAILED" | "PRODUCT_MARKET_WRITE_FAILED") => {
    if (error instanceof ProductMarketCatalogError) return res.status(error.status).json({ code: error.code });
    console.error("[PRODUCT_MARKET_CATALOG_ERROR]", error);
    return res.status(500).json({ code: fallback });
  };

  app.post("/api/products/market-catalog/save", requireFirebaseAuth, async (req: Request, res: Response) => {
    try {
      const actor = await productConfigurationActor(req);
      const request = parseProductMarketCatalogRequest(req.body, true);
      return res.status(200).json(await saveProductMarketCatalog(actor, request, firebaseAdmin.db));
    } catch (error) { return productMarketError(res, error, "PRODUCT_MARKET_WRITE_FAILED"); }
  });

  app.get("/api/offers/:offerId", requireFirebaseAuth, async (req: Request, res: Response) => {
    try {
      const actor = await offerActor(req);
      return res.status(200).json({ ...offerAdministrationResponse(actor), record: await readOffer(actor, req.params.offerId, offerRepository, offerHierarchyRepository) });
    } catch (error) {
      if (!(error instanceof OfferAdministrationError)) console.error("[OFFER_ADMINISTRATION_READ_ERROR]", error);
      return error instanceof OfferAdministrationError
        ? res.status(error.status).json({ code: error.code })
        : res.status(500).json({ code: "OFFER_READ_FAILED" });
    }
  });

  app.post("/api/offers/drafts", requireFirebaseAuth, async (req: Request, res: Response) => {
    try {
      const actor = await offerActor(req);
      const definition = parseOfferDraftRequest(req.body);
      if (!definition) throw new OfferAdministrationError("OFFER_INVALID_REQUEST", 400);
      const offer = await createOfferDraft(actor, definition, offerRepository, offerHierarchyRepository);
      return res.status(201).json({ offer });
    } catch (error) { return offerError(res, error); }
  });

  app.post("/api/offers/actions", requireFirebaseAuth, async (req: Request, res: Response) => {
    try {
      const actor = await offerActor(req);
      const command = parseOfferMutationRequest(req.body);
      if (!command) throw new OfferAdministrationError("OFFER_INVALID_REQUEST", 400);
      const offer = await mutateOffer(actor, command, offerRepository, offerHierarchyRepository);
      return res.status(200).json({ offer });
    } catch (error) { return offerError(res, error); }
  });

  app.post("/api/physicians/scoped-query", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    if (!isValidScopedPhysicianReadRequest(req.body)) {
      return res.status(400).json({ authorized: false, code: "INVALID_SCOPED_PHYSICIAN_REQUEST", physicians: [] });
    }
    try {
      const result = await resolveScopedPhysicianRead(authReq.authUid!);
      return res.status(result.authorized ? 200 : 403).json(result);
    } catch (error) {
      console.error("[SCOPED_PHYSICIAN_READ_ERROR]", error);
      return res.status(500).json({
        authorized: false,
        code: "SCOPED_PHYSICIAN_READ_FAILED",
        physicians: [],
      });
    }
  });

  app.post("/api/physicians/create", requireFirebaseAuth, async (req: Request, res: Response) => {
    const command = parsePhysicianCreateRequest(req.body);
    if (!command) return res.status(400).json({ code: "VALIDATION_FAILED" });
    try { return res.status(200).json(await executePhysicianCreate((req as AuthenticatedRequest).authUid!, command, getFirebaseAdminServices().db)); }
    catch (error) { if (error instanceof PhysicianCreateError) return res.status(error.status).json({ code: error.code }); throw error; }
  });

  app.post("/api/products/mutate", requireFirebaseAuth, async (req: Request, res: Response) => {
    if (Array.isArray(req.body?.commands) && (req.body.commands.length < 1 || req.body.commands.length > MAX_PRODUCT_IMPORT_COMMANDS)) return res.status(400).json({ code: "PRODUCT_IMPORT_BATCH_SIZE_INVALID" });
    const batchCommands = parseProductMutationBatchRequest(req.body);
    const command = parseProductMutationRequest(req.body);
    if (!command && !batchCommands) return res.status(400).json({ code: "PRODUCT_REQUEST_INVALID" });
    const authenticated = req as AuthenticatedRequest;
    try {
      const db = getFirebaseAdminServices().db;
      return res.status(200).json(command
        ? await executeProductMutation(authenticated.authUid!, authenticated.user, command, db)
        : await executeProductMutationBatch(authenticated.authUid!, authenticated.user, batchCommands!, db));
    } catch (error) {
      if (error instanceof ProductPersistenceError) return res.status(error.status).json({ code: error.code });
      console.error("[PRODUCT_PERSISTENCE_ERROR]", error);
      return res.status(500).json({ code: "PRODUCT_WRITE_FAILED" });
    }
  });

  app.post("/api/resources/uploads/initiate", requireFirebaseAuth, async (req: Request, res: Response) => {
    const command = parseResourceUploadAuthorization(req.body);
    if (!command) return res.status(400).json({ code: "RESOURCE_UPLOAD_REQUEST_INVALID" });
    try {
      const origin = validateResourceUploadOrigin(req.get("origin"), req.get("host"));
      return res.status(200).json(await initiateResourceUpload((req as AuthenticatedRequest).authUid!, command, origin));
    }
    catch (error) { if (error instanceof ResourceUploadError) return res.status(error.status).json({ code: error.code }); throw error; }
  });

  app.post("/api/resources/uploads/finalize", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authorizationId = typeof req.body?.authorizationId === "string" ? req.body.authorizationId.trim() : "";
    try { return res.status(200).json(await finalizeResourceUpload((req as AuthenticatedRequest).authUid!, authorizationId)); }
    catch (error) { if (error instanceof ResourceUploadError) return res.status(error.status).json({ code: error.code }); throw error; }
  });
  app.post("/api/resources/metadata/mutate", requireFirebaseAuth, async (req: Request, res: Response) => {
    const resourceId = typeof req.body?.resourceId === "string" ? req.body.resourceId.trim() : "", patch = req.body?.patch;
    try { return res.status(200).json(await mutateResourceMetadata((req as AuthenticatedRequest).authUid!, { resourceId, patch })); }
    catch (error) { if (error instanceof ResourceUploadError) return res.status(error.status).json({ code: error.code }); throw error; }
  });

  const resourceError = (res: Response, error: unknown) => {
    const safe = publicResourceReadError(error);
    if (error instanceof ResourceReadError) console.warn("[RESOURCE_READ_DENIED]", { publicCode: safe.code, internalCode: error.internalCode, status: error.status });
    return res.status(safe.status).json({ code: safe.code });
  };
  const readContext = (value: any): ResourceReadContext | null => {
    if (!value || typeof value !== "object" || Array.isArray(value) || !["MANAGEMENT", "PHYSICIAN_VISIT", "PRODUCT_DETAIL"].includes(value.purpose)) return null;
    return { purpose: value.purpose, ...(typeof value.contextId === "string" ? { contextId: value.contextId.trim() } : {}), ...(typeof value.productId === "string" ? { productId: value.productId.trim() } : {}) };
  };

  app.post("/api/resources/visit-contexts", requireFirebaseAuth, async (req: Request, res: Response) => {
    const command = parseVisitContextCreate(req.body);
    if (!command) return res.status(400).json({ code: "RESOURCE_READ_CONTEXT_INVALID" });
    try { return res.status(201).json(await createPhysicianVisitContext((req as AuthenticatedRequest).authUid!, command, { db: getFirebaseAdminServices().db })); }
    catch (error) { return resourceError(res, error); }
  });
  app.get("/api/resources/management", requireFirebaseAuth, async (req: Request, res: Response) => {
    try { return res.status(200).json(await discoverManagementResources((req as AuthenticatedRequest).authUid!, { db: getFirebaseAdminServices().db })); }
    catch (error) { return resourceError(res, error); }
  });
  app.post("/api/resources/visit/discover", requireFirebaseAuth, async (req: Request, res: Response) => {
    const contextId = typeof req.body?.contextId === "string" ? req.body.contextId.trim() : "";
    if (!contextId) return res.status(400).json({ code: "RESOURCE_READ_CONTEXT_INVALID" });
    try { return res.status(200).json(await discoverVisitResources((req as AuthenticatedRequest).authUid!, contextId, { db: getFirebaseAdminServices().db })); }
    catch (error) { return resourceError(res, error); }
  });
  app.post("/api/resources/product/discover", requireFirebaseAuth, async (req: Request, res: Response) => {
    const productId = typeof req.body?.productId === "string" ? req.body.productId.trim() : "";
    if (!productId) return res.status(400).json({ code: "RESOURCE_READ_CONTEXT_INVALID" });
    try { return res.status(200).json(await discoverProductResources((req as AuthenticatedRequest).authUid!, productId, { db: getFirebaseAdminServices().db })); }
    catch (error) { return resourceError(res, error); }
  });
  app.post("/api/resources/:resourceId/hotspots", requireFirebaseAuth, async (req: Request, res: Response) => {
    const context = readContext(req.body?.context), pageNumber = req.body?.pageNumber === undefined ? undefined : Number(req.body.pageNumber);
    if (!context || (pageNumber !== undefined && (!Number.isInteger(pageNumber) || pageNumber < 1))) return res.status(400).json({ code: "RESOURCE_READ_CONTEXT_INVALID" });
    try { return res.status(200).json(await readActiveHotspots((req as AuthenticatedRequest).authUid!, req.params.resourceId, context, pageNumber, { db: getFirebaseAdminServices().db })); }
    catch (error) { return resourceError(res, error); }
  });
  const hotspotError = (res: Response, error: unknown, conceal = false) => {
    const safe = conceal ? publicHotspotReadError(error) : error;
    if (safe instanceof HotspotError) return res.status(safe.status).json({ code: safe.code });
    throw error;
  };
  app.post("/api/resources/:resourceId/hotspots/manage/discover", requireFirebaseAuth, async (req: Request, res: Response) => {
    try { return res.status(200).json(await discoverManagedHotspots((req as AuthenticatedRequest).authUid!, req.params.resourceId, getFirebaseAdminServices().db)); }
    catch (error) { return hotspotError(res, error); }
  });
  app.post("/api/resources/:resourceId/hotspots/manage/create", requireFirebaseAuth, async (req: Request, res: Response) => {
    const input = parseHotspotMutation(req.body); if (!input) return res.status(400).json({ code: "HOTSPOT_REQUEST_INVALID" });
    try { return res.status(201).json(await createHotspot((req as AuthenticatedRequest).authUid!, req.params.resourceId, input, getFirebaseAdminServices().db)); }
    catch (error) { return hotspotError(res, error); }
  });
  app.post("/api/resources/:resourceId/hotspots/:hotspotId/manage/update", requireFirebaseAuth, async (req: Request, res: Response) => {
    const input = parseHotspotMutation(req.body); if (!input) return res.status(400).json({ code: "HOTSPOT_REQUEST_INVALID" });
    try { return res.status(200).json(await updateHotspot((req as AuthenticatedRequest).authUid!, req.params.resourceId, req.params.hotspotId, input, getFirebaseAdminServices().db)); }
    catch (error) { return hotspotError(res, error); }
  });
  app.post("/api/resources/:resourceId/hotspots/:hotspotId/manage/deactivate", requireFirebaseAuth, async (req: Request, res: Response) => {
    try { return res.status(200).json(await deactivateHotspot((req as AuthenticatedRequest).authUid!, req.params.resourceId, req.params.hotspotId, getFirebaseAdminServices().db)); }
    catch (error) { return hotspotError(res, error); }
  });
  app.post("/api/resources/:resourceId/hotspots/:hotspotId/interactions", requireFirebaseAuth, async (req: Request, res: Response) => {
    const contextId = typeof req.body?.contextId === "string" ? req.body.contextId.trim() : "", productId = typeof req.body?.productId === "string" ? req.body.productId.trim() : "", usageSessionId = typeof req.body?.usageSessionId === "string" ? req.body.usageSessionId.trim() : undefined;
    try { return res.status(201).json(await recordHotspotInteraction((req as AuthenticatedRequest).authUid!, req.params.resourceId, req.params.hotspotId, { contextId, productId, ...(usageSessionId ? { usageSessionId } : {}) }, getFirebaseAdminServices().db)); }
    catch (error) { return hotspotError(res, error, true); }
  });
  app.post("/api/resources/:resourceId/binary", requireFirebaseAuth, async (req: Request, res: Response) => {
    const context = readContext(req.body?.context);
    if (!context) return res.status(400).json({ code: "RESOURCE_READ_CONTEXT_INVALID" });
    try {
      const services = getFirebaseAdminServices(), authorized = await authorizeResourceRead((req as AuthenticatedRequest).authUid!, req.params.resourceId, context, { db: services.db });
      const resource = authorized.resource, storagePath = typeof resource.storagePath === "string" ? resource.storagePath.trim() : "";
      const expectedPrefix = `resources/${resource.promotionGroupId}/${req.params.resourceId}/v${Number(resource.fileVersion)}/`;
      if (!storagePath.startsWith(expectedPrefix) || storagePath.includes("..")) throw new ResourceReadError("RESOURCE_BINARY_NOT_CURRENT", 409);
      const bucketName = process.env.FIREBASE_STORAGE_BUCKET || `${firebaseRuntimeIdentity.projectId}.firebasestorage.app`;
      const file = services.storage.bucket(bucketName).file(storagePath), [objectMetadata] = await file.getMetadata();
      const size = Number(objectMetadata.size), generation = String(objectMetadata.generation || ""), contentType = String(objectMetadata.contentType || resource.mimeType || "application/octet-stream");
      if (!Number.isSafeInteger(size) || size <= 0 || (resource.generation && String(resource.generation) !== generation) || (resource.fileSizeBytes && Number(resource.fileSizeBytes) !== size)) throw new ResourceReadError("RESOURCE_BINARY_NOT_CURRENT", 409);
      let range;
      try { range = parseSingleRange(req.get("range"), size); }
      catch (error) { if (error instanceof ResourceReadError) { res.setHeader("Content-Range", `bytes */${size}`); return res.status(error.status).json({ code: error.code }); } throw error; }
      const original = String(resource.originalFileName || resource.fileName || "resource-material").replace(/[\r\n"\\]/g, "_");
      res.setHeader("Content-Type", contentType); res.setHeader("Accept-Ranges", "bytes"); res.setHeader("Cache-Control", "private, no-store"); res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Disposition", `inline; filename="${original}"; filename*=UTF-8''${encodeURIComponent(original)}`);
      if (range) { res.status(206); res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${size}`); res.setHeader("Content-Length", String(range.end - range.start + 1)); }
      else { res.status(200); res.setHeader("Content-Length", String(size)); }
      const stream = file.createReadStream(range || undefined);
      stream.on("error", error => { console.error("[RESOURCE_BINARY_STREAM_ERROR]", error); if (!res.headersSent) res.status(502).json({ code: "RESOURCE_BINARY_UNAVAILABLE" }); else res.destroy(error as Error); });
      stream.pipe(res);
    } catch (error) { if (!res.headersSent) return resourceError(res, error); }
  });

  app.post("/api/content/mutate", requireFirebaseAuth, async (req: Request, res: Response) => {
    const command = parseScopedContentMutation(req.body); if (!command) return res.status(400).json({ code: "CONTENT_MUTATION_INVALID" });
    try { return res.status(200).json(await executeScopedContentMutation((req as AuthenticatedRequest).authUid!, command)); }
    catch (error) { if (error instanceof ScopedContentMutationError) return res.status(error.status).json({ code: error.code }); throw error; }
  });

  app.post("/api/pharmacies/scoped-query", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    if (!isValidScopedPharmacyReadRequest(req.body)) {
      return res.status(400).json({ authorized: false, code: "INVALID_SCOPED_PHARMACY_REQUEST", pharmacies: [] });
    }
    try {
      const result = await resolveScopedPharmacyRead(authReq.authUid!);
      return res.status(result.authorized ? 200 : 403).json(result);
    } catch (error) {
      console.error("[SCOPED_PHARMACY_READ_ERROR]", error);
      return res.status(500).json({
        authorized: false,
        code: "SCOPED_PHARMACY_READ_FAILED",
        pharmacies: [],
      });
    }
  });

  const supervisorError = (res: Response, error: unknown) => {
    if (error instanceof SupervisorVisitError) return res.status(error.status).json({ success: false, authorized: false, code: error.code });
    console.error("[SUPERVISOR_VISIT_ERROR]", error);
    return res.status(500).json({ success: false, authorized: false, code: "SUPERVISOR_VISIT_OPERATION_FAILED" });
  };
  app.post("/api/supervisor-visits/create", requireFirebaseAuth, async (req: Request, res: Response) => {
    const input = parseSupervisorVisitCreate(req.body); if (!input) return res.status(400).json({ success: false, code: "INVALID_SUPERVISOR_VISIT" });
    try { return res.status(201).json(await createSupervisorVisit((req as AuthenticatedRequest).authUid!, input)); } catch (error) { return supervisorError(res, error); }
  });
  app.post("/api/supervisor-visits/transition", requireFirebaseAuth, async (req: Request, res: Response) => {
    const input=parseSupervisorVisitTransition(req.body);if(!input)return res.status(400).json({success:false,code:"INVALID_SUPERVISOR_VISIT_TRANSITION"});
    try{return res.json(await transitionSupervisorVisit((req as AuthenticatedRequest).authUid!,input));}catch(error){return supervisorError(res,error);}
  });
  app.post("/api/supervisor-visits/reschedule", requireFirebaseAuth, async (req: Request, res: Response) => {
    const input=parseSupervisorVisitReschedule(req.body);if(!input)return res.status(400).json({success:false,code:"INVALID_SUPERVISOR_VISIT_RESCHEDULE"});
    try{return res.json(await rescheduleSupervisorVisit((req as AuthenticatedRequest).authUid!,input));}catch(error){return supervisorError(res,error);}
  });
  app.post("/api/supervisor-visits/options", requireFirebaseAuth, async (req: Request, res: Response) => { if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).length) return res.status(400).json({ authorized:false,areas:[],code:"INVALID_SUPERVISOR_VISIT_OPTIONS" }); try{return res.json(await readSupervisorVisitOptions((req as AuthenticatedRequest).authUid!));}catch(error){return supervisorError(res,error);} });
  app.post("/api/supervisor-visits/eligible-representatives", requireFirebaseAuth, async (req: Request, res: Response) => {
    const input = parseSupervisorRepresentativeEligibilityRequest(req.body); if (!input) return res.status(400).json({ authorized:false,representatives:[],code:"INVALID_SUPERVISOR_REPRESENTATIVE_QUERY" });
    try{return res.json(await readEligibleSupervisorRepresentatives((req as AuthenticatedRequest).authUid!,input));}catch(error){return supervisorError(res,error);}
  });
  app.post("/api/supervisor-visits/scoped-query", requireFirebaseAuth, async (req: Request, res: Response) => {
    const customerType = req.body?.customerType, customerId = typeof req.body?.customerId === "string" ? req.body.customerId.trim() : undefined, supervisorRole = req.body?.supervisorRole;
    if (customerType !== undefined && !["PHYSICIAN", "PHARMACY"].includes(customerType)) return res.status(400).json({ authorized: false, visits: [], code: "INVALID_SUPERVISOR_VISIT_QUERY" });
    if (customerId && !customerType) return res.status(400).json({ authorized: false, visits: [], code: "INVALID_SUPERVISOR_VISIT_QUERY" });
    if (supervisorRole !== undefined && !["Medical Supervisor", "Sales Supervisor"].includes(supervisorRole)) return res.status(400).json({ authorized: false, visits: [], code: "INVALID_SUPERVISOR_VISIT_QUERY" });
    try { return res.json(await readSupervisorVisits((req as AuthenticatedRequest).authUid!, { customerType, customerId, supervisorRole })); } catch (error) { return supervisorError(res, error); }
  });
  app.post("/api/supervisor-visits/customer-history", requireFirebaseAuth, async (req: Request, res: Response) => {
    const input = parseSupervisorCustomerVisitHistoryRequest(req.body);
    if (!input) return res.status(400).json({ authorized:false, visits:[], areas:[], code:"INVALID_SUPERVISOR_VISIT_HISTORY_QUERY" });
    try { return res.json(await readSupervisorCustomerVisitHistory((req as AuthenticatedRequest).authUid!, input)); } catch (error) { return supervisorError(res, error); }
  });
  app.post("/api/supervisor-coaching/create", requireFirebaseAuth, async (req: Request, res: Response) => {
    const input = parseAppraisalCreate(req.body); if (!input) return res.status(400).json({ success: false, code: "INVALID_SUPERVISOR_APPRAISAL" });
    try { return res.status(201).json(await createSupervisorAppraisal((req as AuthenticatedRequest).authUid!, input)); } catch (error) { return supervisorError(res, error); }
  });
  app.post("/api/supervisor-coaching/save-draft", requireFirebaseAuth, async (req:Request,res:Response)=>{const input=parseAppraisalDraftSave(req.body);if(!input)return res.status(400).json({success:false,code:"INVALID_SUPERVISOR_APPRAISAL_DRAFT"});try{return res.json(await saveSupervisorAppraisalDraft((req as AuthenticatedRequest).authUid!,input));}catch(error){return supervisorError(res,error);}});
  app.post("/api/supervisor-coaching/submit", requireFirebaseAuth, async (req:Request,res:Response)=>{const input=parseAppraisalSubmit(req.body);if(!input)return res.status(400).json({success:false,code:"INVALID_SUPERVISOR_APPRAISAL_SUBMIT"});try{return res.json(await submitSupervisorAppraisal((req as AuthenticatedRequest).authUid!,input));}catch(error){return supervisorError(res,error);}});
  app.post("/api/supervisor-coaching/review", requireFirebaseAuth, async (req:Request,res:Response)=>{const input=parseAppraisalRepresentativeReview(req.body);if(!input)return res.status(400).json({success:false,code:"INVALID_SUPERVISOR_APPRAISAL_REVIEW"});try{return res.json(await reviewSupervisorAppraisal((req as AuthenticatedRequest).authUid!,input));}catch(error){return supervisorError(res,error);}});
  app.post("/api/supervisor-coaching/keep-unchanged", requireFirebaseAuth, async (req:Request,res:Response)=>{const input=parseAppraisalKeepUnchanged(req.body);if(!input)return res.status(400).json({success:false,code:"INVALID_SUPERVISOR_APPRAISAL_KEEP_UNCHANGED"});try{return res.json(await keepSupervisorAppraisalUnchanged((req as AuthenticatedRequest).authUid!,input));}catch(error){return supervisorError(res,error);}});
  app.post("/api/supervisor-coaching/open-revision", requireFirebaseAuth, async (req:Request,res:Response)=>{const input=parseAppraisalOpenRevision(req.body);if(!input)return res.status(400).json({success:false,code:"INVALID_SUPERVISOR_APPRAISAL_OPEN_REVISION"});try{return res.json(await openSupervisorAppraisalRevision((req as AuthenticatedRequest).authUid!,input));}catch(error){return supervisorError(res,error);}});
  app.post("/api/supervisor-coaching/save-revision", requireFirebaseAuth, async (req:Request,res:Response)=>{const input=parseAppraisalRevisionSave(req.body);if(!input)return res.status(400).json({success:false,code:"INVALID_SUPERVISOR_APPRAISAL_REVISION"});try{return res.json(await saveSupervisorAppraisalRevision((req as AuthenticatedRequest).authUid!,input));}catch(error){return supervisorError(res,error);}});
  app.post("/api/supervisor-coaching/submit-revision", requireFirebaseAuth, async (req:Request,res:Response)=>{const input=parseAppraisalSubmit(req.body);if(!input)return res.status(400).json({success:false,code:"INVALID_SUPERVISOR_APPRAISAL_SUBMIT_REVISION"});try{return res.json(await submitSupervisorAppraisalRevision((req as AuthenticatedRequest).authUid!,input));}catch(error){return supervisorError(res,error);}});
  app.post("/api/supervisor-coaching/final-review", requireFirebaseAuth, async (req:Request,res:Response)=>{const input=parseAppraisalFinalRepresentativeReview(req.body);if(!input)return res.status(400).json({success:false,code:"INVALID_SUPERVISOR_APPRAISAL_FINAL_REVIEW"});try{return res.json(await finalReviewSupervisorAppraisal((req as AuthenticatedRequest).authUid!,input));}catch(error){return supervisorError(res,error);}});
  app.post("/api/supervisor-coaching/sign-off", requireFirebaseAuth, async (req:Request,res:Response)=>{const input=parseAppraisalSignOff(req.body);if(!input)return res.status(400).json({success:false,code:"INVALID_SUPERVISOR_APPRAISAL_SIGN_OFF"});try{return res.json(await signOffSupervisorAppraisal((req as AuthenticatedRequest).authUid!,input));}catch(error){return supervisorError(res,error);}});
  app.post("/api/supervisor-coaching/scoped-query", requireFirebaseAuth, async (req: Request, res: Response) => {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).length) return res.status(400).json({ authorized: false, appraisals: [], code: "INVALID_SUPERVISOR_APPRAISAL_QUERY" });
    try { return res.json(await readSupervisorAppraisals((req as AuthenticatedRequest).authUid!)); } catch (error) { return supervisorError(res, error); }
  });

  app.post("/api/key-messages/mutate", requireFirebaseAuth, async (req: Request, res: Response) => {
    const command = parseKeyMessageMutation(req.body);
    if (!command) return res.status(400).json({ success: false, code: "INVALID_KEY_MESSAGE_MUTATION" });
    try {
      return res.status(200).json(await executeKeyMessageMutation((req as AuthenticatedRequest).authUid!, command));
    } catch (error) {
      if (error instanceof KeyMessageMutationError) return res.status(error.status).json({ success: false, code: error.code });
      console.error("[KEY_MESSAGE_MUTATION_ERROR]", error);
      return res.status(500).json({ success: false, code: "KEY_MESSAGE_MUTATION_FAILED" });
    }
  });

  app.post("/api/access-governance/navigation/mutate", requireFirebaseAuth, async (req: Request, res: Response) => {
    const command = parseNavigationGovernanceMutation(req.body);
    if (!command) return res.status(400).json({ success: false, code: "INVALID_NAVIGATION_GOVERNANCE_MUTATION" });
    try {
      return res.status(200).json(await executeNavigationGovernanceMutation((req as AuthenticatedRequest).authUid!, command));
    } catch (error) {
      if (error instanceof NavigationGovernanceMutationError) return res.status(error.status).json({ success: false, code: error.code });
      console.error("[NAVIGATION_GOVERNANCE_MUTATION_ERROR]", error);
      return res.status(500).json({ success: false, code: "NAVIGATION_GOVERNANCE_MUTATION_FAILED" });
    }
  });

  app.post("/api/physician-visits/scoped-query", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const controls = parsePhysicianVisitReadControls(req.body);
    if (!controls) return res.status(400).json({ authorized: false, code: "INVALID_PHYSICIAN_VISIT_QUERY", visits: [] });
    try {
      const result = await resolveScopedPhysicianVisitRead(authReq.authUid!, controls);
      return res.status(result.authorized ? 200 : 403).json(result);
    } catch (error) {
      console.error("[SCOPED_PHYSICIAN_VISIT_READ_ERROR]", error);
      return res.status(500).json({ authorized: false, code: "SCOPED_PHYSICIAN_VISIT_READ_FAILED", visits: [] });
    }
  });

  app.post("/api/physician-visits/physician-history", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const request = parsePhysicianVisitHistoryRequest(req.body);
    if (!request) return res.status(400).json({ authorized: false, code: "INVALID_PHYSICIAN_HISTORY_QUERY", summaries: [] });
    try {
      const result = await resolveScopedPhysicianVisitHistory(authReq.authUid!, request);
      return res.status(result.authorized ? 200 : 403).json(result);
    } catch (error) {
      console.error("[SCOPED_PHYSICIAN_HISTORY_READ_ERROR]", error);
      return res.status(500).json({ authorized: false, code: "SCOPED_PHYSICIAN_HISTORY_READ_FAILED", summaries: [] });
    }
  });

  app.post("/api/pharmacy-visits/complete", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const request = parsePharmacyVisitCompletionRequest(req.body);
    if (!request) return res.status(400).json({ success: false, code: "INVALID_PHARMACY_VISIT_COMPLETION_REQUEST" });
    try {
      return res.status(200).json(await executePharmacyVisitCompletion(authReq.authUid!, request));
    } catch (error) {
      if (error instanceof OfferRuntimeError) return res.status(error.status).json({ success: false, complete: false, code: error.code, message: error.message });
      if (error instanceof PharmacyVisitCompletionError) return res.status(error.status).json({ success: false, code: error.code, message: error.code === "PHARMACY_VISIT_PRODUCT_PRICE_CHANGED" ? "Product pricing has changed. Refresh the order and confirm Offers again." : error.code === "PHARMACY_VISIT_OFFER_SELECTION_LIMIT_EXCEEDED" ? "A pharmacy visit/order completion may select at most 20 Offers." : error.message, ...(error.safeReferences ? { references: error.safeReferences } : {}) });
      console.error("[PHARMACY_VISIT_COMPLETION_ERROR]", error);
      return res.status(500).json({ success: false, code: "PHARMACY_VISIT_COMPLETION_FAILED" });
    }
  });

  app.post("/api/pharmacy-visits/product-availability", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const request = parsePharmacyProductAvailabilityRequest(req.body);
    if (!request) return res.status(400).json({ authorized: false, code: "INVALID_AVAILABILITY_REQUEST", availability: [] });
    try {
      const result = await resolvePharmacyProductAvailability(authReq.authUid!, request);
      return res.status(result.authorized ? 200 : 403).json(result);
    } catch (error) {
      console.error("[PHARMACY_PRODUCT_AVAILABILITY_ERROR]", error);
      return res.status(500).json({ authorized: false, code: "AVAILABILITY_REQUEST_FAILED", availability: [] });
    }
  });

  app.post("/api/physician-visits/complete", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const visit = parsePhysicianVisitWriteRequest(req.body);
    if (!visit) return res.status(400).json({ status: "REJECTED", code: "INVALID_PHYSICIAN_VISIT_REQUEST" });
    try {
      const { db } = getFirebaseAdminServices();
      return res.status(200).json(await executePhysicianVisitWrite(authReq.authUid!, visit, db));
    } catch (error) {
      if (error instanceof PhysicianVisitWriteError) return res.status(error.status).json({ status: "REJECTED", code: error.code });
      console.error("[PHYSICIAN_VISIT_WRITE_ERROR]", error);
      return res.status(500).json({ status: "REJECTED", code: "PHYSICIAN_VISIT_WRITE_FAILED" });
    }
  });

  app.post("/api/visit-marketing-requests/scoped-query", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).length !== 0) return res.status(400).json({ code: "INVALID_MARKETING_REQUEST_QUERY" });
    try {
      const { db } = getFirebaseAdminServices();
      return res.status(200).json(await executeScopedVisitMarketingRequestRead(authReq.authUid!, db));
    } catch (error) {
      if (error instanceof VisitMarketingRequestError) return res.status(error.status).json({ code: error.code, requests: [] });
      console.error("[VISIT_MARKETING_REQUEST_READ_ERROR]", error);
      return res.status(500).json({ code: "VISIT_MARKETING_REQUEST_READ_FAILED", requests: [] });
    }
  });

  app.post("/api/visit-marketing-requests/create", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const input = parseVisitMarketingRequestCreate(req.body);
    if (!input) return res.status(400).json({ code: "INVALID_VISIT_MARKETING_REQUEST" });
    try {
      const { db } = getFirebaseAdminServices();
      return res.status(201).json(await executeVisitMarketingRequestCreate(authReq.authUid!, input.visitId, input.request, db));
    } catch (error) {
      if (error instanceof VisitMarketingRequestError) return res.status(error.status).json({ code: error.code });
      console.error("[VISIT_MARKETING_REQUEST_CREATE_ERROR]", error);
      return res.status(500).json({ code: "VISIT_MARKETING_REQUEST_CREATE_FAILED" });
    }
  });

  const transitionRoutes = {
    "supervisor-approve": "SUPERVISOR_APPROVE",
    "supervisor-reject": "SUPERVISOR_REJECT",
    "final-approve": "FINAL_APPROVE",
    "final-reject": "FINAL_REJECT",
    execute: "EXECUTE",
    cancel: "CANCEL",
  } as const;
  for (const [route, action] of Object.entries(transitionRoutes)) {
    app.post(`/api/visit-marketing-requests/${route}`, requireFirebaseAuth, async (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;
      const input = parseVisitMarketingRequestTransition(req.body);
      if (!input) return res.status(400).json({ code: "INVALID_MARKETING_REQUEST_TRANSITION" });
      try {
        const { db } = getFirebaseAdminServices();
        return res.status(200).json(await executeVisitMarketingRequestTransition(authReq.authUid!, action, input, db));
      } catch (error) {
        if (error instanceof VisitMarketingRequestError) return res.status(error.status).json({ code: error.code });
        console.error("[VISIT_MARKETING_REQUEST_TRANSITION_ERROR]", error);
        return res.status(500).json({ code: "VISIT_MARKETING_REQUEST_TRANSITION_FAILED" });
      }
    });
  }

  app.post("/api/medical-planner/mutate", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const request = parseMedicalPlannerMutationRequest(req.body);
    if (!request) return res.status(400).json({ status: "REJECTED", code: "INVALID_PLANNER_REQUEST" });
    try {
      return res.status(200).json(await executeMedicalPlannerMutation(authReq.authUid!, request.proposal, request.mode));
    } catch (error) {
      if (error instanceof MedicalPlannerMutationError) return res.status(error.status).json({ status: "REJECTED", code: error.code });
      console.error("[MEDICAL_PLANNER_MUTATION_ERROR]", error);
      return res.status(500).json({ status: "REJECTED", code: "MEDICAL_PLANNER_MUTATION_FAILED" });
    }
  });

  app.post("/api/medical-planner/scoped-read", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const request = parseMedicalPlannerReadRequest(req.body);
    if (!request) return res.status(400).json({ authorized: false, code: "INVALID_PLANNER_READ_REQUEST" });
    try {
      return res.status(200).json(await resolveMedicalPlannerScopedRead(authReq.authUid!, request));
    } catch (error) {
      if (error instanceof MedicalPlannerScopeError) return res.status(error.status).json({ authorized: false, code: error.code });
      console.error("[MEDICAL_PLANNER_SCOPED_READ_ERROR]", error);
      return res.status(500).json({ authorized: false, code: "MEDICAL_PLANNER_SCOPED_READ_FAILED" });
    }
  });

  app.post("/api/medical-planner/scoped-action", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const request = parseMedicalPlannerActionRequest(req.body);
    if (!request) return res.status(400).json({ success: false, code: "INVALID_PLANNER_ACTION_REQUEST" });
    try {
      return res.status(200).json(await executeMedicalPlannerScopedAction(authReq.authUid!, request));
    } catch (error) {
      if (error instanceof MedicalPlannerScopeError) return res.status(error.status).json({ success: false, code: error.code });
      console.error("[MEDICAL_PLANNER_SCOPED_ACTION_ERROR]", error);
      return res.status(500).json({ success: false, code: "MEDICAL_PLANNER_SCOPED_ACTION_FAILED" });
    }
  });

  app.post("/api/pharmacy-visits/scoped-query", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const controls = parsePharmacyVisitReadControls(req.body);
    if (!controls) return res.status(400).json({ authorized: false, code: "INVALID_PHARMACY_VISIT_QUERY", visits: [] });
    try {
      const result = await resolveScopedPharmacyVisitRead(authReq.authUid!, controls);
      return res.status(result.authorized ? 200 : 403).json(result);
    } catch (error) {
      console.error("[SCOPED_PHARMACY_VISIT_READ_ERROR]", error);
      return res.status(500).json({ authorized: false, code: "SCOPED_PHARMACY_VISIT_READ_FAILED", visits: [] });
    }
  });

  app.post("/api/pharmacy-orders/scoped-query", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const request = parsePharmacyOrderReadRequest(req.body);
    if (!request) return res.status(400).json({ authorized: false, code: "INVALID_PHARMACY_ORDER_QUERY", orders: [] });
    try {
      const result = await resolveScopedPharmacyOrderRead(authReq.authUid!, request);
      return res.status(result.authorized ? 200 : 403).json(result);
    } catch (error) {
      console.error("[SCOPED_PHARMACY_ORDER_READ_ERROR]", error);
      return res.status(500).json({ authorized: false, code: "SCOPED_PHARMACY_ORDER_READ_FAILED", orders: [] });
    }
  });

  app.post("/api/pharmacy-offers/scoped-query", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const request = parsePharmacyOfferReadRequest(req.body);
    if (!request) return res.status(400).json({ authorized: false, complete: false, code: "INVALID_OFFER_QUERY", offers: [] });
    try { const result = await resolveScopedPharmacyOffers(authReq.authUid!, request); return res.status(result.authorized ? 200 : 403).json(result); }
    catch (error) {
      if (error instanceof OfferRuntimeError) return res.status(error.status).json({ authorized: false, complete: false, code: error.code, message: error.message });
      if (error instanceof OfferAdministrationError) return res.status(error.status).json({ authorized: false, complete: false, code: error.code, offers: [] });
      console.error("[SCOPED_PHARMACY_OFFER_READ_ERROR]", error);
      return res.status(500).json({ authorized: false, complete: false, code: "SCOPED_PHARMACY_OFFER_READ_FAILED", offers: [] });
    }
  });

  app.post("/api/team-activity/scoped-query", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const controls = parseTeamActivityReadControls(req.body);
    if (!controls) return res.status(400).json({ authorized: false, code: "INVALID_TEAM_ACTIVITY_QUERY", subjectUids: [], attendanceSessions: [], leaveRequests: [] });
    try {
      const result = await resolveScopedTeamActivityRead(authReq.authUid!, controls);
      return res.status(result.authorized ? 200 : 403).json(result);
    } catch (error) {
      console.error("[SCOPED_TEAM_ACTIVITY_READ_ERROR]", error);
      return res.status(500).json({ authorized: false, code: "SCOPED_TEAM_ACTIVITY_READ_FAILED", subjectUids: [], attendanceSessions: [], leaveRequests: [] });
    }
  });

  app.post("/api/leave-requests/mutate", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest; const request = parseLeaveRequestMutation(req.body);
    if (!request) return res.status(400).json({ success: false, code: "INVALID_LEAVE_REQUEST" });
    try {
      const result = await executeLeaveRequestMutation(authReq.authUid!, request);
      return res.status(result.success ? 200 : 403).json(result);
    } catch (error) {
      console.error("[LEAVE_REQUEST_MUTATION_ERROR]", error);
      return res.status(500).json({ success: false, code: "LEAVE_REQUEST_MUTATION_FAILED" });
    }
  });

  app.post("/api/analytics/products/scoped-query", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    if (req.body && (typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).length)) return res.status(400).json({ authorized: false, code: "INVALID_PRODUCT_ANALYTICS_REQUEST", orders: [] });
    try { const result = await resolveScopedProductAnalytics(authReq.authUid!); return res.status(result.authorized ? 200 : 403).json(result); }
    catch (error) { console.error("[SCOPED_PRODUCT_ANALYTICS_ERROR]", error); return res.status(500).json({ authorized: false, code: "SCOPED_PRODUCT_ANALYTICS_FAILED", orders: [] }); }
  });

  app.post("/api/commercial/scoped-query", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest; const request = parseCommercialReadRequest(req.body);
    if (!request) return res.status(400).json({ authorized: false, code: "INVALID_COMMERCIAL_READ_REQUEST" });
    try { const result = await resolveScopedCommercialRead(authReq.authUid!, request); return res.status(result.authorized ? 200 : 403).json(result); }
    catch (error) { console.error("[SCOPED_COMMERCIAL_READ_ERROR]", error); return res.status(500).json({ authorized: false, code: "SCOPED_COMMERCIAL_READ_FAILED" }); }
  });

  app.post("/api/attendance/process-open-sessions", requireFirebaseAuth, async (req: Request, res: Response) => { const authReq = req as AuthenticatedRequest; const request = parseAttendanceRecoveryRequest(req.body); if (!request) return res.status(400).json({ success: false, code: "INVALID_ATTENDANCE_RECOVERY_REQUEST", processed: 0 }); try { const result = await executeAttendanceRecovery(authReq.authUid!, request); return res.status(result.success ? 200 : 403).json(result); } catch (error) { console.error("[ATTENDANCE_RECOVERY_ERROR]", error); return res.status(500).json({ success: false, code: "ATTENDANCE_RECOVERY_FAILED", processed: 0 }); } });

  app.post("/api/internal/attendance/recover", requireAttendanceSchedulerAuth, async (req: Request, res: Response) => { const schedulerReq = req as SchedulerAuthenticatedRequest; if (req.body && (typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).length)) return res.status(400).json({ success: false, code: "INVALID_SCHEDULED_ATTENDANCE_REQUEST", processed: 0 }); try { const result = await executeScheduledAttendanceRecovery(new Date().toISOString()); console.info("[ATTENDANCE_SCHEDULER_RECOVERY]", { principal: schedulerReq.schedulerPrincipal, ...result }); return res.status(result.success ? 200 : 500).json(result); } catch (error) { console.error("[ATTENDANCE_SCHEDULER_RECOVERY_ERROR]", error); return res.status(500).json({ success: false, code: "ATTENDANCE_SCHEDULER_RECOVERY_FAILED", processed: 0 }); } });

  app.post("/api/attendance/mutate", requireFirebaseAuth, async (req: Request, res: Response) => { const authReq = req as AuthenticatedRequest; const request = parseAttendanceMutation(req.body); if (!request) return res.status(400).json({ success: false, code: "INVALID_ATTENDANCE_MUTATION" }); try { const result = await executeAttendanceMutation(authReq.authUid!, request); return res.status(result.success ? 200 : 403).json(result); } catch (error) { console.error("[ATTENDANCE_MUTATION_ERROR]", error); return res.status(500).json({ success: false, code: "ATTENDANCE_MUTATION_FAILED" }); } });

  app.post("/api/orders/workflow/transition", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const request = parseOrderOperationsTransitionRequest(req.body);
    if (!request) return res.status(400).json({ success: false, code: "INVALID_REQUEST" });
    try {
      const result = await executeOrderOperationsTransition(authReq.authUid!, request);
      if (result.success) return res.status(200).json(result);
      if (result.code === "STALE_ORDER_VERSION") return res.status(409).json(result);
      if (result.code === "ORDER_NOT_FOUND") return res.status(404).json(result);
      if (["WORKFLOW_SCOPE_DENIED", "UNSUPPORTED_ROLE", "ACTOR_INACTIVE", "ACTOR_NOT_FOUND"].includes(result.code || "")) {
        return res.status(403).json(result);
      }
      return res.status(400).json(result);
    } catch (error) {
      console.error("[ORDER_OPERATIONS_TRANSITION_ERROR]", error);
      return res.status(500).json({ success: false, code: "ORDER_OPERATIONS_TRANSITION_FAILED" });
    }
  });

  const collectionReversalError = (error: unknown, res: Response) => {
    const code = error instanceof Error ? error.message : "";
    const denied = ["COLLECTION_REVERSAL_DENIED", "COLLECTION_SCOPE_DENIED"];
    const conflicts = ["STALE_COLLECTION", "STALE_RECEIVABLE", "INCOMPLETE_SETTLEMENT", "INCOMPLETE_REVERSAL", "REVERSAL_IDEMPOTENCY_CONFLICT"];
    const invalid = ["INVALID_REVERSAL_REQUEST", "INVALID_REVERSAL_REASON", "INVALID_PAYMENT_REVERSAL", "COLLECTION_STATE_INVALID", "INVALID_COLLECTION_COMMAND", "FINANCIAL_IDENTITY_MISMATCH", "INVALID_FINANCIAL_AMOUNT", "FINANCIAL_PROJECTION_INITIALIZATION_REQUIRED", "FINANCIAL_MARKET_CURRENCY_REQUIRED", "FINANCIAL_RECEIVABLE_SET_CAPACITY_EXCEEDED", "FINANCIAL_PROFILE_RECONCILIATION_REQUIRED"];
    const known = [...denied, ...conflicts, ...invalid].includes(code);
    return res.status(denied.includes(code) ? 403 : conflicts.includes(code) ? 409 : known ? 400 : 500)
      .json({ success: false, code: known ? code : "COLLECTION_REVERSAL_FAILED" });
  };
  app.post("/api/collections/reverse", requireFirebaseAuth, async (req: Request, res: Response) => {
    try {
      return res.status(200).json(await executeCollectionReversal((req as AuthenticatedRequest).authUid!, req.body));
    } catch (error) { return collectionReversalError(error, res); }
  });
  app.get("/api/collections/reverse", requireFirebaseAuth, async (req: Request, res: Response) => {
    try {
      return res.status(200).json(await resolveCollectionReversal((req as AuthenticatedRequest).authUid!, {
        collectionId: req.query.collectionId, expectedRevision: Number(req.query.expectedRevision),
      }));
    } catch (error) { return collectionReversalError(error, res); }
  });

  app.post("/api/collections/verify", requireFirebaseAuth, async (req: Request, res: Response) => {
    try {
      return res.status(200).json(await executeCollectionVerification((req as AuthenticatedRequest).authUid!, req.body));
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      const denied = ["COLLECTION_APPROVAL_DENIED", "COLLECTION_SCOPE_DENIED"];
      const conflict = ["STALE_COLLECTION", "STALE_RECEIVABLE", "ALLOCATION_CONFLICT", "INCOMPLETE_SETTLEMENT", "VERIFICATION_IDEMPOTENCY_CONFLICT"];
      const invalid = ["INVALID_VERIFICATION_REQUEST", "COLLECTION_STATE_INVALID", "INVALID_COLLECTION_COMMAND", "FINANCIAL_IDENTITY_MISMATCH", "INVALID_COLLECTION_EVIDENCE", "INVALID_COLLECTION_AMOUNT", "INVALID_FINANCIAL_AMOUNT", "NO_OPEN_RECEIVABLE", "COLLECTION_OVERPAYMENT", "FINANCIAL_PROJECTION_INITIALIZATION_REQUIRED", "FINANCIAL_MARKET_CURRENCY_REQUIRED", "FINANCIAL_RECEIVABLE_SET_CAPACITY_EXCEEDED", "FINANCIAL_PROFILE_RECONCILIATION_REQUIRED"];
      const known = [...denied, ...conflict, ...invalid].includes(code);
      return res.status(denied.includes(code) ? 403 : conflict.includes(code) ? 409 : known ? 400 : 500)
        .json({ success: false, code: known ? code : "COLLECTION_VERIFICATION_FAILED" });
    }
  });

  app.post("/api/collections/submit", requireFirebaseAuth, async (req: Request, res: Response) => {
    try {
      const result = await executeCollectionSubmission((req as AuthenticatedRequest).authUid!, req.body);
      return res.status(200).json(result);
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      const controlled = ["INVALID_COLLECTION_REQUEST", "FORGED_COLLECTION_FIELD", "COLLECTION_SCOPE_DENIED", "FINANCIAL_IDENTITY_MISMATCH", "INVALID_COLLECTION_NOTES", "INVALID_COLLECTION_COMMAND", "INVALID_PAYMENT_METHOD", "INVALID_COLLECTION_DATE", "INVALID_CHEQUE_DATE", "INVALID_PAYMENT_EVIDENCE", "INVALID_COLLECTION_AMOUNT", "INVALID_FINANCIAL_AMOUNT", "NO_OPEN_RECEIVABLE", "COLLECTION_OVERPAYMENT", "FINANCIAL_PROJECTION_INITIALIZATION_REQUIRED", "FINANCIAL_MARKET_CURRENCY_REQUIRED", "FINANCIAL_RECEIVABLE_SET_CAPACITY_EXCEEDED", "COLLECTION_IDEMPOTENCY_CONFLICT"];
      return res.status(code === "COLLECTION_SCOPE_DENIED" ? 403 : code === "COLLECTION_IDEMPOTENCY_CONFLICT" ? 409 : controlled.includes(code) ? 400 : 500).json({ success: false, code: controlled.includes(code) ? code : "COLLECTION_SUBMISSION_FAILED" });
    }
  });

  app.post("/api/orders/commercial/transition", requireFirebaseAuth, async (req: Request, res: Response) => { const authReq = req as AuthenticatedRequest; const request = parseCommercialOrderTransition(req.body); if (!request) return res.status(400).json({ success: false, code: "INVALID_ORDER_TRANSITION" }); try { const result = await (request.action === "DELIVERY_COMPLETE" ? executeAtomicCommercialDeliveryCompletion(authReq.authUid!, request) : executeCommercialOrderTransition(authReq.authUid!, request)); return res.status(result.success ? 200 : result.code === "STALE_ORDER_VERSION" ? 409 : 403).json(result); } catch (error) { console.error("[COMMERCIAL_ORDER_TRANSITION_ERROR]", error); return res.status(500).json({ success: false, code: "COMMERCIAL_ORDER_TRANSITION_FAILED" }); } });

  app.post("/api/pharmacy-orders/create", requireFirebaseAuth, async (req: Request, res: Response) => { const authReq = req as AuthenticatedRequest; const request = parsePharmacyOrderCreateRequest(req.body); if (!request) return res.status(400).json({ success: false, code: "INVALID_ORDER_CREATE_REQUEST" }); try { const result = await executePharmacyOrderCreate(authReq.authUid!, request); return res.status(result.success ? 200 : 403).json(result); } catch (error) { console.error("[PHARMACY_ORDER_CREATE_ERROR]", error); return res.status(500).json({ success: false, code: "ORDER_CREATE_FAILED" }); } });

  app.get("/api/orders/delivery-officers", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    try {
      const result = await resolveEligibleDeliveryOfficers(authReq.authUid!);
      return res.status(result.authorized ? 200 : 403).json(result);
    } catch (error) {
      console.error("[DELIVERY_OFFICER_DIRECTORY_ERROR]", error);
      return res.status(500).json({ authorized: false, code: "DELIVERY_OFFICER_DIRECTORY_FAILED", officers: [] });
    }
  });

  app.post("/api/orders/delivery-assign", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const request = parseDeliveryAssignRequest(req.body);
    if (!request) return res.status(400).json({ success: false, code: "INVALID_REQUEST" });
    try {
      const result = await executeDeliveryAssign(authReq.authUid!, request);
      if (result.success) return res.status(200).json(result);
      if (["ACTOR_NOT_FOUND", "ACTOR_NOT_AUTHORIZED"].includes(result.code || "")) return res.status(403).json(result);
      if (["ORDER_NOT_FOUND", "OFFICER_NOT_FOUND"].includes(result.code || "")) return res.status(404).json(result);
      return res.status(400).json(result);
    } catch (error) {
      console.error("[DELIVERY_ASSIGN_ERROR]", error);
      return res.status(500).json({ success: false, code: "DELIVERY_ASSIGN_FAILED" });
    }
  });

  app.post("/api/ar/delivered-invoice", requireFirebaseAuth, async (_req: Request, res: Response) => {
    return res.status(410).json({ success: false, posted: false, code: "DELIVERED_INVOICE_ENDPOINT_RETIRED", message: "Receivables are created as part of successful Delivery completion." });
  });

  app.post("/api/samples/allocated-batches", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const request = parseAllocatedBatchRequest(req.body);
    if (!request) return res.status(400).json({ success: false, code: "INVALID_REQUEST" });
    const result = await resolveAllocatedBatchesForRepresentative(authReq.authUid!, request.allocationIds);
    return res.status(result.success ? 200 : 403).json(result);
  });

  app.post("/api/samples/visit-options", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const physicianId = typeof req.body?.physicianId === "string" ? req.body.physicianId.trim() : "";
    if (!physicianId) return res.status(400).json({ success: false, code: "INVALID_REQUEST" });
    const result = await resolveSampleVisitOptions(authReq.authUid!, physicianId);
    return res.status(result.success ? 200 : 403).json(result);
  });

  app.post("/api/samples/distribute", requireFirebaseAuth, async (req: Request, res: Response) => {
    return res.status(405).json({ success: false, code: "SAMPLE_DISTRIBUTION_REQUIRES_PHYSICIAN_VISIT" });
  });

  app.post("/api/samples/approval-decision", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const request = parseSampleApprovalDecisionRequest(req.body);
    if (!request) return res.status(400).json({ success: false, code: "INVALID_SAMPLE_APPROVAL_DECISION" });
    try {
      return res.json(await executeSampleApprovalDecision(authReq.authUid!, request));
    } catch (error) {
      if (error instanceof SampleApprovalError) return res.status(error.httpStatus).json({ success: false, code: error.code });
      console.error("[SAMPLE_APPROVAL_DECISION_ERROR]", error);
      return res.status(500).json({ success: false, code: "SAMPLE_APPROVAL_DECISION_FAILED" });
    }
  });

  app.post("/api/samples/requests", requireFirebaseAuth, async (req: Request, res: Response) => {
    const request = parseStandaloneSampleRequestInput(req.body); if (!request) return res.status(400).json({ success: false, code: "INVALID_SAMPLE_REQUEST" });
    try { return res.status(200).json(await executeStandaloneSampleRequest((req as AuthenticatedRequest).authUid!, request)); }
    catch (error) { const known = error instanceof SampleRequestError; return res.status(known ? error.httpStatus : 500).json({ success: false, code: known ? error.code : "SAMPLE_REQUEST_CREATE_FAILED" }); }
  });

  app.post("/api/samples/allocations", requireFirebaseAuth, async (req: Request, res: Response) => {
    const request = parseSampleAllocationCommand(req.body); if (!request) return res.status(400).json({ success: false, code: "INVALID_SAMPLE_ALLOCATION" });
    try { return res.status(200).json(await executeSampleAllocation((req as AuthenticatedRequest).authUid!, request)); }
    catch (error) { const known = error instanceof SampleMutationError; return res.status(known ? error.httpStatus : 500).json({ success: false, code: known ? error.code : "SAMPLE_ALLOCATION_FAILED" }); }
  });

  app.post("/api/samples/variants", requireFirebaseAuth, async (req: Request, res: Response) => {
    const request = parseSampleVariantCommand(req.body); if (!request) return res.status(400).json({ success: false, code: "INVALID_SAMPLE_VARIANT_MUTATION" });
    try { return res.status(200).json(await executeSampleVariantMutation((req as AuthenticatedRequest).authUid!, request)); }
    catch (error) { const known = error instanceof SampleMutationError; return res.status(known ? error.httpStatus : 500).json({ success: false, code: known ? error.code : "SAMPLE_VARIANT_MUTATION_FAILED" }); }
  });

  app.post("/api/samples/receipts", requireFirebaseAuth, async (req: Request, res: Response) => {
    const request = parseSampleReceiptCommand(req.body); if (!request) return res.status(400).json({ success: false, code: "INVALID_SAMPLE_RECEIPT" });
    try { return res.status(200).json(await executeSampleReceipt((req as AuthenticatedRequest).authUid!, request)); }
    catch (error) { const known = error instanceof SampleMutationError; return res.status(known ? error.httpStatus : 500).json({ success: false, code: known ? error.code : "SAMPLE_RECEIPT_FAILED" }); }
  });

  app.post("/api/samples/adjustments", requireFirebaseAuth, async (req: Request, res: Response) => {
    const request = parseSampleAdjustmentCommand(req.body); if (!request) return res.status(400).json({ code: "INVALID_SAMPLE_ADJUSTMENT" });
    try { return res.status(200).json(await executeSampleAdjustment((req as AuthenticatedRequest).authUid!, request)); }
    catch (error) { if (error instanceof SampleMutationError) return res.status(error.httpStatus).json({ code: error.code }); throw error; }
  });

  app.post("/api/orders/workflow/detail", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const request = parseOrderWorkflowDetailReadRequest(req.body);
    if (!request) return res.status(400).json({ authorized: false, code: "INVALID_REQUEST", detail: null });
    try {
      const result = await resolveOrderWorkflowDetailRead(authReq.authUid!, request.orderId);
      if (result.authorized === true) return res.status(200).json(result);
      if (result.code === "ORDER_NOT_FOUND") return res.status(404).json(result);
      if (["WORKFLOW_SCOPE_DENIED", "UNSUPPORTED_ROLE", "ACTOR_INACTIVE", "ACTOR_NOT_FOUND"].includes(result.code)) {
        return res.status(403).json(result);
      }
      return res.status(400).json(result);
    } catch (error) {
      console.error("[ORDER_WORKFLOW_DETAIL_READ_ERROR]", error);
      return res.status(500).json({ authorized: false, code: "ORDER_WORKFLOW_DETAIL_READ_FAILED", detail: null });
    }
  });

  app.post("/api/orders/workflow/scoped-query", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const controls = parseOrderWorkflowQueueControls(req.body || {});
    if (!controls) return res.status(400).json({ authorized: false, code: "INVALID_REQUEST", orders: [] });
    try {
      const result = await resolveOrderWorkflowQueueRead(authReq.authUid!, controls);
      return res.status(result.authorized ? 200 : 403).json(result);
    } catch (error) {
      console.error("[ORDER_WORKFLOW_QUEUE_READ_ERROR]", error);
      return res.status(500).json({ authorized: false, code: "ORDER_WORKFLOW_QUEUE_READ_FAILED", orders: [] });
    }
  });

  // Phase 3H: Trusted Backend Activation Claim Endpoint
  app.post("/api/auth/claim-activation", async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        status: "ERROR",
        error: "Unauthorized: Missing or malformed Authorization header. Expected 'Bearer <token>'."
      });
    }

    const idToken = authHeader.split("Bearer ")[1]?.trim();
    if (!idToken) {
      return res.status(401).json({
        success: false,
        status: "ERROR",
        error: "Unauthorized: Empty Bearer token."
      });
    }

    try {
      const result = await claimActivationProfileServer(idToken);
      if (!result.success) {
        // Handle failure status codes gracefully
        let httpStatusCode = 400;
        if (result.status === "ACTIVATION_NOT_FOUND") httpStatusCode = 404;
        if (result.status === "ACTIVATION_DISABLED") httpStatusCode = 403;
        if (result.status === "IDENTITY_CONFLICT") httpStatusCode = 409;
        if (result.status === "ACTIVATION_ALREADY_USED") httpStatusCode = 409;
        if (result.status === "EMAIL_MISMATCH") httpStatusCode = 403;
        
        return res.status(httpStatusCode).json(result);
      }

      return res.status(200).json(result);
    } catch (err: any) {
      console.error("[API Claim Activation] Internal error:", err);
      return res.status(500).json({
        success: false,
        status: "ERROR",
        error: err.message || "Internal server error claiming activation profile."
      });
    }
  });

  // AI Insights endpoint with strict server-side RBAC & Country/Data Scope validation
  app.post("/api/ai", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;

    const userId = user.id;
    const userRole = user.role;
    const userCountry = user.country;
    const userCountries = user.assignedCountries || [];

    // 1. Module gate: canonical role policy plus the live rolePermissions record.
    const rolePermissionsSnapshot = await getFirebaseAdminServices().db.collection("rolePermissions").doc(userRole).get();
    const dynamicPermissions = rolePermissionsSnapshot.exists
      ? rolePermissionsSnapshot.data() as Permissions
      : undefined;
    const aiAllowed = canAccessView({ id: userId, role: userRole as Role } as User, "analytics-ai", dynamicPermissions);
    if (!aiAllowed) {
      console.warn(`[API AI Gate] Rejected request from user ${userId}: role '${userRole}' is not authorized for AI Assistant.`);
      return res.status(403).json({ error: `Forbidden: Role '${userRole}' does not have view permission for AI Assistant.` });
    }

    const { action, payload } = req.body;

    // 2. Country & Data Geographic Scope Gate (Prevent country traversal)
    const isGloballyPrivileged = [
      "Super Admin",
      "System Administrator",
      "Admin",
      "General Manager"
    ].includes(userRole);

    if (!isGloballyPrivileged && payload) {
      // Extract target country from payload to check if they are requesting out-of-scope analytics
      // A region/city label is not a country identity. Comparing the two caused
      // valid in-country analytics requests to be rejected with 403.
      const targetCountry = (payload.countryId || payload.country || "").toLowerCase().trim();
      
      if (targetCountry && userCountry) {
        const normUserCountry = userCountry.toLowerCase().trim();
        let isAuthorized = normUserCountry === targetCountry;

        // Regional Managers or country managers can check assigned countries list
        if (!isAuthorized && userCountries.length > 0) {
          isAuthorized = userCountries.some((c: any) => String(c).toLowerCase().trim() === targetCountry);
        }

        if (!isAuthorized) {
          console.warn(`[API AI Geographic Violation] User ${userId} (${userRole}) in country '${userCountry}' blocked from accessing '${targetCountry}' metrics.`);
          return res.status(403).json({ error: "Forbidden: Access denied. You do not have permission to access data outside your assigned geographic scope." });
        }
      }
    }

    // Server-side audit log traces
    console.info(`[API AI Success] User ${userId} (${userRole}) authorized for action '${action}' in country '${userCountry || "Global"}'`);

    const ai = getAi();

    // Never present fictional analytics as operational data. Missing optional AI
    // configuration is returned as an explicit capability state so it cannot be
    // mistaken for failure of the authenticated CRM resource session.
    const unavailable = resolveAiUnavailableResponse(Boolean(ai), isApiRateLimited());
    if (unavailable) return res.status(unavailable.httpStatus).json(unavailable.body);

    try {
      let prompt = "";
      if (action === "dashboard") {
        prompt = `You are MENAREPS AI CRM assistant. Analyze the following KPIs: ${JSON.stringify(payload)}. Generate a concise executive summary with sales recommendations, key performance drivers, and specific areas that need immediate attention (e.g., gaps or outstanding balances). Keep it under 150 words.`;
      } else if (action === "quality_score") {
        prompt = `You are a pharmaceutical sales detailing auditor. Grade the following visit: ${JSON.stringify(payload)}. Calculate an audit quality score out of 100 based on reaction, products detailed, visit duration, and notes. Provide a brief breakdown and the next best action. Keep it under 120 words.`;
      } else if (action === "planning") {
        prompt = `You are a regional pharma planner. Suggest 2 high-priority visits from the following list of physicians: ${JSON.stringify(payload)}. Mention why they are prioritised and what brand message to detail. Keep it under 120 words.`;
      } else if (action === "anomaly") {
        prompt = `You are an internal CRM compliance auditor. Analyze these visit logs for possible compliance issues or fake reports (e.g. too fast, GPS mismatches): ${JSON.stringify(payload)}. List any anomalies found. Keep it under 120 words.`;
      } else if (action === "nba") {
        prompt = `Based on the physician profile and history: ${JSON.stringify(payload)}, suggest the single best next-best-action (e.g., specialized invitation, trial presentation, stock replenishment). Keep it under 60 words.`;
      } else {
        prompt = `Provide standard CRM insight on: ${JSON.stringify(payload)}`;
      }

      const responseText = await serializedGenerate(ai, prompt, action as string, payload);
      res.json({ text: responseText });
    } catch (error: any) {
      console.warn("Express route error during AI call:", error.message || error);
      res.status(503).json({ error: "AI insight generation failed.", code: "AI_PROVIDER_UNAVAILABLE" });
    }
  });

  // Secure Firebase Admin Auth Account Creation/Resolution endpoint
  app.post("/api/admin/create-auth-user", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const caller = authReq.user;

    if (!isFirebaseAdminAvailable()) {
      return res.status(503).json({
        error: "Firebase Admin SDK is not available.",
        code: "ADMIN_CREDENTIALS_UNAVAILABLE"
      });
    }

    try {
      const request = parseProvisioningRequest(req.body || {});
      const { auth: adminAuth, db } = getFirebaseAdminServices();
      const permissionSnapshot = await db.collection("rolePermissions").doc(caller.role).get();
      authorizeProvisioning(caller, permissionSnapshot.exists ? permissionSnapshot.data() as Permissions : null, request.role);
      await assertSingletonProvisioningRoleAvailable(db, request.role);
      const canonicalMatches = await db.collection("users").where("email", "==", request.email).get();
      let authUser;
      let existing = false;

      try {
        authUser = await adminAuth.getUserByEmail(request.email);
        existing = true;
      } catch (notFoundErr: any) {
        if (notFoundErr?.code !== "auth/user-not-found") {
          throw notFoundErr;
        }
        if (!canonicalMatches.empty) throw new Error("CANONICAL_IDENTITY_CONFLICT");
        authUser = await adminAuth.createUser({
          email: request.email,
          emailVerified: false,
          displayName: request.name,
          ...(request.password ? { password: request.password } : {}),
          disabled: request.disabled
        });
        existing = false;
      }

      if (canonicalMatches.docs.some((doc) => doc.id !== authUser.uid)) throw new Error("CANONICAL_IDENTITY_CONFLICT");

      return res.json({
        success: true,
        authUid: authUser.uid,
        email: authUser.email,
        existing
      });
    } catch (err: any) {
      console.error("[API Admin Create User Error]", err);
      return res.status(Number.isInteger(err?.status) ? err.status : 500).json({
        error: err.message || "Failed to create or resolve Auth account.",
        code: err.code || "AUTH_CREATION_FAILED"
      });
    }
  });

  // Secure Firebase Runtime Diagnostic endpoint (Super Admin/Admin only)
  app.get("/api/admin/firebase-diagnostic", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;

    // Verify authorized roles: Super Admin or Admin
    if (user.role !== "Super Admin" && user.role !== "Admin" && user.role !== "Super Admin" && user.role !== "Admin") {
      console.warn(`[Diagnostic API Gate] Unauthorized diagnostic attempt by user ${user.id} (${user.role})`);
      return res.status(403).json({ error: "Forbidden: Super Admin or Admin role required." });
    }

    try {
      let serviceAccountEmail = "unknown";
      let metadataProjectId = "unknown";
      let metadataRegion = "unknown";
      let adminSdkSource = "firebase-applet-config.json";

      // Try to query Cloud Run metadata server
      try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 1000);
        const resEmail = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email", {
          headers: { "Metadata-Flavor": "Google" },
          signal: controller.signal
        });
        clearTimeout(id);
        if (resEmail.ok) {
          serviceAccountEmail = (await resEmail.text()).trim();
        }
      } catch (e) {}

      try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 1000);
        const resProj = await fetch("http://metadata.google.internal/computeMetadata/v1/project/project-id", {
          headers: { "Metadata-Flavor": "Google" },
          signal: controller.signal
        });
        clearTimeout(id);
        if (resProj.ok) {
          metadataProjectId = (await resProj.text()).trim();
        }
      } catch (e) {}

      try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 1000);
        const resRegion = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/region", {
          headers: { "Metadata-Flavor": "Google" },
          signal: controller.signal
        });
        clearTimeout(id);
        if (resRegion.ok) {
          const rawRegion = (await resRegion.text()).trim();
          // format: projects/12345/regions/europe-west1
          const parts = rawRegion.split("/");
          metadataRegion = parts[parts.length - 1] || rawRegion;
        }
      } catch (e) {}

      // Return secure, masked diagnostic information
      res.json({
        backendProjectId: firebaseRuntimeIdentity.projectId,
        backendDatabaseId: firebaseRuntimeIdentity.databaseId,
        serviceAccountProjectId: metadataProjectId,
        serviceAccountEmail: serviceAccountEmail,
        cloudRunRegion: metadataRegion || process.env.CLOUD_RUN_REGION || "europe-west1",
        adminSdkSource: adminSdkSource
      });
    } catch (err: any) {
      console.error("[Diagnostic API] Error generating backend diagnostics:", err);
      res.status(500).json({ error: "Failed to gather backend diagnostics", details: err.message });
    }
  });

  // POST /api/target-plans/:planId/calculate - Trigger Product Sales Target calculation run
  app.post("/api/target-plans/:planId/calculate", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;
    const { planId } = req.params;

    // Authorized roles: Super Admin, Admin, Country Manager, Sales & Marketing Manager, Sales Manager
    const allowedRoles = ["Super Admin", "Admin", "Country Manager", "Sales & Marketing Manager", "Sales Manager"];
    if (!allowedRoles.includes(user.role)) {
      console.warn(`[Target Calculation Gate] Forbidden: user ${user.id} with role '${user.role}' is not authorized.`);
      return res.status(403).json({ error: `Forbidden: Role '${user.role}' is not authorized to trigger target calculation.` });
    }

    try {
      console.info(`[Target Calculation] Initiating calculation run for plan: ${planId} by user: ${user.id}`);
      const run = await runTargetCalculation(planId, user.id);
      return res.json(run);
    } catch (err: any) {
      console.error(`[Target Calculation Error] Run failure for plan ${planId}:`, err.message);
      return res.status(500).json({ error: "Calculation pipeline failure", details: err.message });
    }
  });

  // GET /api/target-plans/:planId/calculate-runs/:runId - Retrieve the status of a specific calculation run
  app.get("/api/target-plans/:planId/calculate-runs/:runId", requireFirebaseAuth, async (req: Request, res: Response) => {
    const { planId, runId } = req.params;

    try {
      const { db } = getFirebaseAdminServices();
      const runDocId = createTargetCalculationRunId(planId, runId);
      const runSnap = await db.collection("targetCalculationRuns").doc(runDocId).get();

      if (!runSnap.exists) {
        return res.status(404).json({ error: `Calculation run with ID '${runId}' not found for plan '${planId}'.` });
      }

      return res.json(runSnap.data());
    } catch (err: any) {
      console.error(`[Target Calculation Run Fetch Error] Error fetching run details:`, err.message);
      return res.status(500).json({ error: "Failed to retrieve calculation run details", details: err.message });
    }
  });

  // POST /api/target-plans/import/validate - Stage and validate a targets template file
  app.post("/api/target-plans/import/validate", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;
    const { templateType, rows, fileName, countryId, year } = req.body;

    // Authorized roles: Super Admin, Admin, Country Manager, Sales & Marketing Manager, Sales Manager
    const allowedRoles = ["Super Admin", "Admin", "Country Manager", "Sales & Marketing Manager", "Sales Manager"];
    if (!allowedRoles.includes(user.role)) {
      return res.status(403).json({ error: `Forbidden: Role '${user.role}' is not authorized to validate targets imports.` });
    }

    if (!templateType || !rows || !countryId || !year) {
      return res.status(400).json({ error: "Missing required fields (templateType, rows, countryId, year)" });
    }

    try {
      const { db } = getFirebaseAdminServices();
      const result = await validateImportBatch(db, {
        templateType,
        rows,
        fileName: fileName || "uploaded_file.xlsx",
        countryId,
        year: Number(year),
        importedBy: user.email || user.id
      });
      return res.json(result);
    } catch (err: any) {
      console.error(`[Target Import Validation API Error]`, err);
      return res.status(500).json({ error: "Failed to parse or validate targets template", details: err.message });
    }
  });

  // POST /api/target-plans/import/commit - Commit staged valid target records to their production collections
  app.post("/api/target-plans/import/commit", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;
    const { importId } = req.body;

    const allowedRoles = ["Super Admin", "Admin", "Country Manager", "Sales & Marketing Manager", "Sales Manager"];
    if (!allowedRoles.includes(user.role)) {
      return res.status(403).json({ error: `Forbidden: Role '${user.role}' is not authorized to commit targets imports.` });
    }

    if (!importId) {
      return res.status(400).json({ error: "Missing importId" });
    }

    try {
      const { db } = getFirebaseAdminServices();
      const result = await commitImportBatch(db, importId, user.email || user.id);
      if (!result.success) {
        return res.status(400).json(result);
      }
      return res.json(result);
    } catch (err: any) {
      console.error(`[Target Import Commit API Error]`, err);
      return res.status(500).json({ error: "Failed to commit targets import", details: err.message });
    }
  });

  // POST /api/target-plans/import/rollback - Roll back a committed import batch
  app.post("/api/target-plans/import/rollback", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;
    const { importId } = req.body;

    const allowedRoles = ["Super Admin", "Admin", "Country Manager", "Sales & Marketing Manager", "Sales Manager"];
    if (!allowedRoles.includes(user.role)) {
      return res.status(403).json({ error: `Forbidden: Role '${user.role}' is not authorized to roll back targets imports.` });
    }

    if (!importId) {
      return res.status(400).json({ error: "Missing importId" });
    }

    try {
      const { db } = getFirebaseAdminServices();
      const result = await rollbackImportBatch(db, importId);
      if (!result.success) {
        return res.status(400).json(result);
      }
      return res.json(result);
    } catch (err: any) {
      console.error(`[Target Import Rollback API Error]`, err);
      return res.status(500).json({ error: "Failed to roll back targets import", details: err.message });
    }
  });

  // GET /api/product-target-performance - Retrieve performance records & summaries
  app.get("/api/product-target-performance", requireFirebaseAuth, async (req: Request, res: Response) => {
    const year = Number(req.query.year) || 2026;
    const productId = req.query.productId as string;
    const areaId = req.query.areaId as string;
    const month = req.query.month ? Number(req.query.month) : undefined;

    try {
      const result = await getPerformanceSummary({ year, productId, areaId, month });
      return res.json(result);
    } catch (err: any) {
      console.error("[Performance API] Error fetching performance summary:", err.message);
      return res.status(500).json({ error: "Failed to fetch performance summary", details: err.message });
    }
  });

  // GET /api/product-target-performance/my-targets - Retrieve representative scoped performance records
  app.get("/api/product-target-performance/my-targets", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;
    const year = Number(req.query.year) || 2026;
    const productId = req.query.productId as string;

    const areaIds = user.areaIds || [];

    try {
      const result = await getPerformanceSummary({ year, productId, areaIds });
      return res.json(result);
    } catch (err: any) {
      console.error("[Performance My-Targets API] Error fetching user scoped performance:", err.message);
      return res.status(500).json({ error: "Failed to fetch user performance summary", details: err.message });
    }
  });

  // POST /api/product-target-performance/rebuild - Rebuild performance cache & exceptions
  app.post("/api/product-target-performance/rebuild", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;
    const year = Number(req.body.year) || 2026;

    const allowedRoles = ["Super Admin", "Admin", "Country Manager", "Sales & Marketing Manager", "Sales Manager"];
    if (!allowedRoles.includes(user.role)) {
      return res.status(403).json({ error: `Forbidden: Role '${user.role}' is not authorized to trigger target performance rebuild.` });
    }

    const isGlobalAdmin = ["Super Admin", "Admin", "General Manager"].includes(user.role);
    const countryScopeId = isGlobalAdmin ? undefined : user.country;

    try {
      const result = await rebuildPerformanceData(year, countryScopeId);
      return res.json(result);
    } catch (err: any) {
      console.error("[Performance Rebuild API] Error running rebuild:", err.message);
      return res.status(500).json({ error: "Failed to rebuild performance data", details: err.message });
    }
  });

  // GET /api/product-target-performance/exceptions - View data quality & alignment gaps
  app.get("/api/product-target-performance/exceptions", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;

    const allowedRoles = ["Super Admin", "Admin", "Country Manager", "Sales & Marketing Manager", "Sales Manager"];
    if (!allowedRoles.includes(user.role)) {
      return res.status(403).json({ error: `Forbidden: Role '${user.role}' is not authorized to view exceptions.` });
    }

    try {
      const { db } = getFirebaseAdminServices();
      const snap = await db.collection("salesPerformanceExceptions").get();
      let exceptions: any[] = [];
      snap.forEach(doc => {
        exceptions.push(doc.data());
      });

      // Secure Scope Filtering:
      const isGlobalAdmin = ["Super Admin", "Admin", "General Manager"].includes(user.role);
      if (!isGlobalAdmin && user.country) {
        exceptions = exceptions.filter(e => e.countryId === user.country);
      }

      return res.json({ exceptions });
    } catch (err: any) {
      console.error("[Performance Exceptions API] Error loading exceptions:", err.message);
      return res.status(500).json({ error: "Failed to load exceptions", details: err.message });
    }
  });


  // --- Product Target Plan Lifecycle Transitions (WP4.1H) ---
  app.post("/api/product-target-plans/:planId/submit", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;
    const { planId } = req.params;

    try {
      const { db } = getFirebaseAdminServices();
      const updatedPlan = await submitPlan(db, planId, user);
      return res.json(updatedPlan);
    } catch (err: any) {
      console.error(`[Lifecycle Submit Error] ${planId}:`, err.message);
      return res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/product-target-plans/:planId/approve", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;
    const { planId } = req.params;
    const { comment } = req.body;

    try {
      const { db } = getFirebaseAdminServices();
      const updatedPlan = await approvePlan(db, planId, user, comment || "");
      return res.json(updatedPlan);
    } catch (err: any) {
      console.error(`[Lifecycle Approve Error] ${planId}:`, err.message);
      return res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/product-target-plans/:planId/reject", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;
    const { planId } = req.params;
    const { reason } = req.body;

    try {
      const { db } = getFirebaseAdminServices();
      const updatedPlan = await rejectPlan(db, planId, user, reason || "");
      return res.json(updatedPlan);
    } catch (err: any) {
      console.error(`[Lifecycle Reject Error] ${planId}:`, err.message);
      return res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/product-target-plans/:planId/activate", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;
    const { planId } = req.params;
    const { effectiveFrom } = req.body;

    try {
      const { db } = getFirebaseAdminServices();
      const updatedPlan = await activatePlan(db, planId, user, effectiveFrom);
      return res.json(updatedPlan);
    } catch (err: any) {
      console.error(`[Lifecycle Activate Error] ${planId}:`, err.message);
      return res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/product-target-plans/:planId/amend", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;
    const { planId } = req.params;
    const { reason, effectiveFrom } = req.body;

    try {
      const { db } = getFirebaseAdminServices();
      const updatedPlan = await amendPlan(db, planId, user, reason || "", effectiveFrom);
      return res.json(updatedPlan);
    } catch (err: any) {
      console.error(`[Lifecycle Amend Error] ${planId}:`, err.message);
      return res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/product-target-plans/:planId/close", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;
    const { planId } = req.params;

    try {
      const { db } = getFirebaseAdminServices();
      const updatedPlan = await closePlan(db, planId, user);
      return res.json(updatedPlan);
    } catch (err: any) {
      console.error(`[Lifecycle Close Error] ${planId}:`, err.message);
      return res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/product-target-plans/:planId/cancel", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;
    const { planId } = req.params;
    const { reason } = req.body;

    try {
      const { db } = getFirebaseAdminServices();
      const updatedPlan = await cancelPlan(db, planId, user, reason || "");
      return res.json(updatedPlan);
    } catch (err: any) {
      console.error(`[Lifecycle Cancel Error] ${planId}:`, err.message);
      return res.status(400).json({ error: err.message });
    }
  });


  // Secure Audit Ledger persistence endpoint
  app.post("/api/audit-events", requireFirebaseAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;
    try {
      const { db } = getFirebaseAdminServices();
      const finalizedLog = await persistAuthoritativeAuditEvent(db, req.body || {}, user);
      console.log(`[Trusted Audit Backend] Saved audit log ${finalizedLog.id} successfully.`);
      return res.json({ status: "success", auditLog: finalizedLog });
    } catch (err: any) {
      console.error("[Trusted Audit Backend Error]", err.message);
      return res.status(err.message === "INVALID_AUDIT_EVENT_PAYLOAD" ? 400 : 500).json({ error: err.message });
    }
  });


  // 404 handler for unmatched API routes
  app.use("/api/*", (req: Request, res: Response) => {
    res.status(404).json({ error: "API route not found", path: req.originalUrl });
  });

  // Serve Vite in dev, static files in production
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(releaseRuntime.port, "0.0.0.0", () => {
    console.log(`[MENAREPS Server] running at http://localhost:${releaseRuntime.port}`);
  });
}

startServer().catch((error) => {
  console.error("[MENAREPS_STARTUP_FAILED]", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
