import { getFirebaseAdminServices } from "../../server/firebaseAdmin";
import { 
  TargetStatus, 
  Role, 
  ProductTargetPlan, 
  ProductAnnualTarget, 
  ProductAreaPotential, 
  ProductQuarterlyDistribution, 
  CalculatedProductTarget 
} from "../types";
import { 
  createProductTargetPlanId, 
  createProductAnnualTargetId, 
  createProductAreaPotentialId, 
  createProductQuarterlyDistributionId,
  createCalculatedProductTargetId
} from "./productTargetIdService";
import { runTargetCalculation } from "./targetCalculationService";

/**
 * Checks if a role is globally privileged (exempt from Country Scope checks).
 */
export function isGloballyPrivileged(role: Role): boolean {
  return [
    Role.SUPER_ADMIN,
    Role.ADMIN,
    Role.SYSTEM_ADMINISTRATOR,
    Role.GENERAL_MANAGER
  ].includes(role);
}

/**
 * Enforces role authority for specific target plan lifecycle actions.
 */
export function hasLifecyclePermission(
  role: Role, 
  action: "submit" | "approve" | "reject" | "activate" | "amend" | "close" | "cancel"
): boolean {
  switch (action) {
    case "submit":
      return [
        Role.SUPER_ADMIN,
        Role.ADMIN,
        Role.SYSTEM_ADMINISTRATOR,
        Role.SALES_MARKETING_MANAGER,
        Role.SALES_MANAGER,
        Role.COUNTRY_MANAGER
      ].includes(role);
    case "approve":
    case "reject":
    case "activate":
      return [
        Role.SUPER_ADMIN,
        Role.ADMIN,
        Role.SYSTEM_ADMINISTRATOR,
        Role.GENERAL_MANAGER,
        Role.SALES_MARKETING_MANAGER,
        Role.COUNTRY_MANAGER
      ].includes(role);
    case "amend":
      return [
        Role.SUPER_ADMIN,
        Role.ADMIN,
        Role.SYSTEM_ADMINISTRATOR,
        Role.SALES_MARKETING_MANAGER,
        Role.SALES_MANAGER,
        Role.COUNTRY_MANAGER
      ].includes(role);
    case "close":
      return [
        Role.SUPER_ADMIN,
        Role.ADMIN,
        Role.SYSTEM_ADMINISTRATOR,
        Role.GENERAL_MANAGER,
        Role.SALES_MARKETING_MANAGER,
        Role.COUNTRY_MANAGER
      ].includes(role);
    case "cancel":
      return [
        Role.SUPER_ADMIN,
        Role.ADMIN,
        Role.SYSTEM_ADMINISTRATOR,
        Role.SALES_MARKETING_MANAGER,
        Role.SALES_MANAGER,
        Role.COUNTRY_MANAGER
      ].includes(role);
    default:
      return false;
  }
}

/**
 * Verifies if user is within the allowed country scope for the given plan countryId.
 */
export function isUserInCountryScope(user: any, countryId: string): boolean {
  if (isGloballyPrivileged(user.role)) {
    return true;
  }
  
  const userCountry = (user.country || "").trim().toLowerCase();
  const targetCountry = (countryId || "").trim().toLowerCase();
  
  if (userCountry === targetCountry) {
    return true;
  }

  const assigned = user.assignedCountries || [];
  return assigned.some((c: string) => c.trim().toLowerCase() === targetCountry);
}

/**
 * Writes a canonical audit ledger log to the database.
 */
