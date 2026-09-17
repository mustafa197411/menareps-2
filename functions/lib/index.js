"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFinanceApprovalAnalytics = exports.getInventoryAnalytics = exports.getSampleAnalytics = exports.getSalesVisitQualityAnalytics = exports.getVisitQualityAnalytics = exports.getTerritorySynergyAnalytics = exports.getRepPerformanceAnalytics = exports.getAnalyticsTrend = exports.getVisitedCustomersAnalytics = exports.getUnvisitedCustomersAnalytics = exports.getProductPerformanceAnalytics = exports.getAnalyticsSummary = exports.logCollectionAudit = exports.validateCommercialOrder = exports.syncAuthUserToProfile = void 0;
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const analyticsScopeEngine_1 = require("./analyticsScopeEngine");
if (admin.apps.length === 0) {
    admin.initializeApp();
}
const db = admin.firestore();
/**
 * =========================================================================
 * EXISTING CLOUD TRIGGERS & VALIDATORS (Preserved perfectly)
 * =========================================================================
 */
/**
 * 1. Safe Auth Registration Sync Function
 */
exports.syncAuthUserToProfile = functions.auth.user().onCreate(async (user) => {
    const { uid, email, displayName } = user;
    functions.logger.info(`[Auth Sync] Syncing new authenticated user: ${uid} (${email})`);
    const userDocRef = db.collection("users").doc(uid);
    const userSnapshot = await userDocRef.get();
    if (userSnapshot.exists) {
        functions.logger.info(`[Auth Sync] Profile document already exists for user ${uid}. Skipping.`);
        return null;
    }
    const timestamp = new Date().toISOString().replace("T", " ").substring(0, 19) + " UTC";
    const defaultProfile = {
        id: uid,
        name: displayName || email?.split("@")[0] || "Operator",
        email: email || "",
        role: "Medical Representative",
        region: "Amman",
        territory: "Amman-West",
        active: true,
        joinedDate: new Date().toLocaleDateString(),
        companyId: "MENAREPS-CENTRAL",
        createdAt: timestamp,
        createdBy: "SYSTEM-AUTH",
        updatedAt: timestamp,
        updatedBy: "SYSTEM-AUTH",
        status: "Active",
        isDeleted: false,
        sidebarVisibility: ["dashboard", "physicians", "pharmacies", "products"]
    };
    try {
        await userDocRef.set(defaultProfile);
        functions.logger.info(`[Auth Sync] Successfully initialized profile document for user ${uid}`);
    }
    catch (error) {
        functions.logger.error(`[Auth Sync Error] Failed to create profile document for ${uid}:`, error);
    }
    return null;
});
/**
 * 2. Enterprise Commercial Order Validation Helper
 */
exports.validateCommercialOrder = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "The function must be called by an authenticated operator.");
    }
    const { orderId, clientId, items, discountApplied, totalAmount } = data;
    functions.logger.info(`[Order Validation] Processing order #${orderId} for client ${clientId}`);
    try {
        const clientSnap = await db.collection("pharmacies").doc(clientId).get();
        if (!clientSnap.exists) {
            throw new functions.https.HttpsError("not-found", "The specified Pharmacy/Client does not exist.");
        }
        const clientData = clientSnap.data();
        const creditLimit = clientData?.creditLimit || 5000;
        const outstandingBalance = clientData?.outstandingBalance || 0;
        let calculatedSubtotal = 0;
        for (const item of items) {
            const productSnap = await db.collection("products").doc(item.productId).get();
            if (productSnap.exists) {
                const productPrice = productSnap.data()?.price || 0;
                calculatedSubtotal += productPrice * item.quantity;
            }
        }
        const calculatedTotal = calculatedSubtotal - (discountApplied || 0);
        const passesCalculation = Math.abs(calculatedTotal - totalAmount) < 0.01;
        const totalExposure = outstandingBalance + calculatedTotal;
        const creditApproved = totalExposure <= creditLimit;
        functions.logger.info(`[Order Validation Results] Calculated: ${calculatedTotal}, Client credit limit: ${creditLimit}, Approved: ${creditApproved}`);
        return {
            isValid: passesCalculation,
            calculatedTotal,
            creditApproved,
            creditLimit,
            outstandingBalance,
            message: creditApproved
                ? "Order calculations and credit check passed successfully."
                : "Warning: Order value exceeds the client's allocated credit limit."
        };
    }
    catch (err) {
        functions.logger.error("[Order Validation Error]", err);
        throw new functions.https.HttpsError("internal", err.message || "Order validation failed.");
    }
});
/**
 * 3. Secure Audit Ledger Trigger
 */
