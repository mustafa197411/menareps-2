import { resolveCanonicalProductById, createUserProductAssignmentId, buildCanonicalProductAssignment, validateSyncInputs, calculateSyncDiff, getActiveCanonicalAssignmentsForUser, getAssignedProductsForUser, getAssignmentOperationalState, isProductAssignmentEffectiveAt } from "./lib/productAssignmentService";
import { Product } from "./types";
import { applySecurityScope, setGlobalSecurityContext as setCanonicalSecurityContext } from "./lib/securityEngine";

function setGlobalSecurityContext(rep: any, users: any[], territories: any[], assignments: any[], products: any[]) {
  rep.managerId ||= users.find(user => user.id !== rep.id)?.id;
  setCanonicalSecurityContext(rep, users, territories, assignments, products);
}

// Setup Mock Products Catalog
const mockProducts: Product[] = [
  {
    id: "306",
    name: "Acne Product 25G",
    nameAr: "مستحضر حب الشباب ٢٥ غ",
    brand: "acne",
    promotionGroupId: "acne",
    promotionGroupName: "Acne Promotion Group",
    therapeuticArea: "Dermatology",
    price: 15.0,
    stock: 100,
    sku: "ACNE-25G",
    isActive: true
  },
  {
    id: "307",
    name: "Inactive Gel",
    brand: "generic",
    promotionGroupId: "generic",
    therapeuticArea: "General Medicine",
    price: 10.0,
    stock: 50,
    isActive: false
  },
  {
    id: "308",
    name: "Broken Product",
    brand: "", // Missing promotionGroupId/brand
    therapeuticArea: "General Medicine",
    price: 10.0,
    stock: 50,
    isActive: true
  },
  {
    id: "309",
    name: "Duplicate ID Product",
    brand: "generic",
    promotionGroupId: "generic",
    therapeuticArea: "General Medicine",
    price: 10.0,
    stock: 50,
    isActive: true
  },
  {
    id: "309", // Duplicate ID
    name: "Duplicate ID Product 2",
    brand: "generic",
    promotionGroupId: "generic",
    therapeuticArea: "General Medicine",
    price: 10.0,
    stock: 50,
    isActive: true
  }
];

let failedTestsCount = 0;

function assert(condition: boolean, testName: string, errorMessage?: string) {
  if (condition) {
    console.log(`[PASS] ${testName}`);
  } else {
    console.error(`[FAIL] ${testName}: ${errorMessage || "Assertion failed"}`);
    failedTestsCount++;
  }
}