export async function writeAuditLog(
  db: any,
  params: {
    planId: string;
    operation: string;
    fromStatus: TargetStatus | "NONE";
    toStatus: TargetStatus;
    actor: any;
    countryId: string;
    comment?: string;
    beforeSnapshot?: any;
    afterSnapshot?: any;
  }
): Promise<string> {
  const logId = `AUD::${params.planId}::${params.operation}::${Date.now()}`;
  const now = new Date().toISOString();

  const auditDoc = {
    id: logId,
    userId: params.actor.id || params.actor.uid || "system",
    userName: params.actor.name || params.actor.email || "System User",
    userRole: params.actor.role || "system",
    action: params.operation,
    entityType: "productTargetPlans",
    entityName: params.planId,
    entityId: params.planId,
    details: `State transition from ${params.fromStatus} to ${params.toStatus}. Comment: ${params.comment || "None"}`,
    timestamp: now,
    
    // WP4.1H specific Audit certification schema
    auditId: logId,
    planId: params.planId,
    operation: params.operation,
    fromStatus: params.fromStatus,
    toStatus: params.toStatus,
    actorUid: params.actor.id || params.actor.uid || "system",
    actorRole: params.actor.role || "system",
    countryId: params.countryId,
    reason: params.comment || "",
    sourceModule: "WP4.1H - Sales Target Security",
    beforeSnapshot: params.beforeSnapshot ? JSON.stringify(params.beforeSnapshot) : null,
    afterSnapshot: params.afterSnapshot ? JSON.stringify(params.afterSnapshot) : null
  };

  await db.collection("auditLogs").doc(logId).set(auditDoc);
  return logId;
}

/**
 * Updates status recursively on all related sub-entities of a plan.
 */
async function updateSubEntitiesStatus(db: any, planId: string, newStatus: TargetStatus): Promise<void> {
  const collections = [
    "productAnnualTargets",
    "productAreaPotentials",
    "productQuarterlyDistributions",
    "calculatedProductTargets"
  ];

  const shouldDeactivate = [
    TargetStatus.SUPERSEDED,
    TargetStatus.CLOSED,
    TargetStatus.CANCELLED
  ].includes(newStatus);

  for (const collName of collections) {
    const snap = await db.collection(collName)
      .where("planId", "==", planId)
      .get();
    
    if (!snap.empty) {
      const batch = db.batch();
      snap.docs.forEach((doc: any) => {
        const updatePayload: any = { 
          status: newStatus, 
          updatedAt: new Date().toISOString() 
        };
        if (shouldDeactivate) {
          updatePayload.active = false;
        }
        batch.update(doc.ref, updatePayload);
      });
      await batch.commit();
    }
  }
}

/**
 * Validation Gate checks before submission.
 */
export async function validateSubmissionGate(db: any, planId: string): Promise<{ valid: boolean; error?: string }> {
  // 1. Fetch Plan
  const planSnap = await db.collection("productTargetPlans").doc(planId).get();
  if (!planSnap.exists) {
    return { valid: false, error: "Target plan does not exist" };
  }

  // 2. Fetch Annual Targets
  const annualSnap = await db.collection("productAnnualTargets")
    .where("planId", "==", planId)
    .where("active", "==", true)
    .get();

  if (annualSnap.empty) {
    return { valid: false, error: "Submission Gate Rejected: Target plan is empty. At least one annual product target is required." };
  }

  const annualTargets = annualSnap.docs.map((d: any) => d.data() as ProductAnnualTarget);

  // 3. Check Potential Distribution and Quarterly Distribution sum for each product
  for (const target of annualTargets) {
    const { productId } = target;

    // Check potentials
    const potentialsSnap = await db.collection("productAreaPotentials")
      .where("planId", "==", planId)
      .where("productId", "==", productId)
      .where("active", "==", true)
      .get();

    if (potentialsSnap.empty) {
      return { valid: false, error: `Submission Gate Rejected: Product ${productId} lacks area potential mappings.` };
    }

    const potentials = potentialsSnap.docs.map((d: any) => d.data() as ProductAreaPotential);
    const sumPotentials = potentials.reduce((acc, p) => acc + p.potentialPercentage, 0);
    if (Math.abs(sumPotentials - 100) > 0.05) {
      return { 
        valid: false, 
        error: `Submission Gate Rejected: Area potentials for product ${productId} must sum to exactly 100% (currently ${sumPotentials}%).` 
      };
    }

    // Check quarterly
    const quarterlySnap = await db.collection("productQuarterlyDistributions")
      .where("planId", "==", planId)
      .where("productId", "==", productId)
      .where("active", "==", true)
      .get();

    if (quarterlySnap.empty) {
      return { valid: false, error: `Submission Gate Rejected: Product ${productId} lacks quarterly distribution percentages.` };
    }

    const dist = quarterlySnap.docs[0].data() as ProductQuarterlyDistribution;
    const sumQuarterly = dist.q1Percentage + dist.q2Percentage + dist.q3Percentage + dist.q4Percentage;
    if (Math.abs(sumQuarterly - 100) > 0.05) {
      return { 
        valid: false, 
        error: `Submission Gate Rejected: Quarterly percentages for product ${productId} must sum to exactly 100% (currently ${sumQuarterly}%).` 
      };
    }

    // 4. Validate captured unit prices (must be positive)
    if (!target.unitPriceSnapshot || target.unitPriceSnapshot <= 0) {
      return {
        valid: false,
        error: `Submission Gate Rejected: Product ${productId} has an invalid or zero unit price snapshot.`
      };
    }
  }

  // 5. Ensure calculated monthly targets exist
  const calculatedSnap = await db.collection("calculatedProductTargets")
    .where("planId", "==", planId)
    .where("active", "==", true)
    .get();

  if (calculatedSnap.empty) {
    return { valid: false, error: "Submission Gate Rejected: Detailing monthly targets have not been calculated yet." };
  }

  return { valid: true };
}