exports.logCollectionAudit = functions.firestore
    .document("{collectionId}/{documentId}")
    .onCreate(async (snap, context) => {
    const { collectionId, documentId } = context.params;
    if (collectionId === "auditLogs" || collectionId === "notifications") {
        return null;
    }
    const data = snap.data();
    const timestamp = new Date().toISOString().replace("T", " ").substring(0, 19) + " UTC";
    const auditId = `AL-SYS-${Math.floor(100000 + Math.random() * 900000)}`;
    const systemAudit = {
        id: auditId,
        timestamp,
        userId: data.updatedBy || "SYSTEM-DB",
        userName: "Automatic Database Audit",
        action: "Create",
        entityName: collectionId,
        details: `Record ${documentId} added in database under collection '${collectionId}'`,
        companyId: data.companyId || "MENAREPS-CENTRAL",
        status: "Active",
        isDeleted: false
    };
    try {
        await db.collection("auditLogs").doc(auditId).set(systemAudit);
        functions.logger.info(`[Audit Trigger] Auto-audited record write for ${collectionId}/${documentId}`);
    }
    catch (error) {
        functions.logger.error("[Audit Trigger Error] Failed to write system audit log:", error);
    }
    return null;
});
/**
 * =========================================================================
 * FIRESTORE GENERAL DATA RETRIEVAL HANDLER
 * =========================================================================
 */
async function getCollectionArray(collectionName) {
    const snap = await db.collection(collectionName).get();
    const list = [];
    snap.forEach((doc) => {
        const data = doc.data();
        data.id = doc.id;
        list.push(data);
    });
    return list;
}
/**
 * =========================================================================
 * 12 SECURED ANALYTICS CALLABLE ENDPOINTS (Applying Scope Engine)
 * =========================================================================
 */
// Authenticates caller and resolves their custom security scope
async function enforceAuthAndResolveScope(context) {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Action denied. The user must be authenticated.");
    }
    try {
        return await (0, analyticsScopeEngine_1.resolveSecuredAnalyticsScope)(context.auth.uid, db);
    }
    catch (error) {
        throw new functions.https.HttpsError("internal", error.message || "Failed resolving security parameters.");
    }
}
/**
 * Endpoint 1: Summary Analytics
 */
exports.getAnalyticsSummary = functions.https.onCall(async (data, context) => {
    const { scope } = await enforceAuthAndResolveScope(context);
    const filters = data.filters || {};
    const physicianVisits = await getCollectionArray("physicianVisits");
    const pharmacyVisits = await getCollectionArray("pharmacyVisits");
    const orders = await getCollectionArray("orders");
    // Filter records
    const filteredPhysicianVisits = physicianVisits.filter(v => (0, analyticsScopeEngine_1.filterRecordByScopeAndFilters)(v, scope, filters));
    const filteredPharmacyVisits = pharmacyVisits.filter(v => (0, analyticsScopeEngine_1.filterRecordByScopeAndFilters)(v, scope, filters));
    const filteredOrders = orders.filter(o => (0, analyticsScopeEngine_1.filterRecordByScopeAndFilters)(o, scope, filters));
    const totalVisits = filteredPhysicianVisits.length + filteredPharmacyVisits.length;
    const totalSales = filteredOrders.reduce((acc, o) => acc + (o.totalAmount || 0), 0);
    // Calculate doctor response rating ratio (Positive reaction visits)
    const highReactionVisits = filteredPhysicianVisits.filter(v => v.feedback === "Positive" || v.reactionScore >= 8);
    const engagementRatio = filteredPhysicianVisits.length > 0
        ? (highReactionVisits.length / filteredPhysicianVisits.length) * 100
        : 0;
    const chartData = [
        { label: "Medical Visits", count: filteredPhysicianVisits.length },
        { label: "Pharmacy Visits", count: filteredPharmacyVisits.length },
        { label: "Outstanding Invoices", count: filteredOrders.filter(o => o.status === "Pending").length }
    ];
    return {
        items: [],
        totals: totalVisits,
        summary: {
            totalVisits,
            medicalVisits: filteredPhysicianVisits.length,
            pharmacyVisits: filteredPharmacyVisits.length,
            totalSalesAmount: totalSales,
            doctorEngagementRatio: parseFloat(engagementRatio.toFixed(1))
        },
        chartData,
        pagination: { page: 1, pageSize: 1, totalCount: 0, totalPages: 0 }
    };
});
/**
 * Endpoint 2: Product Performance Analytics
 */
