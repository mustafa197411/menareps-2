import { 
  collection, 
  getDocs, 
  doc, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  writeBatch, 
  query, 
  where 
} from "firebase/firestore";
import { db } from "./firebase";
import { ProductPromotionGroup, Product, Physician } from "../types";
import { handleFirestoreError, OperationType } from "./firebaseError";
import { mutateScopedContent } from "./scopedContentMutationClient";

/**
 * Normalizes a brand name to lowercase, stripped of spaces and punctuation
 * for reliable exact/alias matching.
 */
export function normalizeGroupName(name: string): string {
  if (!name) return "";
  return name.trim().toLowerCase().replace(/[^a-z0-9]/gi, "");
}

/**
 * Fetches all product promotion groups from Firestore.
 */
export async function getProductPromotionGroups(): Promise<ProductPromotionGroup[]> {
  try {
    const colRef = collection(db, "productPromotionGroups");
    const snap = await getDocs(colRef);
    const groups: ProductPromotionGroup[] = [];
    snap.forEach((docSnap) => {
      groups.push({ id: docSnap.id, ...docSnap.data() } as ProductPromotionGroup);
    });
    return groups;
  } catch (error) {
    console.error("Error fetching product promotion groups:", error);
    handleFirestoreError(error as any, OperationType.LIST, "productPromotionGroups");
    return [];
  }
}

/**
 * Saves a Product Promotion Group (creates new or updates existing).
 */
export async function saveProductPromotionGroup(
  group: ProductPromotionGroup, 
  userId: string
): Promise<void> {
  try {
    const now = new Date().toISOString();
    
    const record: Partial<ProductPromotionGroup> = {
      ...group,
      normalizedName: normalizeGroupName(group.name),
      updatedAt: now,
      updatedBy: userId
    };

    if (!group.createdAt) {
      record.createdAt = now;
      record.createdBy = userId;
    }

    // Clean undefined fields
    const cleanRecord = Object.fromEntries(
      Object.entries(record).filter(([, value]) => value !== undefined)
    );

    await mutateScopedContent({ domain: "PROMOTION_GROUP", operation: "UPSERT", id: group.id, payload: cleanRecord });
    console.info(`[ProductPromotionGroups] Saved group ${group.id} (${group.name})`);
  } catch (error) {
    console.error(`Error saving product promotion group ${group.id}:`, error);
    handleFirestoreError(error as any, OperationType.WRITE, `productPromotionGroups/${group.id}`);
    throw error;
  }
}

/**
 * Deletes a product promotion group.
 */
export async function deleteProductPromotionGroup(
  groupId: string, 
  userId: string
): Promise<void> {
  try {
    await mutateScopedContent({ domain: "PROMOTION_GROUP", operation: "DELETE", id: groupId });
    console.info(`[ProductPromotionGroups] Deleted group ${groupId} by user ${userId}`);
  } catch (error) {
    console.error(`Error deleting product promotion group ${groupId}:`, error);
    handleFirestoreError(error as any, OperationType.DELETE, `productPromotionGroups/${groupId}`);
    throw error;
  }
}

export interface DiagnosticMigrationReport {
  timestamp: string;
  runBy: string;
  isSeeded: boolean;
  migratedProductsCount: number;
  migratedPhysiciansCount: number;
  createdGroups: { id: string; name: string }[];
  fallbackMappings: { entityId: string; type: "product" | "physician"; message: string }[];
  integrityStatus: "Healthy" | "Mismatches Detected" | "Issues During Migration";
  errors?: string[];
}

/**
 * Runs automatic database seeding and backward-compatible data migration
 * for the new Product Promotion Group model.
 */