/**
 * 1. SUBMIT TRANSITION (DRAFT or REJECTED -> SUBMITTED)
 */
export async function submitPlan(db: any, planId: string, actor: any): Promise<ProductTargetPlan> {
  const planRef = db.collection("productTargetPlans").doc(planId);
  const planSnap = await planRef.get();
  if (!planSnap.exists) {
    throw new Error("Target plan does not exist");
  }

  const plan = planSnap.data() as ProductTargetPlan;

  // Role check
  if (!hasLifecyclePermission(actor.role, "submit")) {
    throw new Error(`Forbidden: Role '${actor.role}' does not have authority to submit plans.`);
  }

  // Country Scope check
  if (!isUserInCountryScope(actor, plan.countryId)) {
    throw new Error(`Forbidden: You do not have country scope permission for ${plan.countryId}.`);
  }

  // Status check
  if (plan.status !== TargetStatus.DRAFT && plan.status !== TargetStatus.REJECTED) {
    throw new Error(`Invalid Transition: Can only submit plan in DRAFT or REJECTED status. Current status: ${plan.status}`);
  }

  // Submission Gate
  const gate = await validateSubmissionGate(db, planId);
  if (!gate.valid) {
    throw new Error(gate.error);
  }

  const beforeSnap = { ...plan };
  const now = new Date().toISOString();

  // Perform status update
  const updatedPlan: Partial<ProductTargetPlan> = {
    status: TargetStatus.SUBMITTED,
    updatedAt: now,
    updatedBy: actor.email,
    submittedAt: now,
    submittedBy: actor.email
  };

  await planRef.update(updatedPlan);
  await updateSubEntitiesStatus(db, planId, TargetStatus.SUBMITTED);

  const finalPlan = { ...plan, ...updatedPlan } as ProductTargetPlan;

  // Write audit log
  await writeAuditLog(db, {
    planId,
    operation: "SUBMIT",
    fromStatus: plan.status,
    toStatus: TargetStatus.SUBMITTED,
    actor,
    countryId: plan.countryId,
    comment: "Submitted for approval",
    beforeSnapshot: beforeSnap,
    afterSnapshot: finalPlan
  });

  return finalPlan;
}

/**
 * 2. APPROVE TRANSITION (SUBMITTED -> APPROVED)
 */