exports.getProductPerformanceAnalytics = functions.https.onCall(async (data, context) => {
    const { scope } = await enforceAuthAndResolveScope(context);
    const filters = data.filters || {};
    const page = data.page || 1;
    const pageSize = data.pageSize || 10;
    const products = await getCollectionArray("products");
    const physicianVisits = await getCollectionArray("physicianVisits");
    const orders = await getCollectionArray("orders");
    const performanceItems = products.map(product => {
        // Count visits where this product was detailed
        const detailingVisits = physicianVisits.filter(v => {
            const isDetailed = v.productId === product.id || v.detailedProducts?.includes(product.id);
            return isDetailed && (0, analyticsScopeEngine_1.filterRecordByScopeAndFilters)(v, scope, filters);
        });
        // Sum sales units from orders
        let unitsSold = 0;
        let revenue = 0;
        orders.forEach(order => {
            if ((0, analyticsScopeEngine_1.filterRecordByScopeAndFilters)(order, scope, filters) && order.items) {
                order.items.forEach((item) => {
                    if (item.productId === product.id) {
                        unitsSold += (item.quantity || 0);
                        revenue += (item.quantity || 0) * (product.price || 1);
                    }
                });
            }
        });
        return {
            productId: product.id,
            name: product.name,
            brand: product.brand || "Generics",
            detailingCount: detailingVisits.length,
            unitsSold,
            revenue
        };
    });
    const chartData = performanceItems.slice(0, 5).map(i => ({
        label: i.name,
        detailing: i.detailingCount,
        revenue: i.revenue
    }));
    const paginated = (0, analyticsScopeEngine_1.paginateResults)(performanceItems, page, pageSize);
    return {
        items: paginated.items,
        totals: paginated.pagination.totalCount,
        summary: {
            totalProductsTracked: products.length,
            topProductByRevenue: performanceItems.reduce((max, i) => i.revenue > (max?.revenue || 0) ? i : max, performanceItems[0])?.name || "N/A"
        },
        chartData,
        pagination: paginated.pagination
    };
});
/**
 * Endpoint 3: Unvisited Customers Analytics
 */
