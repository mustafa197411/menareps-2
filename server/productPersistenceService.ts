import type { Firestore } from "firebase-admin/firestore";
import { validateProductReference } from "../src/lib/commercialRegistry";
import { hasPermission } from "../src/lib/userPolicyEngine";
import type { Permissions, User } from "../src/types";
import { removeUndefinedRecursively } from "../src/utils/importNormalization";
import { validateOfferActorProfile } from "./offerAdministrationService";
import { createFirestoreOperationalScopeRepository, resolveOperationalScopeForActor } from "./operationalScopeRepository";

export type ProductMutationOperation = "create" | "edit";
export interface ProductMutationCommand { operation: ProductMutationOperation; productId: string; product: Record<string, unknown> & { isActive: boolean } }
export type ProductMutationResult = { status: "CREATED" | "UPDATED"; product: Record<string, unknown> };
export type ProductMutationBatchResult = { status: "COMPLETED"; products: ProductMutationResult[] };
export const MAX_PRODUCT_IMPORT_COMMANDS = 100;

export class ProductPersistenceError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code); this.name = "ProductPersistenceError"; }
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const exactId = (value: unknown): value is string => typeof value === "string" && value === value.trim() && ID.test(value);
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const exactTimestamp = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const RESERVED_FIELDS = new Set(["id", "productId", "active", "createdAt", "createdBy", "updatedAt", "updatedBy", "importedAt", "importedBy"]);

export function parseProductMutationRequest(value: unknown): ProductMutationCommand | null {
  const input = record(value), product = record(input?.product);
  if (!input || Object.keys(input).some(key => !["operation", "productId", "product"].includes(key))) return null;
  if ((input.operation !== "create" && input.operation !== "edit") || !exactId(input.productId) || !product || typeof product.isActive !== "boolean") return null;
  return { operation: input.operation, productId: input.productId, product: product as ProductMutationCommand["product"] };
}

export function parseProductMutationBatchRequest(value: unknown): ProductMutationCommand[] | null {
  const input = record(value);
  if (!input || Object.keys(input).some(key => key !== "commands") || !Array.isArray(input.commands)) return null;
  const commands = input.commands.map(parseProductMutationRequest);
  return commands.every((command): command is ProductMutationCommand => command !== null) ? commands : null;
}

function businessFields(product: ProductMutationCommand["product"]): Record<string, unknown> {
  return removeUndefinedRecursively(Object.fromEntries(Object.entries(product).filter(([key]) => !RESERVED_FIELDS.has(key))));
}

export interface ProductPersistenceDependencies {
  clock?: () => string;
  authorize?: (actorUid: string, actorProfile: Record<string, unknown>, operation: ProductMutationOperation, productId: string) => Promise<void>;
}

async function authorizeProductMutationBatch(actorUid: string, actorProfile: Record<string, unknown>, commands: ProductMutationCommand[], db: Firestore): Promise<void> {
  let role: string;
  try { role = validateOfferActorProfile(actorUid, actorProfile); }
  catch { throw new ProductPersistenceError("PRODUCT_ACTOR_INVALID", 403); }
  const permissionSnapshot = await db.collection("rolePermissions").doc(role).get();
  const permissions = permissionSnapshot.exists ? permissionSnapshot.data() as Permissions : undefined;
  const actor = { ...actorProfile, id: actorUid, role } as User;
  for (const operation of new Set(commands.map(command => command.operation))) {
    if (!hasPermission(actor, "Products", operation === "create" ? "create" : "edit", permissions)) throw new ProductPersistenceError("PRODUCT_PERMISSION_DENIED", 403);
  }
  const editedProductIds = commands.filter(command => command.operation === "edit").map(command => command.productId);
  if (editedProductIds.length > 0) {
    const scope = await resolveOperationalScopeForActor(actorUid, {}, createFirestoreOperationalScopeRepository());
    if (!scope.authorized || (scope.subjectMode !== "ORGANIZATION" && editedProductIds.some(productId => !scope.productIds.includes(productId)))) throw new ProductPersistenceError("PRODUCT_SCOPE_DENIED", 403);
  }
}