export async function approvePlan(db: any, planId: string, actor: any, comment: string): Promise<ProductTargetPlan> {
  const planRef = db.collection("productTargetPlans").doc(planId);
  const planSnap = await planRef.get();
  if (!planSnap.exists) {
    throw new Error("Target plan does not exist");
  }

  const plan = planSnap.data() as ProductTargetPlan;

  // Role check
  if (!hasLifecyclePermission(actor.role, "approve")) {
    throw new Error(`Forbidden: Role '${actor.role}' does not have authority to approve plans.`);
  }

  // Country Scope check
  if (!isUserInCountryScope(actor, plan.countryId)) {
    throw new Error(`Forbidden: You do not have country scope permission for ${plan.countryId}.`);
  }

  // Status check
  if (plan.status !== TargetStatus.SUBMITTED) {
    throw new Error(`Invalid Transition: Can only approve plan in SUBMITTED status. Current status: ${plan.status}`);
  }

  // Segregation of duties: Cannot self-approve if actor was submitter or creator
  const submittedBy = plan.submittedBy || "";
  const createdBy = plan.createdBy || "";
  const actorId = actor.id || actor.uid || "";
  const actorEmail = actor.email || "";

  const isSelfSubmitter = (submittedBy && actorId && submittedBy.toLowerCase() === actorId.toLowerCase()) || 
                          (submittedBy && actorEmail && submittedBy.toLowerCase() === actorEmail.toLowerCase());
                          
  const isSelfCreator = (createdBy && actorId && createdBy.toLowerCase() === actorId.toLowerCase()) || 
                        (createdBy && actorEmail && createdBy.toLowerCase() === actorEmail.toLowerCase());

  if (isSelfSubmitter || isSelfCreator) {
    if (![Role.SUPER_ADMIN, Role.ADMIN, Role.SYSTEM_ADMINISTRATOR].includes(actor.role)) {
      throw new Error("Segregation of duties check failed: A plan cannot be approved by its submitter or creator.");
    }
  }

  const beforeSnap = { ...plan };
  const now = new Date().toISOString();

  const updatedPlan: Partial<ProductTargetPlan> = {
    status: TargetStatus.APPROVED,
    updatedAt: now,
    updatedBy: actor.email,
    approvedAt: now,
    approvedBy: actor.email
  };

  await planRef.update(updatedPlan);
  await updateSubEntitiesStatus(db, planId, TargetStatus.APPROVED);

  const finalPlan = { ...plan, ...updatedPlan } as ProductTargetPlan;

  // Write audit log
  await writeAuditLog(db, {
    planId,
    operation: "APPROVE",
    fromStatus: plan.status,
    toStatus: TargetStatus.APPROVED,
    actor,
    countryId: plan.countryId,
    comment: comment || "Approved",
    beforeSnapshot: beforeSnap,
    afterSnapshot: finalPlan
  });

  return finalPlan;
}

/**
 * 3. REJECT TRANSITION (SUBMITTED -> REJECTED)
 */
export async function rejectPlan(db: any, planId: string, actor: any, reason: string): Promise<ProductTargetPlan> {
  if (!reason || reason.trim() === "") {
    throw new Error("Rejection reason/comment is required.");
  }

  const planRef = db.collection("productTargetPlans").doc(planId);
  const planSnap = await planRef.get();
  if (!planSnap.exists) {
    throw new Error("Target plan does not exist");
  }

  const plan = planSnap.data() as ProductTargetPlan;

  // Role check
  if (!hasLifecyclePermission(actor.role, "reject")) {
    throw new Error(`Forbidden: Role '${actor.role}' does not have authority to reject plans.`);
  }

  // Country Scope check
  if (!isUserInCountryScope(actor, plan.countryId)) {
    throw new Error(`Forbidden: You do not have country scope permission for ${plan.countryId}.`);
  }

  // Status check
  if (plan.status !== TargetStatus.SUBMITTED) {
    throw new Error(`Invalid Transition: Can only reject plan in SUBMITTED status. Current status: ${plan.status}`);
  }

  const beforeSnap = { ...plan };
  const now = new Date().toISOString();

  const updatedPlan: Partial<ProductTargetPlan> = {
    status: TargetStatus.REJECTED,
    updatedAt: now,
    updatedBy: actor.email,
    rejectedAt: now,
    rejectedBy: actor.email,
    rejectionReason: reason
  };

  await planRef.update(updatedPlan);
  await updateSubEntitiesStatus(db, planId, TargetStatus.REJECTED);

  const finalPlan = { ...plan, ...updatedPlan } as ProductTargetPlan;

  // Write audit log
  await writeAuditLog(db, {
    planId,
    operation: "REJECT",
    fromStatus: plan.status,
    toStatus: TargetStatus.REJECTED,
    actor,
    countryId: plan.countryId,
    comment: reason,
    beforeSnapshot: beforeSnap,
    afterSnapshot: finalPlan
  });

  return finalPlan;
}

/**
 * 4. ACTIVATE TRANSITION (APPROVED -> ACTIVE)
 * Mutex lock: Supersedes existing active plan for same Country + Year.
 */