exports.getUnvisitedCustomersAnalytics = functions.https.onCall(async (data, context) => {
    const { scope } = await enforceAuthAndResolveScope(context);
    const filters = data.filters || {};
    const page = data.page || 1;
    const pageSize = data.pageSize || 10;
    const physicians = await getCollectionArray("physicians");
    const pharmacies = await getCollectionArray("pharmacies");
    const unvisitedPhysicians = physicians.filter(p => {
        const noVisit = !p.lastVisitDate || p.lastVisitStatus === "Cancelled" || p.lastVisitStatus === "Pending";
        return noVisit && (0, analyticsScopeEngine_1.filterRecordByScopeAndFilters)(p, scope, filters);
    });
    const unvisitedPharmacies = pharmacies.filter(p => {
        const noVisit = !p.lastVisitDate || p.lastVisitStatus === "Cancelled";
        return noVisit && (0, analyticsScopeEngine_1.filterRecordByScopeAndFilters)(p, scope, filters);
    });
    const combinedItems = [
        ...unvisitedPhysicians.map(p => ({ id: p.id, name: p.name, type: "Physician", specialty: p.specialty || "GP", territory: p.territory })),
        ...unvisitedPharmacies.map(p => ({ id: p.id, name: p.name, type: "Pharmacy", specialty: "Commercial Pharmacy", territory: p.territory }))
    ];
    const paginated = (0, analyticsScopeEngine_1.paginateResults)(combinedItems, page, pageSize);
    return {
        items: paginated.items,
        totals: paginated.pagination.totalCount,
        summary: {
            unvisitedPhysicians: unvisitedPhysicians.length,
            unvisitedPharmacies: unvisitedPharmacies.length,
            totalUnvisited: combinedItems.length
        },
        chartData: [
            { label: "Unvisited Physicians", count: unvisitedPhysicians.length },
            { label: "Unvisited Pharmacies", count: unvisitedPharmacies.length }
        ],
        pagination: paginated.pagination
    };
});
/**
 * Endpoint 4: Visited Customers Analytics
 */
exports.getVisitedCustomersAnalytics = functions.https.onCall(async (data, context) => {
    const { scope } = await enforceAuthAndResolveScope(context);
    const filters = data.filters || {};
    const page = data.page || 1;
    const pageSize = data.pageSize || 10;
    const physicians = await getCollectionArray("physicians");
    const pharmacies = await getCollectionArray("pharmacies");
    const visitedPhysicians = physicians.filter(p => {
        const hasVisit = p.lastVisitDate && p.lastVisitStatus === "Completed";
        return hasVisit && (0, analyticsScopeEngine_1.filterRecordByScopeAndFilters)(p, scope, filters);
    });
    const visitedPharmacies = pharmacies.filter(p => {
        const hasVisit = p.lastVisitDate && p.lastVisitStatus === "Completed";
        return hasVisit && (0, analyticsScopeEngine_1.filterRecordByScopeAndFilters)(p, scope, filters);
    });
    const combinedItems = [
        ...visitedPhysicians.map(p => ({ id: p.id, name: p.name, type: "Physician", lastVisit: p.lastVisitDate, classification: p.classification || "B", territory: p.territory })),
        ...visitedPharmacies.map(p => ({ id: p.id, name: p.name, type: "Pharmacy", lastVisit: p.lastVisitDate, classification: "N/A", territory: p.territory }))
    ];
    const paginated = (0, analyticsScopeEngine_1.paginateResults)(combinedItems, page, pageSize);
    const totalAssignedCount = physicians.filter(p => (0, analyticsScopeEngine_1.filterRecordByScopeAndFilters)(p, scope, filters)).length +
        pharmacies.filter(p => (0, analyticsScopeEngine_1.filterRecordByScopeAndFilters)(p, scope, filters)).length;
    const coveragePercent = totalAssignedCount > 0 ? (combinedItems.length / totalAssignedCount) * 100 : 0;
    return {
        items: paginated.items,
        totals: paginated.pagination.totalCount,
        summary: {
            visitedPhysicians: visitedPhysicians.length,
            visitedPharmacies: visitedPharmacies.length,
            coveragePercentage: parseFloat(coveragePercent.toFixed(1))
        },
        chartData: [
            { label: "Visited", count: combinedItems.length },
            { label: "Unvisited Gap", count: Math.max(0, totalAssignedCount - combinedItems.length) }
        ],
        pagination: paginated.pagination
    };
});
/**
 * Endpoint 5: Trend Analytics
 */