export async function runPromotionGroupsSeedingAndMigration(
  userId: string
): Promise<DiagnosticMigrationReport | null> {
  const timestamp = new Date().toISOString();
  console.info(`[DIAGNOSTIC] [${timestamp}] Starting Promotion Groups Seeding & Migration...`);

  const report: DiagnosticMigrationReport = {
    timestamp,
    runBy: userId || "SYSTEM_INIT",
    isSeeded: false,
    migratedProductsCount: 0,
    migratedPhysiciansCount: 0,
    createdGroups: [],
    fallbackMappings: [],
    integrityStatus: "Healthy",
    errors: []
  };

  try {
    // 1. Fetch current groups
    const groupsCollectionRef = collection(db, "productPromotionGroups");
    const existingGroupsSnap = await getDocs(groupsCollectionRef);
    const existingGroups: ProductPromotionGroup[] = [];
    existingGroupsSnap.forEach((docSnap) => {
      existingGroups.push({ id: docSnap.id, ...docSnap.data() } as ProductPromotionGroup);
    });

    // 2. Fetch all products and physicians for reference
    const productsSnap = await getDocs(collection(db, "products"));
    const dbProducts: Product[] = [];
    productsSnap.forEach((docSnap) => {
      dbProducts.push({ id: docSnap.id, ...docSnap.data() } as Product);
    });

    const physiciansSnap = await getDocs(collection(db, "physicians"));
    const dbPhysicians: Physician[] = [];
    physiciansSnap.forEach((docSnap) => {
      dbPhysicians.push({ id: docSnap.id, ...docSnap.data() } as Physician);
    });

    // Determine if seeding is needed (collection is empty)
    let activeGroups = [...existingGroups];
    const groupMap = new Map<string, ProductPromotionGroup>(); // normalizedName -> group
    activeGroups.forEach(g => groupMap.set(g.normalizedName, g));

    if (existingGroups.length === 0) {
      console.info("[ProductPromotionGroups] Seeding empty promotion groups collection from products...");
      report.isSeeded = true;

      // Extract unique brand references from products
      const legacyBrands = new Set<string>();
      dbProducts.forEach(prod => {
        if (prod.brand && prod.brand.trim()) {
          legacyBrands.add(prod.brand.trim());
        }
      });

      // Also grab from physicians as secondary source
      dbPhysicians.forEach(phys => {
        if (phys.primaryBrand && phys.primaryBrand.trim()) {
          legacyBrands.add(phys.primaryBrand.trim());
        }
        if (phys.targetBrands) {
          phys.targetBrands.forEach(b => {
            if (b && b.trim()) legacyBrands.add(b.trim());
          });
        }
      });

      if (legacyBrands.size === 0) {
        // Fallback standard brands if DB is entirely empty
        ["Lipitor", "Concor", "Januvia", "Ventolin", "Amoxil", "Aspirin"].forEach(b => legacyBrands.add(b));
      }

      // Generate seed groups
      const batch = writeBatch(db);
      legacyBrands.forEach(brandName => {
        const normalizedId = brandName.toLowerCase().replace(/[^a-z0-9]/gi, "");
        const normalizedName = normalizeGroupName(brandName);
        if (!normalizedId) return;

        const seedGroup: ProductPromotionGroup = {
          id: normalizedId,
          name: brandName,
          normalizedName,
          isActive: true,
          createdAt: timestamp,
          createdBy: userId || "SYSTEM_INIT",
          aliases: [brandName.trim().toLowerCase(), normalizedName]
        };

        const docRef = doc(db, "productPromotionGroups", normalizedId);
        batch.set(docRef, seedGroup);
        
        activeGroups.push(seedGroup);
        groupMap.set(normalizedName, seedGroup);
        report.createdGroups.push({ id: normalizedId, name: brandName });
      });

      await batch.commit();
      console.info(`[ProductPromotionGroups] Successfully seeded ${report.createdGroups.length} groups.`);
    }

    // Prepare a helper to resolve a brand string to a ProductPromotionGroup
    const resolveGroup = (brandName: string | undefined): ProductPromotionGroup | null => {
      if (!brandName) return null;
      const normalized = normalizeGroupName(brandName);
      
      // 1. Try direct map check
      if (groupMap.has(normalized)) {
        return groupMap.get(normalized)!;
      }

      // 2. Try alias checks across all active groups
      for (const group of activeGroups) {
        if (group.aliases && group.aliases.some(alias => normalizeGroupName(alias) === normalized)) {
          return group;
        }
        if (normalizeGroupName(group.name) === normalized) {
          return group;
        }
      }

      return null;
    };

    // 3. Migrate Products
    const productBatch = writeBatch(db);
    let productsMigrated = 0;

    dbProducts.forEach(prod => {
      const targetGroup = resolveGroup(prod.brand);
      if (targetGroup) {
        const needsUpdate = prod.promotionGroupId !== targetGroup.id || 
                            prod.promotionGroupName !== targetGroup.name;
        if (needsUpdate) {
          const docRef = doc(db, "products", prod.id);
          productBatch.update(docRef, {
            promotionGroupId: targetGroup.id,
            promotionGroupName: targetGroup.name,
            productFamily: prod.productFamily || "",
            updatedAt: timestamp,
            updatedBy: userId || "SYSTEM_INIT"
          });
          productsMigrated++;
        }
      } else {
        report.fallbackMappings.push({
          entityId: prod.id,
          type: "product",
          message: `Product brand "${prod.brand}" could not be resolved to any Product Promotion Group.`
        });
        report.integrityStatus = "Mismatches Detected";
      }
    });

    if (productsMigrated > 0) {
      await productBatch.commit();
      report.migratedProductsCount = productsMigrated;
      console.info(`[ProductPromotionGroups] Migrated fields for ${productsMigrated} products.`);
    }

    // 4. Migrate Physicians
    const physicianBatch = writeBatch(db);
    let physiciansMigrated = 0;

    dbPhysicians.forEach(phys => {
      let needsUpdate = false;
      const updateData: any = {};

      // Migrate primary brand
      if (phys.primaryBrand) {
        const primaryGroup = resolveGroup(phys.primaryBrand);
        if (primaryGroup) {
          if (phys.primaryPromotionGroupId !== primaryGroup.id || 
              phys.primaryPromotionGroupName !== primaryGroup.name) {
            updateData.primaryPromotionGroupId = primaryGroup.id;
            updateData.primaryPromotionGroupName = primaryGroup.name;
            needsUpdate = true;
          }
        } else {
          report.fallbackMappings.push({
            entityId: phys.id,
            type: "physician",
            message: `Physician's primary brand "${phys.primaryBrand}" did not match any promotion group.`
          });
          report.integrityStatus = "Mismatches Detected";
        }
      }

      // Migrate target brands
      if (phys.targetBrands && Array.isArray(phys.targetBrands) && phys.targetBrands.length > 0) {
        const targetGroupIds: string[] = [];
        const targetGroupNames: string[] = [];

        phys.targetBrands.forEach(bName => {
          const matchedGroup = resolveGroup(bName);
          if (matchedGroup) {
            targetGroupIds.push(matchedGroup.id);
            targetGroupNames.push(matchedGroup.name);
          } else {
            report.fallbackMappings.push({
              entityId: phys.id,
              type: "physician",
              message: `Physician's target brand "${bName}" did not match any promotion group.`
            });
            report.integrityStatus = "Mismatches Detected";
          }
        });

        const idsChanged = JSON.stringify(phys.targetPromotionGroupIds || []) !== JSON.stringify(targetGroupIds);
        const namesChanged = JSON.stringify(phys.targetPromotionGroupNames || []) !== JSON.stringify(targetGroupNames);

        if (idsChanged || namesChanged) {
          updateData.targetPromotionGroupIds = targetGroupIds;
          updateData.targetPromotionGroupNames = targetGroupNames;
          needsUpdate = true;
        }
      }

      if (needsUpdate) {
        const docRef = doc(db, "physicians", phys.id);
        physicianBatch.update(docRef, {
          ...updateData,
          updatedAt: timestamp,
          updatedBy: userId || "SYSTEM_INIT"
        });
        physiciansMigrated++;
      }
    });

    if (physiciansMigrated > 0) {
      await physicianBatch.commit();
      report.migratedPhysiciansCount = physiciansMigrated;
      console.info(`[ProductPromotionGroups] Migrated fields for ${physiciansMigrated} physicians.`);
    }

    // 5. Save the final report in Firestore for persistence/audit
    const reportDocRef = doc(db, "diagnosticReports", "productPromotionGroupsMigration");
    await setDoc(reportDocRef, report);
    console.info("[ProductPromotionGroups] Diagnostic run trace report successfully saved to Firestore.", report);

    return report;
  } catch (error: any) {
    console.error("[ProductPromotionGroups] Seeding/Migration failed:", error);
    report.integrityStatus = "Issues During Migration";
    report.errors = [error?.message || "Unknown error during migration"];
    
    // Save partial error report
    try {
      const reportDocRef = doc(db, "diagnosticReports", "productPromotionGroupsMigration");
      await setDoc(reportDocRef, report);
    } catch (_) {}
    
    return report;
  }
}