export async function activatePlan(db: any, planId: string, actor: any, effectiveFrom?: string): Promise<ProductTargetPlan> {
  const planRef = db.collection("productTargetPlans").doc(planId);
  const planSnap = await planRef.get();
  if (!planSnap.exists) {
    throw new Error("Target plan does not exist");
  }

  const plan = planSnap.data() as ProductTargetPlan;

  // Role check
  if (!hasLifecyclePermission(actor.role, "activate")) {
    throw new Error(`Forbidden: Role '${actor.role}' does not have authority to activate plans.`);
  }

  // Country Scope check
  if (!isUserInCountryScope(actor, plan.countryId)) {
    throw new Error(`Forbidden: You do not have country scope permission for ${plan.countryId}.`);
  }

  // Status check
  if (plan.status !== TargetStatus.APPROVED) {
    throw new Error(`Invalid Transition: Can only activate plan in APPROVED status. Current status: ${plan.status}`);
  }

  const beforeSnap = { ...plan };
  const now = new Date().toISOString();
  const effFrom = effectiveFrom || now;

  // ATOMIC LOCK: Find and supersede existing ACTIVE plans for the same Country + Year
  const activePlansSnap = await db.collection("productTargetPlans")
    .where("countryId", "==", plan.countryId)
    .where("year", "==", plan.year)
    .where("status", "==", TargetStatus.ACTIVE)
    .get();

  if (!activePlansSnap.empty) {
    for (const doc of activePlansSnap.docs) {
      const oldPlan = doc.data() as ProductTargetPlan;
      if (oldPlan.planId !== planId) {
        // Supersede old plan
        await doc.ref.update({
          status: TargetStatus.SUPERSEDED,
          updatedAt: now,
          updatedBy: actor.email,
          effectiveTo: effFrom,
          active: false
        });
        await updateSubEntitiesStatus(db, oldPlan.planId, TargetStatus.SUPERSEDED);

        // Audit superseded plan
        await writeAuditLog(db, {
          planId: oldPlan.planId,
          operation: "SUPERSEDE",
          fromStatus: TargetStatus.ACTIVE,
          toStatus: TargetStatus.SUPERSEDED,
          actor,
          countryId: oldPlan.countryId,
          comment: `Plan was superseded by activation of new version ${plan.version} (${planId}).`
        });
      }
    }
  }

  // Activate new plan
  const updatedPlan: Partial<ProductTargetPlan> = {
    status: TargetStatus.ACTIVE,
    updatedAt: now,
    updatedBy: actor.email,
    activatedAt: now,
    activatedBy: actor.email,
    effectiveFrom: effFrom
  };

  await planRef.update(updatedPlan);
  await updateSubEntitiesStatus(db, planId, TargetStatus.ACTIVE);

  const finalPlan = { ...plan, ...updatedPlan } as ProductTargetPlan;

  // Write audit log
  await writeAuditLog(db, {
    planId,
    operation: "ACTIVATE",
    fromStatus: plan.status,
    toStatus: TargetStatus.ACTIVE,
    actor,
    countryId: plan.countryId,
    comment: `Activated as the operative plan starting from ${effFrom}`,
    beforeSnapshot: beforeSnap,
    afterSnapshot: finalPlan
  });

  return finalPlan;
}

/**
 * 5. VERSIONED AMENDMENT (ACTIVE -> DRAFT copy with incremented version)
 */