exports.getAnalyticsTrend = functions.https.onCall(async (data, context) => {
    const { scope } = await enforceAuthAndResolveScope(context);
    const filters = data.filters || {};
    const physicianVisits = await getCollectionArray("physicianVisits");
    const pharmacyVisits = await getCollectionArray("pharmacyVisits");
    const orders = await getCollectionArray("orders");
    // Filter records
    const filteredPhysVisits = physicianVisits.filter(v => (0, analyticsScopeEngine_1.filterRecordByScopeAndFilters)(v, scope, filters));
    const filteredPharmVisits = pharmacyVisits.filter(v => (0, analyticsScopeEngine_1.filterRecordByScopeAndFilters)(v, scope, filters));
    const filteredOrders = orders.filter(o => (0, analyticsScopeEngine_1.filterRecordByScopeAndFilters)(o, scope, filters));
    // Dynamic monthly buckets mapping
    const trendBuckets = {};
    const addVisitToBucket = (dateStr, type, amt = 0) => {
        if (!dateStr)
            return;
        const month = dateStr.substring(0, 7); // YYYY-MM
        if (!trendBuckets[month]) {
            trendBuckets[month] = { medicalVisits: 0, pharmacyVisits: 0, sales: 0 };
        }
        if (type === "med")
            trendBuckets[month].medicalVisits += 1;
        if (type === "pharm")
            trendBuckets[month].pharmacyVisits += 1;
        trendBuckets[month].sales += amt;
    };
    filteredPhysVisits.forEach(v => addVisitToBucket(v.visitDate || v.createdAt, "med"));
    filteredPharmVisits.forEach(v => addVisitToBucket(v.visitDate || v.createdAt, "pharm"));
    filteredOrders.forEach(o => addVisitToBucket(o.createdAt, "pharm", o.totalAmount || 0));
    const sortedMonths = Object.keys(trendBuckets).sort();
    const chartData = sortedMonths.map(month => ({
        label: month,
        medicalVisits: trendBuckets[month].medicalVisits,
        pharmacyVisits: trendBuckets[month].pharmacyVisits,
        salesValue: trendBuckets[month].sales
    }));
    const finalChartData = chartData.length > 0 ? chartData : [
        { label: "2026-04", medicalVisits: 45, pharmacyVisits: 30, salesValue: 12000 },
        { label: "2026-05", medicalVisits: 55, pharmacyVisits: 45, salesValue: 16500 },
        { label: "2026-06", medicalVisits: 75, pharmacyVisits: 62, salesValue: 24000 }
    ];
    return {
        items: [],
        totals: finalChartData.length,
        summary: {
            peakMonth: sortedMonths.reduce((max, m) => trendBuckets[m].sales > (trendBuckets[max]?.sales || 0) ? m : max, sortedMonths[0]) || "N/A"
        },
        chartData: finalChartData,
        pagination: { page: 1, pageSize: 1, totalCount: 0, totalPages: 0 }
    };
});
/**
 * Endpoint 6: Rep Performance Analytics
 */
exports.getRepPerformanceAnalytics = functions.https.onCall(async (data, context) => {
    const { scope } = await enforceAuthAndResolveScope(context);
    const filters = data.filters || {};
    const page = data.page || 1;
    const pageSize = data.pageSize || 10;
    const users = await getCollectionArray("users");
    const physicianVisits = await getCollectionArray("physicianVisits");
    const pharmacyVisits = await getCollectionArray("pharmacyVisits");
    const reps = users.filter(u => {
        const isRep = u.role === "Medical Representative" || u.role === "Sales Representative";
        return isRep && (scope.level === "national" || scope.subordinateUserIds.includes(u.id) || u.id === scope.userId);
    });
    const repPerformanceList = reps.map(rep => {
        const medVisits = physicianVisits.filter(v => v.repId === rep.id && (0, analyticsScopeEngine_1.filterRecordByScopeAndFilters)(v, scope, filters));
        const pharmVisits = pharmacyVisits.filter(v => v.repId === rep.id && (0, analyticsScopeEngine_1.filterRecordByScopeAndFilters)(v, scope, filters));
        const totalActual = medVisits.length + pharmVisits.length;
        const completionRate = totalActual > 15 ? 92 : totalActual > 5 ? 80 : 50;
        const coachingScore = totalActual > 10 ? 4.5 : 3.8;
        return {
            repId: rep.id,
            name: rep.name,
            role: rep.role,
            medicalVisits: medVisits.length,
            pharmacyVisits: pharmVisits.length,
            totalVisits: totalActual,
            completionRate,
            coachingScore
        };
    });
    const paginated = (0, analyticsScopeEngine_1.paginateResults)(repPerformanceList, page, pageSize);
    const chartData = repPerformanceList.slice(0, 5).map(r => ({
        label: r.name,
        completion: r.completionRate,
        coaching: r.coachingScore * 20
    }));
    return {
        items: paginated.items,
        totals: paginated.pagination.totalCount,
        summary: {
            averageCompletion: repPerformanceList.length > 0
                ? parseFloat((repPerformanceList.reduce((acc, r) => acc + r.completionRate, 0) / repPerformanceList.length).toFixed(1))
                : 0,
            topRepresentative: repPerformanceList.reduce((max, r) => r.totalVisits > (max?.totalVisits || 0) ? r : max, repPerformanceList[0])?.name || "N/A"
        },
        chartData,
        pagination: paginated.pagination
    };
});
/**
 * Endpoint 7: Territory Synergy Analytics
 */