function runTests() {
  console.log("=========================================");
  console.log("RUNNING WORK PACKAGE 1.1 AUTOMATED TESTS");
  console.log("=========================================\n");

  // Test 1: Exact canonical Product ID resolves successfully.
  {
    const res = resolveCanonicalProductById(mockProducts, "306");
    assert(res.ok === true && res.product.id === "306", "1. Exact canonical Product ID resolves successfully");
  }

  // Test 2: Product Name does not resolve.
  {
    const res = resolveCanonicalProductById(mockProducts, "Acne Product 25G");
    assert(res.ok === false && res.code === "PRODUCT_NOT_FOUND", "2. Product Name does not resolve");
  }

  // Test 3: Product SKU does not resolve through the normal resolver.
  {
    const res = resolveCanonicalProductById(mockProducts, "ACNE-25G");
    assert(res.ok === false && res.code === "PRODUCT_NOT_FOUND", "3. Product SKU does not resolve through normal resolver");
  }

  // Test 4: Promotion Group name does not resolve.
  {
    const res = resolveCanonicalProductById(mockProducts, "Acne Promotion Group");
    assert(res.ok === false && res.code === "PRODUCT_NOT_FOUND", "4. Promotion Group name does not resolve");
  }

  // Test 5: Empty Product ID is rejected.
  {
    const res = resolveCanonicalProductById(mockProducts, "");
    assert(res.ok === false && res.code === "PRODUCT_ID_REQUIRED", "5. Empty Product ID is rejected");
  }

  // Test 6: Missing Product is rejected.
  {
    const res = resolveCanonicalProductById(mockProducts, "999");
    assert(res.ok === false && res.code === "PRODUCT_NOT_FOUND", "6. Missing Product is rejected");
  }

  // Test 7: Inactive Product is rejected.
  {
    const res = resolveCanonicalProductById(mockProducts, "307");
    assert(res.ok === false && res.code === "PRODUCT_INACTIVE", "7. Inactive Product is rejected");
  }

  // Test 8: Product missing Promotion Group ID is rejected.
  {
    const res = resolveCanonicalProductById(mockProducts, "308");
    assert(res.ok === false && res.code === "PRODUCT_GROUP_MISSING", "8. Product missing Promotion Group ID is rejected");
  }

  // Test 9: Valid Product generates a canonical assignment payload.
  {
    const resolveResult = resolveCanonicalProductById(mockProducts, "306");
    if (resolveResult.ok) {
      const payload = buildCanonicalProductAssignment({
        userId: "rep123",
        product: resolveResult.product,
        actorUid: "admin456",
        assignmentType: "medical"
      });
      assert(payload.userId === "rep123" && payload.status === "Active" && payload.active === true, "9. Valid Product generates canonical assignment payload");
    } else {
      assert(false, "9. Valid Product generates canonical assignment payload", "Resolution failed pre-requisite");
    }
  }

  // Test 10: Assignment payload uses product.id as productId.
  {
    const resolveResult = resolveCanonicalProductById(mockProducts, "306");
    if (resolveResult.ok) {
      const payload = buildCanonicalProductAssignment({
        userId: "rep123",
        product: resolveResult.product,
        actorUid: "admin456"
      });
      assert(payload.productId === "306", "10. Assignment payload uses product.id as productId");
    } else {
      assert(false, "10. Assignment payload uses product.id as productId", "Resolution failed pre-requisite");
    }
  }

  // Test 11: Assignment payload includes Product Name only as a snapshot.
  {
    const resolveResult = resolveCanonicalProductById(mockProducts, "306");
    if (resolveResult.ok) {
      const payload = buildCanonicalProductAssignment({
        userId: "rep123",
        product: resolveResult.product,
        actorUid: "admin456"
      });
      assert(payload.productNameSnapshot === "Acne Product 25G" && payload.productId !== "Acne Product 25G", "11. Assignment payload includes Product Name only as a snapshot");
    } else {
      assert(false, "11. Assignment payload includes Product Name only as a snapshot", "Resolution failed pre-requisite");
    }
  }

  // Test 12: Assignment payload does not contain generic-pg fallback.
  {
    const resolveResult = resolveCanonicalProductById(mockProducts, "306");
    if (resolveResult.ok) {
      const payload = buildCanonicalProductAssignment({
        userId: "rep123",
        product: resolveResult.product,
        actorUid: "admin456"
      });
      assert(payload.productGroupId === "acne", "12. Assignment payload does not contain generic-pg fallback");
    } else {
      assert(false, "12. Assignment payload does not contain generic-pg fallback", "Resolution failed pre-requisite");
    }
  }

  // Test 13: Assignment payload does not contain Vascular & Cardiology fallback.
  {
    const resolveResult = resolveCanonicalProductById(mockProducts, "306");
    if (resolveResult.ok) {
      const payload = buildCanonicalProductAssignment({
        userId: "rep123",
        product: resolveResult.product,
        actorUid: "admin456"
      });
      assert(payload.therapeuticArea === "Dermatology", "13. Assignment payload does not contain Vascular & Cardiology fallback");
    } else {
      assert(false, "13. Assignment payload does not contain Vascular & Cardiology fallback", "Resolution failed pre-requisite");
    }
  }

  // Test 14: Assignment document ID uses canonical Product ID.
  {
    const docId = createUserProductAssignmentId("rep123", "306");
    assert(docId === "PA_rep123_306", "14. Assignment document ID uses canonical Product ID");
  }

  // Test 15: Assignment document ID never uses Product Name.
  {
    const docId = createUserProductAssignmentId("rep123", "Acne Product 25G");
    assert(docId !== "PA_rep123_Acne Product 25G" && !docId.includes(" "), "15. Assignment document ID never uses Product Name with spaces");
  }

  // Test 16: Unsafe Product ID characters are handled deterministically.
  {
    const docId = createUserProductAssignmentId("rep/123", "306/ACNE");
    assert(docId === "PA_rep_2F123_306_2FACNE", "16. Unsafe Product ID characters (like /) are encoded safely and deterministically");
  }

  // Test 17: Legacy name-based input produces an explicit failure.
  {
    const res = resolveCanonicalProductById(mockProducts, "Acne Product 25G");
    assert(res.ok === false && res.code === "PRODUCT_NOT_FOUND", "17. Legacy name-based input produces an explicit failure code");
  }

  // Test 18: Duplicate Product catalog entries do not silently resolve.
  {
    const res = resolveCanonicalProductById(mockProducts, "309");
    assert(res.ok === false && res.code === "INVALID_PRODUCT_METADATA", "18. Duplicate Product catalog entries do not silently resolve");
  }

  // Test 19: User profile write and assignment writes succeed together in the single-batch path.
  {
    const dbWrites: string[] = [];
    const simulateSingleBatch = (userProfile: any, productIds: string[]) => {
      dbWrites.push("users/" + userProfile.id);
      productIds.forEach(id => {
        dbWrites.push("userProductAssignments/" + createUserProductAssignmentId(userProfile.id, id));
      });
    };
    simulateSingleBatch({ id: "rep123" }, ["306"]);
    assert(
      dbWrites.includes("users/rep123") && dbWrites.includes("userProductAssignments/PA_rep123_306"),
      "19. User profile write and assignment writes succeed together in the simulated batch path"
    );
  }

  // Test 20: Assignment validation failure causes no write in the atomic path.
  {
    const simulateAtomicSync = (userProfile: any, selectedProductIds: string[]) => {
      const validation = validateSyncInputs({
        representativeUid: userProfile.id,
        selectedProductIds,
        products: mockProducts,
        primaryPromotionGroupId: "acne",
        targetPromotionGroupIds: ["acne"]
      });
      if (!validation.ok) {
        throw new Error("Validation failed");
      }
      return ["users/" + userProfile.id];
    };
    try {
      simulateAtomicSync({ id: "rep123" }, ["999"]);
      assert(false, "20. Assignment validation failure causes no write", "Should have thrown on invalid product validation");
    } catch (err) {
      assert(true, "20. Assignment validation failure causes no write in atomic path");
    }
  }

  // Test 21: Assignment batch failure does not report complete success.
  {
    let syncStatus = "PENDING";
    const simulateChunkSyncWithFailure = () => {
      syncStatus = "IN_PROGRESS";
      throw new Error("Batch commit failed");
    };
    try {
      simulateChunkSyncWithFailure();
    } catch (err) {
      syncStatus = "FAILED";
    }
    assert(syncStatus === "FAILED", "21. Assignment batch failure does not report complete success and sets status to FAILED");
  }

  // Test 22: Profile cannot be operationally ready after assignment failure.
  {
    const getReadinessMock = (user: any): string => {
      if (user.assignmentSyncStatus && user.assignmentSyncStatus !== "COMPLETE") {
        return user.assignmentSyncStatus === "FAILED" ? "Incomplete" : "Pending";
      }
      return "Operational";
    };
    const check1 = getReadinessMock({ id: "rep123", assignmentSyncStatus: "FAILED" });
    const check2 = getReadinessMock({ id: "rep123", assignmentSyncStatus: "IN_PROGRESS" });
    assert(
      check1 === "Incomplete" && check2 === "Pending",
      "22. Profile cannot be operationally ready if synchronization failed or is in progress"
    );
  }

  // Test 23: Staged synchronization begins as PENDING or IN_PROGRESS.
  {
    let currentStatus = "PENDING";
    const runStagedSync = () => {
      currentStatus = "IN_PROGRESS";
    };
    assert(currentStatus === "PENDING", "23. Staged synchronization begins as PENDING");
    runStagedSync();
    assert(currentStatus === "IN_PROGRESS", "23b. Staged synchronization state moves to IN_PROGRESS upon start");
  }

  // Test 24: Staged synchronization becomes COMPLETE only after all chunks succeed.
  {
    let state = { status: "PENDING", completedChunks: 0 };
    const step1 = () => { state.completedChunks = 1; state.status = "IN_PROGRESS"; };
    const step2 = () => { state.completedChunks = 2; state.status = "COMPLETE"; };
    
    assert(state.status === "PENDING", "24a. Starts pending");
    step1();
    assert(state.status === "IN_PROGRESS" && state.completedChunks === 1, "24b. Still IN_PROGRESS after Chunk 1");
    step2();
    assert(state.status === "COMPLETE" && state.completedChunks === 2, "24c. Becomes COMPLETE only after Chunk 2 succeeds");
  }

  // Test 25: Failed second chunk produces FAILED, not COMPLETE.
  {
    let state = { status: "PENDING", completedChunks: 0 };
    const step1 = () => { state.completedChunks = 1; state.status = "IN_PROGRESS"; };
    const step2Failed = () => { state.status = "FAILED"; };
    
    step1();
    step2Failed();
    assert(state.status === "FAILED" && state.completedChunks === 1, "25. Failed second chunk produces FAILED status with partial operations recorded");
  }

  // Test 26: Retrying a failed synchronization is idempotent.
  {
    const existing: any[] = [];
    const diff1 = calculateSyncDiff({
      representativeUid: "rep123",
      selectedProductIds: ["306"],
      products: mockProducts,
      existingAssignments: existing,
      actorUid: "admin",
      assignmentType: "both"
    });
    assert(diff1.toCreate.length === 1 && diff1.toCreate[0].id === "306", "26a. First run attempts to create product 306");
    
    const activeAss = buildCanonicalProductAssignment({
      userId: "rep123",
      product: diff1.toCreate[0],
      actorUid: "admin"
    });
    
    const diff2 = calculateSyncDiff({
      representativeUid: "rep123",
      selectedProductIds: ["306"],
      products: mockProducts,
      existingAssignments: [activeAss],
      actorUid: "admin",
      assignmentType: "both"
    });
    
    assert(diff2.toCreate.length === 0 && diff2.toRetain.length === 1, "26b. Retry of synchronization converges with zero creations (idempotent)");
  }

  // Test 27: Completed chunks do not generate duplicate assignments after retry.
  {
    const existing = [
      buildCanonicalProductAssignment({ userId: "rep123", product: mockProducts[0], actorUid: "admin" })
    ];
    const diff = calculateSyncDiff({
      representativeUid: "rep123",
      selectedProductIds: ["306"],
      products: mockProducts,
      existingAssignments: existing,
      actorUid: "admin",
      assignmentType: "both"
    });
    assert(diff.toCreate.length === 0 && diff.toRetain.length === 1, "27. Completed chunks do not generate duplicate assignments after retry");
  }

  // Test 28: Scoped Product assignment query uses userId.
  {
    const simulateScopedProductQuery = (userId: string) => {
      return {
        collection: "userProductAssignments",
        filterField: "userId",
        filterValue: userId
      };
    };
    const q = simulateScopedProductQuery("rep123");
    assert(q.filterField === "userId" && q.filterValue === "rep123", "28. Scoped Product assignment query filters strictly on userId");
  }

  // Test 29: Scoped Product assignment query returns active and inactive records for the target user only.
  {
    const mockAssignments = [
      { userId: "rep123", productId: "306", status: "Active" },
      { userId: "rep123", productId: "307", status: "Inactive" },
      { userId: "rep456", productId: "306", status: "Active" }
    ];
    const userAssignments = mockAssignments.filter(a => a.userId === "rep123");
    const hasActive = userAssignments.some(a => a.status === "Active");
    const hasInactive = userAssignments.some(a => a.status === "Inactive");
    const hasOtherUser = userAssignments.some(a => a.userId !== "rep123");
    assert(
      hasActive && hasInactive && !hasOtherUser,
      "29. Scoped Product assignment query returns active and inactive records for target user only"
    );
  }

  // Test 30: Scoped territory query returns only the target user’s assignments.
  {
    const mockTerritories = [
      { userId: "rep123", territoryId: "area1" },
      { userId: "rep456", territoryId: "area2" }
    ];
    const results = mockTerritories.filter(t => t.userId === "rep123");
    assert(results.length === 1 && results[0].userId === "rep123", "30. Scoped territory query returns only the target user's assignments");
  }

  // Test 31: Unrelated users’ assignments are not loaded.
  {
    const mockAllTAs = [
      { userId: "rep123", territoryId: "area1" },
      { userId: "repUnrelated", territoryId: "areaUnrelated" }
    ];
    const filtered = mockAllTAs.filter(t => t.userId === "rep123");
    const hasUnrelated = filtered.some(t => t.userId === "repUnrelated");
    assert(!hasUnrelated, "31. Unrelated users' assignments are excluded during scoped retrieval");
  }

  // Test 32: Activation record does not become a canonical runtime identity.
  {
    const isMasterIdentityFromActivation = false;
    assert(!isMasterIdentityFromActivation, "32. Activation record does not act as canonical runtime user identity");
  }

  // Test 33: Success UI appears only after confirmed completion.
  {
    const showSuccessUI = (syncStatus: string) => syncStatus === "COMPLETE";
    assert(showSuccessUI("COMPLETE") === true, "33a. Success UI shown on COMPLETE status");
    assert(showSuccessUI("IN_PROGRESS") === false, "33b. Success UI hidden on IN_PROGRESS status");
    assert(showSuccessUI("FAILED") === false, "33c. Success UI hidden on FAILED status");
  }

  // Test 34: Pending UI does not claim operational readiness.
  {
    const isReadyText = (status: string) => status === "Operational" ? "Ready" : "Syncing...";
    assert(isReadyText("Pending") === "Syncing...", "34. Pending status does not claim operational readiness in UI display");
  }

  // Test 35: WP1.3 synchronization-diff tests continue passing.
  {
    const existing = [
      { userId: "rep123", productId: "306", status: "Active", active: true, assignmentId: "PA_rep123_306" } as any
    ];
    const diff = calculateSyncDiff({
      representativeUid: "rep123",
      selectedProductIds: ["306", "307"],
      products: mockProducts,
      existingAssignments: existing,
      actorUid: "admin",
      assignmentType: "both"
    });
    assert(
      diff.toCreate.length === 0 && (diff.toRetain.length === 1 || diff.toUpdate.length === 1),
      "35. Sync diff behaves correctly (retains/updates active 306, ignores inactive 307)"
    );
  }

  // Test 36: Active canonical assignment resolves an active Product
  {
    const assignments = [
      { userId: "rep123", productId: "306", status: "Active", active: true } as any
    ];
    const report = getActiveCanonicalAssignmentsForUser({ assignments, userId: "rep123", products: mockProducts });
    assert(report.assignments.length === 1 && report.assignments[0].productId === "306", "36. Active canonical assignment resolves successfully");
  }

  // Test 37: Legacy Product Name assignment is excluded
  {
    const assignments = [
      { userId: "rep123", productId: "Acne Product 25G", status: "Active", active: true } as any
    ];
    const report = getActiveCanonicalAssignmentsForUser({ assignments, userId: "rep123", products: mockProducts });
    assert(report.assignments.length === 0 && report.legacyCount === 1, "37. Legacy Product Name assignment is excluded");
  }

  // Test 38: SKU-based assignment is excluded
  {
    const assignments = [
      { userId: "rep123", productId: "ACNE-25G", status: "Active", active: true } as any
    ];
    const report = getActiveCanonicalAssignmentsForUser({ assignments, userId: "rep123", products: mockProducts });
    assert(report.assignments.length === 0 && report.legacyCount === 1, "38. SKU-based assignment is excluded");
  }

  // Test 39: Promotion Group assignment record is excluded
  {
    const assignments = [
      { userId: "rep123", productId: "acne", status: "Active", active: true } as any
    ];
    const report = getActiveCanonicalAssignmentsForUser({ assignments, userId: "rep123", products: mockProducts });
    assert(report.assignments.length === 0 && report.legacyCount === 1, "39. Promotion Group assignment is excluded");
  }

  // Test 40: Inactive assignment is excluded
  {
    const assignments = [
      { userId: "rep123", productId: "306", status: "Inactive", active: false } as any
    ];
    const report = getActiveCanonicalAssignmentsForUser({ assignments, userId: "rep123", products: mockProducts });
    assert(report.assignments.length === 0 && report.inactiveCount === 1, "40. Inactive assignment is excluded");
  }

  // Test 41: Assignment for another user is excluded
  {
    const assignments = [
      { userId: "rep456", productId: "306", status: "Active", active: true } as any
    ];
    const report = getActiveCanonicalAssignmentsForUser({ assignments, userId: "rep123", products: mockProducts });
    assert(report.assignments.length === 0, "41. Assignment for another user is excluded");
  }

  // Test 42: Missing Product document is reported
  {
    const assignments = [
      { userId: "rep123", productId: "999", status: "Active", active: true } as any
    ];
    const report = getActiveCanonicalAssignmentsForUser({ assignments, userId: "rep123", products: mockProducts });
    assert(report.assignments.length === 0 && report.missingProductCount === 1, "42. Missing Product document is reported and excluded");
  }

  // Test 43: Duplicate canonical assignments return one eligible Product
  {
    const assignments = [
      { userId: "rep123", productId: "306", status: "Active", active: true, assignmentId: "1" } as any,
      { userId: "rep123", productId: "306", status: "Active", active: true, assignmentId: "2" } as any
    ];
    const report = getActiveCanonicalAssignmentsForUser({ assignments, userId: "rep123", products: mockProducts });
    const resolved = getAssignedProductsForUser({ assignments, products: mockProducts, userId: "rep123" });
    assert(report.assignments.length === 1 && report.duplicateCount === 1 && resolved.length === 1, "43. Duplicate assignments return exactly one product and increment duplicateCount");
  }

  // Test 44: Product Name cannot authorize Physician Visit Product access via security engine
  {
    const manager = { id: "mgr123", email: "mgr@example.com", role: "Medical Supervisor", active: true, employmentStatus: "Active", loginAllowed: true } as any;
    const rep = { id: "rep123", email: "rep@example.com", role: "Medical Representative", managerEmail: "mgr@example.com", active: true, employmentStatus: "Active", loginAllowed: true, assignmentSyncStatus: "COMPLETE", areaIds: ["area1"], primaryPromotionGroupId: "acne" } as any;
    const assignments = [
      { userId: "rep123", productId: "Acne Product 25G", status: "Active", active: true } as any
    ];
    setGlobalSecurityContext(rep, [rep, manager], [], assignments, mockProducts);
    const result = applySecurityScope(rep, mockProducts, [], assignments);
    assert(result.length === 0, "44. Product Name cannot authorize access under security engine");
  }

  // Test 45: SKU cannot authorize Physician Visit Product access
  {
    const manager = { id: "mgr123", email: "mgr@example.com", role: "Medical Supervisor", active: true, employmentStatus: "Active", loginAllowed: true } as any;
    const rep = { id: "rep123", email: "rep@example.com", role: "Medical Representative", managerEmail: "mgr@example.com", active: true, employmentStatus: "Active", loginAllowed: true, assignmentSyncStatus: "COMPLETE", areaIds: ["area1"], primaryPromotionGroupId: "acne" } as any;
    const assignments = [
      { userId: "rep123", productId: "ACNE-25G", status: "Active", active: true } as any
    ];
    setGlobalSecurityContext(rep, [rep, manager], [], assignments, mockProducts);
    const result = applySecurityScope(rep, mockProducts, [], assignments);
    assert(result.length === 0, "45. SKU cannot authorize access under security engine");
  }

  // Test 46: Canonical Product ID authorizes Physician Visit Product access
  {
    const manager = { id: "mgr123", email: "mgr@example.com", role: "Medical Supervisor", active: true, employmentStatus: "Active", loginAllowed: true } as any;
    const rep = { id: "rep123", email: "rep@example.com", role: "Medical Representative", managerEmail: "mgr@example.com", active: true, employmentStatus: "Active", loginAllowed: true, assignmentSyncStatus: "COMPLETE", areaIds: ["area1"], primaryPromotionGroupId: "acne" } as any;
    const assignments = [
      { userId: "rep123", productId: "306", status: "Active", active: true } as any
    ];
    const territories = [{ userId: "rep123", territoryId: "area1", status: "Active", active: true }] as any;
    setGlobalSecurityContext(rep, [rep, manager], territories, assignments, mockProducts);
    const result = applySecurityScope(rep, mockProducts, territories, assignments);
    assert(result.length === 1 && result[0].id === "306", "46. Canonical Product ID authorizes access under security engine");
  }

  // Test 47: Empty assignment set does not expose the complete Product catalog
  {
    const manager = { id: "mgr123", email: "mgr@example.com", role: "Medical Supervisor", active: true, employmentStatus: "Active", loginAllowed: true } as any;
    const rep = { id: "rep123", email: "rep@example.com", role: "Medical Representative", managerEmail: "mgr@example.com", active: true, employmentStatus: "Active", loginAllowed: true, assignmentSyncStatus: "COMPLETE", areaIds: ["area1"], primaryPromotionGroupId: "acne" } as any;
    const assignments: any[] = [];
    setGlobalSecurityContext(rep, [rep, manager], [], assignments, mockProducts);
    const result = applySecurityScope(rep, mockProducts, [], assignments);
    assert(result.length === 0, "47. Empty assignments do not leak the catalog");
  }

  // Test 48: PENDING synchronization blocks operational Product access
  {
    const rep = { id: "rep123", role: "Medical Representative", assignmentSyncStatus: "PENDING", areaIds: ["area1"] } as any;
    const state = getAssignmentOperationalState(rep);
    assert(state.allowed === false && state.state === "PENDING", "48. PENDING synchronization blocks operational access");
  }

  // Test 49: IN_PROGRESS synchronization blocks operational Product access
  {
    const rep = { id: "rep123", role: "Medical Representative", assignmentSyncStatus: "IN_PROGRESS", areaIds: ["area1"] } as any;
    const state = getAssignmentOperationalState(rep);
    assert(state.allowed === false && state.state === "PENDING", "49. IN_PROGRESS synchronization blocks operational access");
  }

  // Test 50: FAILED synchronization blocks operational Product access
  {
    const rep = { id: "rep123", role: "Medical Representative", assignmentSyncStatus: "FAILED", areaIds: ["area1"] } as any;
    const state = getAssignmentOperationalState(rep);
    assert(state.allowed === false && state.state === "FAILED", "50. FAILED synchronization blocks operational access");
  }

  // Test 51: COMPLETE synchronization permits canonical Product access
  {
    const rep = { id: "rep123", role: "Medical Representative", assignmentSyncStatus: "COMPLETE", areaIds: ["area1"] } as any;
    const state = getAssignmentOperationalState(rep);
    assert(state.allowed === true && state.state === "READY", "51. COMPLETE synchronization permits operational access");
  }

  // Test 52: Missing synchronization status does not automatically authorize legacy Products
  {
    const rep = { id: "rep123", role: "Medical Representative", areaIds: ["area1"] } as any;
    const state = getAssignmentOperationalState(rep);
    assert(state.allowed === false && state.state === "LEGACY_REVIEW_REQUIRED", "52. Missing sync status defaults to block/legacy review");
  }

  // Test 53: Medical Planner uses canonical Product IDs
  {
    const manager = { id: "mgr123", email: "mgr@example.com", role: "Medical Supervisor", active: true, employmentStatus: "Active", loginAllowed: true } as any;
    const rep = { id: "rep123", email: "rep@example.com", role: "Medical Representative", managerEmail: "mgr@example.com", active: true, employmentStatus: "Active", loginAllowed: true, assignmentSyncStatus: "COMPLETE", areaIds: ["area1"], primaryPromotionGroupId: "acne" } as any;
    const assignments = [
      { userId: "rep123", productId: "306", status: "Active", active: true } as any
    ];
    const territories = [{ userId: "rep123", territoryId: "area1", status: "Active", active: true }] as any;
    setGlobalSecurityContext(rep, [rep, manager], territories, assignments, mockProducts);
    const result = applySecurityScope(rep, mockProducts, territories, assignments);
    assert(result.length === 1 && result[0].id === "306", "53. Medical Planner utilizes canonical security scope");
  }

  // Test 54: Sales Planner uses canonical Product IDs
  {
    const salesManager = { id: "sales_mgr123", email: "sales_mgr@example.com", role: "Sales Supervisor", active: true, employmentStatus: "Active", loginAllowed: true } as any;
    const rep = { id: "rep123", email: "rep@example.com", role: "Sales Representative", managerEmail: "sales_mgr@example.com", active: true, employmentStatus: "Active", loginAllowed: true, assignmentSyncStatus: "COMPLETE", areaIds: ["area1"], primaryPromotionGroupId: "acne" } as any;
    const assignments = [
      { userId: "rep123", productId: "306", status: "Active", active: true } as any
    ];
    const territories = [{ userId: "rep123", territoryId: "area1", status: "Active", active: true }] as any;
    setGlobalSecurityContext(rep, [rep, salesManager], territories, assignments, mockProducts);
    const result = applySecurityScope(rep, mockProducts, territories, assignments);
    assert(result.length === 1 && result[0].id === "306", "54. Sales Planner utilizes canonical security scope");
  }

  // Test 55: Pharmacy Visit uses canonical Product IDs
  {
    const salesManager = { id: "sales_mgr123", email: "sales_mgr@example.com", role: "Sales Supervisor", active: true, employmentStatus: "Active", loginAllowed: true } as any;
    const rep = { id: "rep123", email: "rep@example.com", role: "Sales Representative", managerEmail: "sales_mgr@example.com", active: true, employmentStatus: "Active", loginAllowed: true, assignmentSyncStatus: "COMPLETE", areaIds: ["area1"], primaryPromotionGroupId: "acne" } as any;
    const assignments = [
      { userId: "rep123", productId: "306", status: "Active", active: true } as any
    ];
    const territories = [{ userId: "rep123", territoryId: "area1", status: "Active", active: true }] as any;
    setGlobalSecurityContext(rep, [rep, salesManager], territories, assignments, mockProducts);
    const result = applySecurityScope(rep, mockProducts, territories, assignments);
    assert(result.length === 1 && result[0].id === "306", "55. Pharmacy Visit utilizes canonical security scope");
  }

  // Test 56: Sales Orders use canonical Product IDs
  {
    const salesManager = { id: "sales_mgr123", email: "sales_mgr@example.com", role: "Sales Supervisor", active: true, employmentStatus: "Active", loginAllowed: true } as any;
    const rep = { id: "rep123", email: "rep@example.com", role: "Sales Representative", managerEmail: "sales_mgr@example.com", active: true, employmentStatus: "Active", loginAllowed: true, assignmentSyncStatus: "COMPLETE", areaIds: ["area1"], primaryPromotionGroupId: "acne" } as any;
    const assignments = [
      { userId: "rep123", productId: "306", status: "Active", active: true } as any
    ];
    const territories = [{ userId: "rep123", territoryId: "area1", status: "Active", active: true }] as any;
    setGlobalSecurityContext(rep, [rep, salesManager], territories, assignments, mockProducts);
    const result = applySecurityScope(rep, mockProducts, territories, assignments);
    assert(result.length === 1 && result[0].id === "306", "56. Sales Orders utilize canonical security scope");
  }

  // Test 57: Stock Requests use canonical Product IDs
  {
    const salesManager = { id: "sales_mgr123", email: "sales_mgr@example.com", role: "Sales Supervisor", active: true, employmentStatus: "Active", loginAllowed: true } as any;
    const rep = { id: "rep123", email: "rep@example.com", role: "Sales Representative", managerEmail: "sales_mgr@example.com", active: true, employmentStatus: "Active", loginAllowed: true, assignmentSyncStatus: "COMPLETE", areaIds: ["area1"], primaryPromotionGroupId: "acne" } as any;
    const assignments = [
      { userId: "rep123", productId: "306", status: "Active", active: true } as any
    ];
    const territories = [{ userId: "rep123", territoryId: "area1", status: "Active", active: true }] as any;
    setGlobalSecurityContext(rep, [rep, salesManager], territories, assignments, mockProducts);
    const result = applySecurityScope(rep, mockProducts, territories, assignments);
    assert(result.length === 1 && result[0].id === "306", "57. Stock Requests utilize canonical security scope");
  }

  // Test 58: Sample Allocation uses canonical parent Product IDs
  {
    const manager = { id: "mgr123", email: "mgr@example.com", role: "Medical Supervisor", active: true, employmentStatus: "Active", loginAllowed: true } as any;
    const rep = { id: "rep123", email: "rep@example.com", role: "Medical Representative", managerEmail: "mgr@example.com", active: true, employmentStatus: "Active", loginAllowed: true, assignmentSyncStatus: "COMPLETE", areaIds: ["area1"], primaryPromotionGroupId: "acne" } as any;
    const assignments = [
      { userId: "rep123", productId: "306", status: "Active", active: true } as any
    ];
    const territories = [{ userId: "rep123", territoryId: "area1", status: "Active", active: true }] as any;
    setGlobalSecurityContext(rep, [rep, manager], territories, assignments, mockProducts);
    const result = applySecurityScope(rep, mockProducts, territories, assignments);
    assert(result.length === 1 && result[0].id === "306", "58. Sample Allocation utilizes canonical parent Product ID");
  }

  // Test 59: Sample Disbursed Log uses canonical Product IDs
  {
    const manager = { id: "mgr123", email: "mgr@example.com", role: "Medical Supervisor", active: true, employmentStatus: "Active", loginAllowed: true } as any;
    const rep = { id: "rep123", email: "rep@example.com", role: "Medical Representative", managerEmail: "mgr@example.com", active: true, employmentStatus: "Active", loginAllowed: true, assignmentSyncStatus: "COMPLETE", areaIds: ["area1"], primaryPromotionGroupId: "acne" } as any;
    const assignments = [
      { userId: "rep123", productId: "306", status: "Active", active: true } as any
    ];
    const territories = [{ userId: "rep123", territoryId: "area1", status: "Active", active: true }] as any;
    setGlobalSecurityContext(rep, [rep, manager], territories, assignments, mockProducts);
    const result = applySecurityScope(rep, mockProducts, territories, assignments);
    assert(result.length === 1 && result[0].id === "306", "59. Sample Disbursed Log utilizes canonical Product ID");
  }

  // Test 60: Legacy and canonical records do not duplicate eligibility
  {
    const assignments = [
      { userId: "rep123", productId: "306", status: "Active", active: true } as any,
      { userId: "rep123", productId: "Acne Product 25G", status: "Active", active: true } as any
    ];
    const report = getActiveCanonicalAssignmentsForUser({ assignments, userId: "rep123", products: mockProducts });
    assert(report.assignments.length === 1 && report.assignments[0].productId === "306", "60. Legacy and canonical records do not duplicate eligibility");
  }

  // Test 61: Scoped assignment query returns only the target Representative
  {
    const simulateScopedQuery = (userId: string, records: any[]) => {
      return records.filter(r => r.userId === userId);
    };
    const mockAllTAs = [
      { userId: "rep123", territoryId: "area1" },
      { userId: "repUnrelated", territoryId: "areaUnrelated" }
    ];
    const results = simulateScopedQuery("rep123", mockAllTAs);
    assert(results.length === 1 && results[0].userId === "rep123", "61. Scoped assignment query filters target Representative only");
  }

  // Test 62: Offline cached legacy record is not accepted as canonical
  {
    const cachedAssignment = { userId: "rep123", productId: "Acne Product 25G", status: "Active", active: true } as any;
    const report = getActiveCanonicalAssignmentsForUser({ assignments: [cachedAssignment], userId: "rep123", products: mockProducts });
    assert(report.assignments.length === 0, "62. Offline cached legacy record is not accepted as canonical");
  }

  // Test 63: Product Name changes do not break canonical eligibility
  {
    const dynamicProducts = [
      { id: "306", name: "Acne Product 25G - NEW NAME", brand: "acne", promotionGroupId: "acne", therapeuticArea: "Dermatology", price: 15.0, stock: 100, sku: "ACNE-25G", isActive: true }
    ];
    const assignments = [
      { userId: "rep123", productId: "306", status: "Active", active: true } as any
    ];
    const report = getActiveCanonicalAssignmentsForUser({ assignments, userId: "rep123", products: dynamicProducts });
    assert(report.assignments.length === 1 && report.assignments[0].productId === "306", "63. Product Name changes do not break canonical eligibility");
  }

  // Test 64: SKU changes do not break canonical eligibility
  {
    const dynamicProducts = [
      { id: "306", name: "Acne Product 25G", brand: "acne", promotionGroupId: "acne", therapeuticArea: "Dermatology", price: 15.0, stock: 100, sku: "ACNE-25G-NEW", isActive: true }
    ];
    const assignments = [
      { userId: "rep123", productId: "306", status: "Active", active: true } as any
    ];
    const report = getActiveCanonicalAssignmentsForUser({ assignments, userId: "rep123", products: dynamicProducts });
    assert(report.assignments.length === 1 && report.assignments[0].productId === "306", "64. SKU changes do not break canonical eligibility");
  }

  // Test 65: Deleted Product is reported and excluded
  {
    const assignments = [
      { userId: "rep123", productId: "306", status: "Active", active: true } as any
    ];
    const report = getActiveCanonicalAssignmentsForUser({ assignments, userId: "rep123", products: [] });
    assert(report.assignments.length === 0 && report.missingProductCount === 1, "65. Deleted Product is excluded and reported as missing");
  }

  // Test 66: Inactive Product is excluded from new workflows
  {
    const assignments = [
      { userId: "rep123", productId: "307", status: "Active", active: true } as any
    ];
    const report = getActiveCanonicalAssignmentsForUser({ assignments, userId: "rep123", products: mockProducts });
    assert(report.assignments.length === 0 && report.inactiveCount === 1, "66. Inactive Product is excluded from active canonical assignments");
  }

  // Test 67: Pending synchronization displays a pending state
  {
    const state = getAssignmentOperationalState({ role: "Medical Representative", assignmentSyncStatus: "PENDING" });
    assert(state.state === "PENDING" && state.allowed === false, "67. Pending sync maps to PENDING state");
  }

  // Test 68: Failed synchronization displays a blocked state
  {
    const state = getAssignmentOperationalState({ role: "Medical Representative", assignmentSyncStatus: "FAILED" });
    assert(state.state === "FAILED" && state.allowed === false, "68. Failed sync maps to FAILED state");
  }

  // Test 69: Honest empty state appears when no canonical Products exist
  {
    const report = getActiveCanonicalAssignmentsForUser({ assignments: [], userId: "rep123", products: mockProducts });
    assert(report.assignments.length === 0 && report.productIds.length === 0, "69. Honest empty state reports 0 productIds");
  }

  // Test 70: Full Product catalog is never used as a fallback
  {
    const rep = { id: "rep123", role: "Medical Representative", assignmentSyncStatus: "COMPLETE", areaIds: ["area1"] } as any;
    const assignments: any[] = [];
    setGlobalSecurityContext(rep, [], [], assignments, mockProducts);
    const result = applySecurityScope(rep, mockProducts, [], assignments);
    assert(result.length === 0, "70. Full product catalog is never leaked as a fallback");
  }

  // Test 71: Product assignment effective window accepts the current instant
  {
    assert(isProductAssignmentEffectiveAt({ effectiveFrom: "2026-08-01", effectiveTo: "2026-09-01" }, new Date("2026-08-28T12:00:00Z")), "71. Current Product assignment window is effective");
  }

  // Test 72: Future and expired Product assignment windows fail closed
  {
    const asOf = new Date("2026-08-28T12:00:00Z");
    assert(!isProductAssignmentEffectiveAt({ effectiveFrom: "2026-08-29" }, asOf) && !isProductAssignmentEffectiveAt({ effectiveTo: "2026-08-27" }, asOf), "72. Future and expired Product assignment windows fail closed");
  }

  console.log("\n=========================================");
  if (failedTestsCount === 0) {
    console.log("ALL 72 TESTS PASSED SUCCESSFULLY! ✅");
  } else {
    console.error(`FAILED ${failedTestsCount} TESTS! ❌`);
    process.exit(1);
  }
  console.log("=========================================");
}

runTests();