export async function amendPlan(
  db: any, 
  planId: string, 
  actor: any, 
  reason: string, 
  effectiveFrom?: string
): Promise<ProductTargetPlan> {
  if (!reason || reason.trim() === "") {
    throw new Error("Amendment reason is required.");
  }

  if (!effectiveFrom || effectiveFrom.trim() === "") {
    throw new Error("Effective from date is required for amendments.");
  }

  const oldPlanSnap = await db.collection("productTargetPlans").doc(planId).get();
  if (!oldPlanSnap.exists) {
    throw new Error("Target plan to amend does not exist");
  }

  const oldPlan = oldPlanSnap.data() as ProductTargetPlan;

  // Role check
  if (!hasLifecyclePermission(actor.role, "amend")) {
    throw new Error(`Forbidden: Role '${actor.role}' does not have authority to amend plans.`);
  }

  // Country Scope check
  if (!isUserInCountryScope(actor, oldPlan.countryId)) {
    throw new Error(`Forbidden: You do not have country scope permission for ${oldPlan.countryId}.`);
  }

  // Status check - only ACTIVE plan can be amended
  if (oldPlan.status !== TargetStatus.ACTIVE) {
    throw new Error(`Invalid Operation: Can only amend plans in ACTIVE status. Current status: ${oldPlan.status}`);
  }

  const now = new Date().toISOString();
  const nextVersion = oldPlan.version + 1;
  const newPlanId = createProductTargetPlanId(oldPlan.countryId, oldPlan.year, nextVersion);

  // Check if this new plan ID already exists
  const checkNewPlan = await db.collection("productTargetPlans").doc(newPlanId).get();
  if (checkNewPlan.exists) {
    throw new Error(`Constraint Error: Plan ID ${newPlanId} (Version ${nextVersion}) already exists.`);
  }

  const newPlan: ProductTargetPlan = {
    planId: newPlanId,
    countryId: oldPlan.countryId,
    year: oldPlan.year,
    currencyCode: oldPlan.currencyCode,
    monthlyDistributionMethod: "EQUAL_WITHIN_QUARTER",
    status: TargetStatus.DRAFT,
    version: nextVersion,
    active: true,
    createdAt: now,
    createdBy: actor.email,
    updatedAt: now,
    updatedBy: actor.email,
    supersedesPlanId: planId,
    amendmentReason: reason,
    effectiveFrom: effectiveFrom || null
  };

  await db.collection("productTargetPlans").doc(newPlanId).set(newPlan);

  // Copy Annual Targets
  const annualSnap = await db.collection("productAnnualTargets")
    .where("planId", "==", planId)
    .where("active", "==", true)
    .get();

  for (const doc of annualSnap.docs) {
    const origTarget = doc.data() as ProductAnnualTarget;
    const newTargetId = createProductAnnualTargetId(newPlanId, origTarget.productId);

    const newTarget: ProductAnnualTarget = {
      ...origTarget,
      targetId: newTargetId,
      planId: newPlanId,
      status: TargetStatus.DRAFT,
      version: nextVersion,
      createdAt: now,
      createdBy: actor.email,
      updatedAt: now,
      updatedBy: actor.email,
      supersedesTargetId: origTarget.targetId,
      amendmentReason: reason
    };

    await db.collection("productAnnualTargets").doc(newTargetId).set(newTarget);

    // Copy Area Potentials
    const areaSnap = await db.collection("productAreaPotentials")
      .where("annualTargetId", "==", origTarget.targetId)
      .where("active", "==", true)
      .get();

    for (const areaDoc of areaSnap.docs) {
      const origArea = areaDoc.data() as ProductAreaPotential;
      const newAreaId = createProductAreaPotentialId(newTargetId, origArea.areaId);

      const newArea: ProductAreaPotential = {
        ...origArea,
        areaPotentialId: newAreaId,
        planId: newPlanId,
        annualTargetId: newTargetId,
        status: TargetStatus.DRAFT,
        version: nextVersion,
        createdAt: now,
        createdBy: actor.email,
        updatedAt: now,
        updatedBy: actor.email
      };

      await db.collection("productAreaPotentials").doc(newAreaId).set(newArea);
    }

    // Copy Quarterly Distribution
    const quarterlySnap = await db.collection("productQuarterlyDistributions")
      .where("annualTargetId", "==", origTarget.targetId)
      .where("active", "==", true)
      .get();

    for (const qDoc of quarterlySnap.docs) {
      const origQ = qDoc.data() as ProductQuarterlyDistribution;
      const newQDId = createProductQuarterlyDistributionId(newTargetId);

      const newQ: ProductQuarterlyDistribution = {
        ...origQ,
        quarterlyDistributionId: newQDId,
        planId: newPlanId,
        annualTargetId: newTargetId,
        status: TargetStatus.DRAFT,
        version: nextVersion,
        createdAt: now,
        createdBy: actor.email,
        updatedAt: now,
        updatedBy: actor.email
      };

      await db.collection("productQuarterlyDistributions").doc(newQDId).set(newQ);
    }
  }

  // Re-run targets calculation automatically for the new plan draft to generate calculated monthly entries!
  try {
    await runTargetCalculation(newPlanId, actor.email, db);
  } catch (calcErr: any) {
    console.error(`Warning: Failed to automatically run calculations for amended plan ${newPlanId}:`, calcErr);
  }

  // Audit amendment
  await writeAuditLog(db, {
    planId: newPlanId,
    operation: "AMEND",
    fromStatus: "NONE",
    toStatus: TargetStatus.DRAFT,
    actor,
    countryId: oldPlan.countryId,
    comment: `Created as version ${nextVersion} to amend version ${oldPlan.version}. Reason: ${reason}`
  });

  return newPlan;
}