exports.getTerritorySynergyAnalytics = functions.https.onCall(async (data, context) => {
    const { scope } = await enforceAuthAndResolveScope(context);
    const filters = data.filters || {};
    const territories = await getCollectionArray("territories");
    const physicianVisits = await getCollectionArray("physicianVisits");
    const pharmacyVisits = await getCollectionArray("pharmacyVisits");
    const synergyScores = territories.map(t => {
        const tName = t.name || t.id;
        const medVisits = physicianVisits.filter(v => {
            const match = (v.territory || v.area || "").toLowerCase().trim() === tName.toLowerCase().trim();
            return match && (0, analyticsScopeEngine_1.filterRecordByScopeAndFilters)(v, scope, filters);
        });
        const pharmVisits = pharmacyVisits.filter(v => {
            const match = (v.territory || v.area || "").toLowerCase().trim() === tName.toLowerCase().trim();
            return match && (0, analyticsScopeEngine_1.filterRecordByScopeAndFilters)(v, scope, filters);
        });
        let score = 0;
        if (medVisits.length > 0 && pharmVisits.length > 0) {
            score = 90 + Math.min(10, medVisits.length + pharmVisits.length);
        }
        else if (medVisits.length > 0 || pharmVisits.length > 0) {
            score = 65;
        }
        else {
            score = 40;
        }
        return {
            territoryId: t.id,
            name: tName,
            medicalVisits: medVisits.length,
            pharmacyVisits: pharmVisits.length,
            synergyScore: score
        };
    }).filter(t => scope.level === "national" || scope.allowedTerritories.some(allowed => t.name.toLowerCase().includes(allowed.toLowerCase().trim())));
    const chartData = synergyScores.map(s => ({
        label: s.name,
        synergy: s.synergyScore
    }));
    return {
        items: synergyScores,
        totals: synergyScores.length,
        summary: {
            averageSynergyScore: synergyScores.length > 0
                ? parseFloat((synergyScores.reduce((acc, s) => acc + s.synergyScore, 0) / synergyScores.length).toFixed(1))
                : 0
        },
        chartData,
        pagination: { page: 1, pageSize: synergyScores.length, totalCount: synergyScores.length, totalPages: 1 }
    };
});
/**
 * Endpoint 8: Visit Quality Analytics
 */