export async function executeProductMutation(
  actorUid: string,
  actorProfile: Record<string, unknown>,
  command: ProductMutationCommand,
  db: Firestore,
  dependencies: ProductPersistenceDependencies = {},
): Promise<ProductMutationResult> {
  const result = await executeProductMutationBatchCore(actorUid, actorProfile, [command], db, dependencies, false);
  return result.products[0];
}

export async function executeProductMutationBatch(
  actorUid: string,
  actorProfile: Record<string, unknown>,
  commands: ProductMutationCommand[],
  db: Firestore,
  dependencies: ProductPersistenceDependencies = {},
): Promise<ProductMutationBatchResult> {
  return executeProductMutationBatchCore(actorUid, actorProfile, commands, db, dependencies, true);
}

async function executeProductMutationBatchCore(
  actorUid: string,
  actorProfile: Record<string, unknown>,
  commands: ProductMutationCommand[],
  db: Firestore,
  dependencies: ProductPersistenceDependencies,
  importAudit: boolean,
): Promise<ProductMutationBatchResult> {
  if (commands.length < 1 || commands.length > MAX_PRODUCT_IMPORT_COMMANDS) throw new ProductPersistenceError("PRODUCT_IMPORT_BATCH_SIZE_INVALID");
  if (commands.some(command => !exactId(command.productId))) throw new ProductPersistenceError("PRODUCT_ID_INVALID");
  if (new Set(commands.map(command => command.productId)).size !== commands.length) throw new ProductPersistenceError("PRODUCT_IMPORT_ID_CONFLICT", 409);
  if (dependencies.authorize) {
    for (const command of commands) await dependencies.authorize(actorUid, actorProfile, command.operation, command.productId);
  } else {
    await authorizeProductMutationBatch(actorUid, actorProfile, commands, db);
  }
  const references = commands.map(command => db.collection("products").doc(command.productId));
  return db.runTransaction(async transaction => {
    const snapshots = [];
    for (const reference of references) snapshots.push(await transaction.get(reference));
    const now = (dependencies.clock || (() => new Date().toISOString()))();
    if (!exactTimestamp(now)) throw new ProductPersistenceError("PRODUCT_SERVER_TIME_INVALID", 500);
    const products = commands.map((command, index): ProductMutationResult => {
      const reference = references[index], snapshot = snapshots[index];
      if (command.operation === "create" && snapshot.exists) throw new ProductPersistenceError("PRODUCT_CREATE_CONFLICT", 409);
      if (command.operation === "edit" && !snapshot.exists) throw new ProductPersistenceError("PRODUCT_NOT_FOUND", 404);
      if (command.operation === "edit" && !validateProductReference(snapshot.data()).valid) throw new ProductPersistenceError("PRODUCT_EXISTING_REFERENCE_INVALID", 409);
      const audit = command.operation === "create"
        ? { createdAt: now, createdBy: actorUid, updatedAt: now, updatedBy: actorUid }
        : { createdAt: snapshot.data()!.createdAt, createdBy: snapshot.data()!.createdBy, updatedAt: now, updatedBy: actorUid };
      const candidate = removeUndefinedRecursively({
        ...(command.operation === "edit" ? snapshot.data() : {}),
        ...businessFields(command.product), id: reference.id, productId: reference.id,
        isActive: command.product.isActive, active: command.product.isActive, ...audit,
        ...(importAudit ? { importedAt: now, importedBy: actorUid } : {}),
      });
      if (!validateProductReference(candidate).valid) throw new ProductPersistenceError("PRODUCT_REFERENCE_INVALID", 409);
      return { status: command.operation === "create" ? "CREATED" : "UPDATED", product: candidate };
    });
    products.forEach((result, index) => {
      if (commands[index].operation === "create") transaction.create(references[index], result.product);
      else transaction.set(references[index], result.product, { merge: true });
    });
    return { status: "COMPLETED", products };
  });
}