/**
 * 6. CLOSE TRANSITION (ACTIVE -> CLOSED)
 */
export async function closePlan(db: any, planId: string, actor: any): Promise<ProductTargetPlan> {
  const planRef = db.collection("productTargetPlans").doc(planId);
  const planSnap = await planRef.get();
  if (!planSnap.exists) {
    throw new Error("Target plan does not exist");
  }

  const plan = planSnap.data() as ProductTargetPlan;

  // Role check
  if (!hasLifecyclePermission(actor.role, "close")) {
    throw new Error(`Forbidden: Role '${actor.role}' does not have authority to close plans.`);
  }

  // Country Scope check
  if (!isUserInCountryScope(actor, plan.countryId)) {
    throw new Error(`Forbidden: You do not have country scope permission for ${plan.countryId}.`);
  }

  // Status check
  if (plan.status !== TargetStatus.ACTIVE) {
    throw new Error(`Invalid Transition: Can only close plans in ACTIVE status. Current status: ${plan.status}`);
  }

  const beforeSnap = { ...plan };
  const now = new Date().toISOString();

  const updatedPlan: Partial<ProductTargetPlan> = {
    status: TargetStatus.CLOSED,
    updatedAt: now,
    updatedBy: actor.email,
    closedAt: now,
    closedBy: actor.email
  };

  await planRef.update(updatedPlan);
  await updateSubEntitiesStatus(db, planId, TargetStatus.CLOSED);

  const finalPlan = { ...plan, ...updatedPlan } as ProductTargetPlan;

  // Write audit log
  await writeAuditLog(db, {
    planId,
    operation: "CLOSE",
    fromStatus: plan.status,
    toStatus: TargetStatus.CLOSED,
    actor,
    countryId: plan.countryId,
    comment: "Closed successfully.",
    beforeSnapshot: beforeSnap,
    afterSnapshot: finalPlan
  });

  return finalPlan;
}

/**
 * 7. CANCEL TRANSITION (DRAFT -> CANCELLED)
 */
export async function cancelPlan(db: any, planId: string, actor: any, reason: string): Promise<ProductTargetPlan> {
  if (!reason || reason.trim() === "") {
    throw new Error("Cancellation reason/comment is required.");
  }

  const planRef = db.collection("productTargetPlans").doc(planId);
  const planSnap = await planRef.get();
  if (!planSnap.exists) {
    throw new Error("Target plan does not exist");
  }

  const plan = planSnap.data() as ProductTargetPlan;

  // Role check
  if (!hasLifecyclePermission(actor.role, "cancel")) {
    throw new Error(`Forbidden: Role '${actor.role}' does not have authority to cancel plans.`);
  }

  // Country Scope check
  if (!isUserInCountryScope(actor, plan.countryId)) {
    throw new Error(`Forbidden: You do not have country scope permission for ${plan.countryId}.`);
  }

  // Status check
  if (plan.status !== TargetStatus.DRAFT) {
    throw new Error(`Invalid Transition: Can only cancel plans in DRAFT status. Current status: ${plan.status}`);
  }

  const beforeSnap = { ...plan };
  const now = new Date().toISOString();

  const updatedPlan: Partial<ProductTargetPlan> = {
    status: TargetStatus.CANCELLED,
    updatedAt: now,
    updatedBy: actor.email,
    cancelledAt: now,
    cancelledBy: actor.email,
    cancellationReason: reason
  };

  await planRef.update(updatedPlan);
  await updateSubEntitiesStatus(db, planId, TargetStatus.CANCELLED);

  const finalPlan = { ...plan, ...updatedPlan } as ProductTargetPlan;

  // Write audit log
  await writeAuditLog(db, {
    planId,
    operation: "CANCEL",
    fromStatus: plan.status,
    toStatus: TargetStatus.CANCELLED,
    actor,
    countryId: plan.countryId,
    comment: reason,
    beforeSnapshot: beforeSnap,
    afterSnapshot: finalPlan
  });

  return finalPlan;
}