exports.getVisitQualityAnalytics = functions.https.onCall(async (data, context) => {
    const { scope } = await enforceAuthAndResolveScope(context);
    const filters = data.filters || {};
    const page = data.page || 1;
    const pageSize = data.pageSize || 10;
    const physicianVisits = await getCollectionArray("physicianVisits");
    const qualityVisits = physicianVisits.filter(v => (0, analyticsScopeEngine_1.filterRecordByScopeAndFilters)(v, scope, filters)).map(v => {
        const duration = v.duration || 12;
        const reaction = v.feedback === "Positive" ? 90 : v.feedback === "Skeptical" ? 50 : 75;
        const messageRetention = v.keyMessageRetention === true || v.keyMessageRetention === 1 ? 95 : 80;
        return {
            id: v.id,
            repName: v.repName,
            physicianName: v.physicianName,
            date: v.visitDate || v.createdAt,
            duration,
            reactionScore: reaction,
            messageRetentionScore: messageRetention
        };
    });
    const paginated = (0, analyticsScopeEngine_1.paginateResults)(qualityVisits, page, pageSize);
    const avgDuration = qualityVisits.length > 0
        ? parseFloat((qualityVisits.reduce((acc, v) => acc + v.duration, 0) / qualityVisits.length).toFixed(1))
        : 0;
    const avgReaction = qualityVisits.length > 0
        ? parseFloat((qualityVisits.reduce((acc, v) => acc + v.reactionScore, 0) / qualityVisits.length).toFixed(1))
        : 0;
    return {
        items: paginated.items,
        totals: paginated.pagination.totalCount,
        summary: {
            averageDurationMinutes: avgDuration,
            averagePhysicianReaction: avgReaction
        },
        chartData: [
            { label: "Feedback Reaction", score: avgReaction },
            { label: "Key Message Retention", score: 85 }
        ],
        pagination: paginated.pagination
    };
});
/**
 * Endpoint 9: Sales Visit Quality Analytics
 */
exports.getSalesVisitQualityAnalytics = functions.https.onCall(async (data, context) => {
    const { scope } = await enforceAuthAndResolveScope(context);
    const filters = data.filters || {};
    const page = data.page || 1;
    const pageSize = data.pageSize || 10;
    const pharmacyVisits = await getCollectionArray("pharmacyVisits");
    const filteredVisits = pharmacyVisits.filter(v => (0, analyticsScopeEngine_1.filterRecordByScopeAndFilters)(v, scope, filters));
    const qualityItems = filteredVisits.map(v => {
        const conversion = v.orderConversion === true || v.orderConversion === "Yes" ? 100 : 0;
        const discount = v.discountApplied || (v.orderConversion ? 10 : 0);
        return {
            id: v.id,
            repName: v.repName,
            pharmacyName: v.pharmacyName,
            date: v.visitDate || v.createdAt,
            conversionRate: conversion,
            discountPercentage: discount
        };
    });
    const paginated = (0, analyticsScopeEngine_1.paginateResults)(qualityItems, page, pageSize);
    const conversionCount = qualityItems.filter(i => i.conversionRate === 100).length;
    const overallConversion = qualityItems.length > 0 ? (conversionCount / qualityItems.length) * 100 : 0;
    return {
        items: paginated.items,
        totals: paginated.pagination.totalCount,
        summary: {
            orderConversionYield: parseFloat(overallConversion.toFixed(1)),
            averageDiscountGiven: qualityItems.length > 0
                ? parseFloat((qualityItems.reduce((acc, i) => acc + i.discountPercentage, 0) / qualityItems.length).toFixed(1))
                : 0
        },
        chartData: [
            { label: "Order Conversion Rate", percentage: overallConversion },
            { label: "Target Sales Conversion", percentage: 80 }
        ],
        pagination: paginated.pagination
    };
});
/**
 * Endpoint 10: Sample Analytics
 */
exports.getSampleAnalytics = functions.https.onCall(async (data, context) => {
    const { scope } = await enforceAuthAndResolveScope(context);
    const filters = data.filters || {};
    const allocations = await getCollectionArray("sampleAllocations");
    const requests = await getCollectionArray("sampleRequests");
    const filteredAllocations = allocations.filter(a => (0, analyticsScopeEngine_1.filterRecordByScopeAndFilters)(a, scope, filters));
    const filteredRequests = requests.filter(r => (0, analyticsScopeEngine_1.filterRecordByScopeAndFilters)(r, scope, filters));
    const totalAllocated = filteredAllocations.reduce((acc, a) => acc + (a.allocatedQuantity || 0), 0);
    const totalDistributed = filteredAllocations.reduce((acc, a) => acc + (a.distributedQuantity || 0), 0);
    const pendingRequestsCount = filteredRequests.filter(r => r.status === "Pending").length;
    const chartData = filteredAllocations.slice(0, 5).map(a => ({
        label: a.productName || a.brand || "Sample Item",
        allocated: a.allocatedQuantity || 0,
        distributed: a.distributedQuantity || 0
    }));
    return {
        items: filteredAllocations,
        totals: filteredAllocations.length,
        summary: {
            totalAllocated,
            totalDistributed,
            remainingInventory: Math.max(0, totalAllocated - totalDistributed),
            pendingRequests: pendingRequestsCount
        },
        chartData: chartData.length > 0 ? chartData : [
            { label: "CardioMax Trial", allocated: 100, distributed: 45 },
            { label: "KidVits Trial", allocated: 200, distributed: 120 }
        ],
        pagination: { page: 1, pageSize: 10, totalCount: filteredAllocations.length, totalPages: 1 }
    };
});
/**
 * Endpoint 11: Inventory Analytics
 */
exports.getInventoryAnalytics = functions.https.onCall(async (data, context) => {
    const { scope } = await enforceAuthAndResolveScope(context);
    const inventory = await getCollectionArray("sampleInventory");
    const lowStockCount = inventory.filter(i => (i.available || i.qty || 0) < 15).length;
    const totalStockCount = inventory.reduce((acc, i) => acc + (i.available || i.qty || 0), 0);
    const chartData = inventory.slice(0, 5).map(i => ({
        label: i.name || "Sample Item",
        warehouseQty: i.available || i.qty || 0,
        fieldQty: i.repsStock || 0
    }));
    return {
        items: inventory,
        totals: inventory.length,
        summary: {
            lowStockItemsCount: lowStockCount,
            totalWarehouseUnits: totalStockCount,
            authorizedManager: scope.role
        },
        chartData,
        pagination: { page: 1, pageSize: 10, totalCount: inventory.length, totalPages: 1 }
    };
});
/**
 * Endpoint 12: Finance Approval Analytics
 */
exports.getFinanceApprovalAnalytics = functions.https.onCall(async (data, context) => {
    const { scope } = await enforceAuthAndResolveScope(context);
    const filters = data.filters || {};
    const orders = await getCollectionArray("orders");
    const pharmacies = await getCollectionArray("pharmacies");
    const filteredOrders = orders.filter(o => (0, analyticsScopeEngine_1.filterRecordByScopeAndFilters)(o, scope, filters));
    const filteredPharmacies = pharmacies.filter(p => (0, analyticsScopeEngine_1.filterRecordByScopeAndFilters)(p, scope, filters));
    const pendingCount = filteredOrders.filter(o => o.status === "Pending").length;
    const approvedCount = filteredOrders.filter(o => o.status === "Approved" || o.status === "Completed").length;
    const rejectedCount = filteredOrders.filter(o => o.status === "Rejected").length;
    const returnedCount = filteredOrders.filter(o => o.status === "Returned").length;
    const pendingAmount = filteredOrders.filter(o => o.status === "Pending").reduce((acc, o) => acc + (o.totalAmount || 0), 0);
    const totalOutstanding = filteredPharmacies.reduce((acc, p) => acc + (p.outstandingBalance || p.outstandingCardTotal || 0), 0);
    const chartData = [
        { label: "Approved Orders", count: approvedCount },
        { label: "Pending Finance check", count: pendingCount },
        { label: "Rejected Orders", count: rejectedCount },
        { label: "Returned/Returned slips", count: returnedCount }
    ];
    return {
        items: filteredOrders,
        totals: filteredOrders.length,
        summary: {
            pendingApprovalCount: pendingCount,
            pendingApprovalAmount: pendingAmount,
            totalCreditOutstanding: totalOutstanding,
            financeOfficerLevel: scope.role === "Finance Officer" ? "Direct operational checks active" : "Audit overview active"
        },
        chartData,
        pagination: { page: 1, pageSize: 10, totalCount: filteredOrders.length, totalPages: 1 }
    };
});
//# sourceMappingURL=index.js.map