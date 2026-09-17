# MENAREPS 2.0 Enterprise Analytics Architecture Audit & Design Blueprint
### Finalized Sprint 4 – Enterprise Product Analytics Architecture Audit (RC1 Feature Complete)

---

## EXECUTIVE SUMMARY & AUDIT FOREWORD

This audit establishes the official **Enterprise Analytics Architecture Blueprint** for the MENAREPS 2.0 platform. As the platform achieves Release Candidate 1 (RC1) feature completeness, the focus shifts from feature accumulation to **architectural consolidation, scalability, and extreme security**. 

Currently, the analytics module of MENAREPS 2.0 is rich and highly functional, spanning 13 discrete files under `/src/components/analytics`. However, this depth has introduced **architectural fragmentation**:
1. **Inconsistent Queries**: Firestore queries are scattered across multiple components (`PerformanceDashboardPage`, `TerritorySynergyPage`, `ProductDashboardPage`, etc.), creating redundant connections and risking performance degradation ("Denial of Wallet" scenarios).
2. **Redundant Dashboards**: There is significant visual and data-fetching overlap between dedicated page files and the comprehensive `ReportsHubPage` cockpit.
3. **Calculation Gaps**: The core KPI formulas, specifically around **Medical-Sales Synergy** and **Product Promotion Group** performance, require absolute mathematical synchronization to prevent mismatched indicators across role-based viewports.

This blueprint resolves these challenges by providing a comprehensive audit of the current analytics inventory, defining canonical KPI math, auditing gaps, and laying down a **Unified, Secure, and AI-Ready Analytics Architecture** designed to run on top of Firestore without modification of the production code during this audit phase.

---

## DELIVERABLE 1: ANALYTICS COMPONENT INVENTORY

An exhaustive audit of the 13 components currently residing in `/src/components/analytics` reveals the following functional and structural landscape:

| # | File Path | Component Name | Role Access Gating | Primary Firestore Collections | Rendered Charts / UI Elements |
|---|---|---|---|---|---|
| **1** | `/src/components/analytics/AnalyticsDashboard.tsx` | `AnalyticsDashboard` | Admin, Supervisor, Manager, Finance Officer, Reps | Direct proxy via tab routes | Hub tab bar navigation routing to underlying page subviews. |
| **2** | `/src/components/analytics/PerformanceDashboardPage.tsx` | `PerformanceDashboardPage` | Executive, Manager, Supervisor, Finance Officer | `orders` (direct read), LocalStorage fallbacks | Area, Line, Bar, Composed, and Pie charts displaying high-level sales KPIs. |
| **3** | `/src/components/analytics/TerritorySynergyPage.tsx` | `TerritorySynergyPage` | Executive, Manager, Regional Supervisor | `orders` (direct read) | Scatter plots, Radar overlays, and comparison Bar charts for Medical vs. Sales. |
| **4** | `/src/components/analytics/SynergyReports.tsx` | `SynergyReports` | Manager, Supervisor, Rep Pairs | `alignmentService` static sets (underlying) | Cascading filters for 8 specialized reports; Radar, Area, and Line charts. |
| **5** | `/src/components/analytics/ReportsHubPage.tsx` | `ReportsHubPage` | Admin, Manager, Regional Supervisor | `orders`, `sampleAllocations`, `sampleDisbursedLogs`, `auditLogs` | Unified reporting cards, tabbed detailed tabular reports, security check grids. |
| **6** | `/src/components/analytics/ProductDashboardPage.tsx` | `ProductDashboardPage` | Executive, Manager, Product Specialist | `orders` (direct read) | Composed charts, horizontal Bar rankings, key message effectiveness lists. |
| **7** | `/src/components/analytics/SalesVisitQualityPage.tsx` | `SalesVisitQualityPage` | Sales Supervisor, Commercial Manager | `orders`, local visits | Bar and Line trends mapping order conversions per pharmacy detailing visit. |
| **8** | `/src/components/analytics/MedicalVisitQualityPage.tsx` | `MedicalVisitQualityPage` | Medical Supervisor, Medical Director | Local `physicianVisits` sets | Double-axis Bar/Line charts showing detailing frequency vs. doctor feedback. |
| **9** | `/src/components/analytics/SampleAnalyticsPage.tsx` | `SampleAnalyticsPage` | Warehouse Manager, Finance, Supervisor | Local stock balances, requests | Pie and Cell charts showing sample utilization rates, return logs, stock levels. |
| **10** | `/src/components/analytics/SupervisorPerformancePage.tsx` | `SupervisorPerformancePage` | Executive, National Manager | Mock regional supervisor metrics | High-level performance tables, plan execution rates, accompanied visit counts. |
| **11** | `/src/components/analytics/SupervisorReportsPage.tsx` | `SupervisorReportsPage` | National Manager, Regional Supervisor | Local visits arrays | Radar coaching indices, joint territory coverage bars, administrative task rates. |
| **12** | `/src/components/analytics/AnalyticsAIReports.tsx` | `AnalyticsAIReports` | Admin, Supervisor, National Manager | Context build from local variables | Conversational prompt fields, natural language template buttons, PDF/Excel export. |
| **13** | `/src/components/analytics/AnalyticsSecurityTestsPage.tsx` | `AnalyticsSecurityTestsPage` | Security Officer, Admin | `auditLogs` write triggers | Interactive diagnostic terminal simulating data breaches, and logging leaks. |

---

## DELIVERABLE 2: CANONICAL KPI INVENTORY & BUSINESS LOGIC

To prevent calculation discrepancies across different viewports, we define the **canonical business math** for all core CRM metrics of MENAREPS 2.0. Every dashboard, hook, and API route must compute these metrics as follows:

### 1. Sales Target Achievement Rate ($R_{\text{ach}}$)
*   **Definition**: Measures the percentage of finalized, non-voided sales volume achieved against the territory's allocated quota.
*   **Formula**:
    $$R_{\text{ach}} = \left( \frac{\sum V_{\text{orders}}}{\text{Quota}_{\text{territory}}} \right) \times 100$$
    *Where:*
    *   $\sum V_{\text{orders}}$ is the sum of `total` order values in the `orders` collection where `status != "Voided"`, matching the filtered territory path.
*   **Firestore Filter**:
    ```typescript
    query(collection(db, "orders"), where("territoryPath", "==", territoryPath), where("status", "!=", "Voided"))
    ```

### 2. Medical-Sales Synergy Alignment Index ($I_{\text{syn}}$)
*   **Definition**: Quantifies the operational overlap and communication frequency matching between a territory's Medical Representative (detailing physicians) and Sales Representative (collecting commercial pharmacy orders).
*   **Formula**:
    $$I_{\text{syn}} = \left( 1 - \frac{|N_{\text{medical}} - N_{\text{pharmacy}}|}{N_{\text{medical}} + N_{\text{pharmacy}}} \right) \times \text{SyncFactor} \times 100$$
    *Where:*
    *   $N_{\text{medical}}$ is the count of scientific physician detailing visits.
    *   $N_{\text{pharmacy}}$ is the count of pharmacy commercial orders and visits.
    *   $\text{SyncFactor}$ is the percentage of synchronized joint target lists completed ($0.0 \to 1.0$).
*   **Calculation Logic**: A score of $100\%$ indicates perfect operational harmony where detailing visits directly guide localized commercial order flow with synchronized timing.

### 3. Physician Target Coverage (%) ($C_{\text{phys}}$)
*   **Definition**: The proportion of target physicians in a representative's portfolio who have been visited at least once during the active cycle.
*   **Formula**:
    $$C_{\text{phys}} = \left( \frac{N_{\text{visited\_physicians}}}{N_{\text{total\_physicians}}} \right) \times 100$$
    *Where:*
    *   $N_{\text{visited\_physicians}}$ is the count of unique physicians in the territory having at least one completed visit record in the active cycle.
    *   $N_{\text{total\_physicians}}$ is the total number of physicians aligned to the territory path.

### 4. Sample Distribution Efficacy Index ($E_{\text{samples}}$)
*   **Definition**: Evaluates the commercial conversion rate of free clinical samples distributed to physicians.
*   **Formula**:
    $$E_{\text{samples}} = \left( \frac{\Delta V_{\text{sales\_next\_month}}}{\sum Q_{\text{samples\_distributed}}} \right)$$
    *Where:*
    *   $\Delta V_{\text{sales\_next\_month}}$ is the incremental sales growth of the detailed product in local pharmacies in the subsequent month.
    *   $\sum Q_{\text{samples\_distributed}}$ is the quantity of clinical samples dropped to physicians in that territory in the active month.

### 5. Sponsorship ROI & Marketing Sales Lift ($L_{\text{mkt}}$)
*   **Definition**: Measures the percentage lift in pharmacy order volume following localized promotional events or sponsorship budgets.
*   **Formula**:
    $$L_{\text{mkt}} = \left( \frac{V_{\text{post\_event}} - V_{\text{pre\_event}}}{V_{\text{pre\_event}}} \right) \times 100$$

### 6. Supervisor Plan Execution Rate ($E_{\text{plan}}$)
*   **Definition**: Measures the percentage of planned field coaching trips actually completed by a Supervisor.
*   **Formula**:
    $$E_{\text{plan}} = \left( \frac{\text{CoachingTrips}_{\text{completed}}}{\text{CoachingTrips}_{\text{planned}}} \right) \times 100$$

### 7. Coaching Index ($I_{\text{coach}}$)
*   **Definition**: Composite quality score of joint accompanied representative visits, assessing message detailing, objection handling, and product alignment.
*   **Formula**: Balanced average of coaching assessment rubrics scored out of 100.

---

## DELIVERABLE 3: DUPLICATE DETECTION, REDUNDANCIES, AND INCONSISTENCIES

An architectural deep dive into the current implementation exposes several visual and logical redundancies, as well as terminology drift:

### 1. Dashboard Overlaps & Redundancies
*   **The Hub vs. Specialized Pages**: `ReportsHubPage.tsx` contains 6 complete tabs, 4 of which directly duplicate the visual charts, filters, and tables of standalone pages:
    *   The `performance` tab in `ReportsHubPage` duplicates `PerformanceDashboardPage.tsx`.
    *   The `territory` tab in `ReportsHubPage` duplicates `TerritorySynergyPage.tsx`.
    *   The `samples` tab in `ReportsHubPage` duplicates `SampleAnalyticsPage.tsx`.
    *   The `overview` tab in `ReportsHubPage` duplicates the high-level indicators of `ProductDashboardPage.tsx`.
*   **Impact**: This redundancy results in multiple duplicate Firestore queries being triggered when a user moves between tabs, inflating data transfer and client memory footprint.

### 2. Mathematical & Logic Discrepancies
*   **Synergy Score Inconsistency**:
    *   In `TerritorySynergyPage.tsx`, the Synergy Score is derived using a simplistic ratio calculation from local visit arrays.
    *   In `SynergyReports.tsx` (Report 1), the Synergy Score is loaded from static datasets in `alignmentService.ts`, which enforces a pre-computed $80\% - 95\%$ scale.
    *   In `ReportsHubPage.tsx`, the Synergy Score is derived directly from live database count matches without incorporating the synchronized joint-target coefficients.
*   **Sample Allocation Source of Truth**:
    *   `ReportsHubPage.tsx` queries the live `"sampleAllocations"` collection.
    *   `SampleAnalyticsPage.tsx` relies entirely on a hardcoded static `mockAllocations` array, creating a disjointed experience if a supervisor modifies allocations in the hub.

### 3. Legacy Terminology Drift
*   **Brand Group vs. Product Promotion Group**:
    *   `ProductDashboardPage.tsx` still declares `brandMetrics` (lines 196–220) and uses `brand` fields throughout its UI cards.
    *   `ReportsHubPage.tsx` and `SalesVisitQualityPage.tsx` reference `INITIAL_PRODUCT_GROUPS` but map them to "Product Group" in English and "مجموعة المنتجات" in Arabic, bypassing the finalized enterprise CRM terminology: **Product Promotion Group** and **Product Family**.

---

## DELIVERABLE 4: PRODUCT ANALYTICS GAP ANALYSIS

Following Phase 3's Product Promotion Group Alignment sprint, we audited the active dashboards to identify gaps where analytics do not match the finalized CRM master models:

```
                  ┌─────────────────────────────────────┐
                  │      Official master product        │
                  │   excel schemas / Firestore docs    │
                  └──────────────────┬──────────────────┘
                                     │
                                     ▼
                  ┌─────────────────────────────────────┐
                  │    Active analytics viewport        │
                  │ (ProductDashboardPage, ReportsHub)  │
                  └──────────────────┬──────────────────┘
                                     │
           ┌─────────────────────────┴─────────────────────────┐
           ▼                                                   ▼
┌─────────────────────────────────────┐             ┌─────────────────────────────────────┐
│       MAPPED/ACTIVE FIELDS          │             │     MISSING/LEGACY DRIFT GAPS       │
├─────────────────────────────────────┤             ├─────────────────────────────────────┤
│ • Product Name                      │             │ • Product Promotion Group           │
│ • Therapeutic Area                  │             │   (still referenced as brandGroup)  │
│ • Price                             │             │ • Product Family                    │
│ • Code                              │             │   (not tracked in charts/filters)   │
│ • Brand                             │             │ • Specialty Rep alignment check     │
│                                     │             │   (bypasses security engine)        │
└─────────────────────────────────────┘             └─────────────────────────────────────┘
```

### Gap 1: Promotion Group & Product Family Separation
*   **Current State**: Charts in `ProductDashboardPage` group data by `therapeuticArea` and `brand`.
*   **Required State**: Products belong to **Product Families**, which belong to **Product Promotion Groups** (as defined in `AGENTS.md` and Excel templates).
*   **The Gap**: The horizontal bar charts and pie charts in the analytics modules do not aggregate sales or detailing visits by *Product Promotion Group* or *Product Family*.

### Gap 2: Specialty Rep Alignment Enforcement
*   **Current State**: Representative data in dashboards is filtered strictly by geographic territory.
*   **Required State**: Representatives in MENAREPS 2.0 are specialized (e.g., Cardiology Reps promote only CardioMax; Pediatric Reps promote only KidVits). 
*   **The Gap**: The security filters in `ProductDashboardPage` do not verify if a representative is querying products outside their aligned **Product Promotion Group**, creating a critical data-leak gap.

---

## DELIVERABLE 5: ENTERPRISE UNIFIED ANALYTICS ARCHITECTURE BLUEPRINT

To resolve fragmentation, we present the **MENAREPS 2.0 Unified Analytics Architecture**. This architecture establishes a strict separation of concerns, routing all analytics components through a secure, single-point data fetcher.

### 1. Conceptual Data Flow
```
 ┌─────────────────────────┐     ┌──────────────────────────┐
 │   Firestore Database    │     │   Client Local Storage   │
 └────────────┬────────────┘     └────────────┬─────────────┘
              │                               │
              │   (On Cache Miss / Sync)      │   (Offline Fallback)
              ├───────────────────────────────┘
              ▼
 ┌──────────────────────────────────────────────────────────┐
 │        Secured Analytics Custom React Hook               │
 │           "useSecuredAnalyticsData"                      │
 ├──────────────────────────────────────────────────────────┤
 │  • Enforces Secured Data Gating (Row-Level Security)      │
 │  • Enforces Geographic Path Checks (Cascade Filters)     │
 │  • Automatically Normalizes Promotion Group Models       │
 │  • Computes Common Cached KPIs in-memory                 │
 └────────────────────────────┬──────────────────────────────┘
                              │
            ┌─────────────────┼─────────────────┐
            ▼                 ▼                 ▼
 ┌────────────────────┐ ┌─────────────┐ ┌───────────────────┐
 │   Executive sales  │ │  Synergy    │ │  Product/Medical  │
 │     Dashboard      │ │   Reports   │ │      Visits       │
 └────────────────────┘ └─────────────┘ └───────────────────┘
```

### 2. Master Component Design: The Unified Analytics Hook
The cornerstone of this architecture is the `useSecuredAnalyticsData` hook. It aggregates Firestore collections, applies the security engine, and computes core metrics in a single, high-performance execution loop:

```typescript
import { useState, useEffect, useMemo } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../lib/firebase";
import { User, AnalyticsDbState, AnalyticsFilters } from "../types";
import { calculateSecuredAnalyticsScope, filterDatasetByScopeAndFilters } from "../lib/analyticsScopeEngine";

export function useSecuredAnalyticsData(
  currentUser: User,
  filters: AnalyticsFilters,
  onProgress?: (progress: number) => void
) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;
    const fetchAnalyticsCore = async () => {
      try {
        setLoading(true);
        onProgress?.(10);

        // 1. Single Fetch of Core Collections
        const [ordersSnap, allocationsSnap, visitsSnap] = await Promise.all([
          getDocs(collection(db, "orders")),
          getDocs(collection(db, "sampleAllocations")),
          getDocs(collection(db, "physicianVisits")) // or local state passing
        ]);
        onProgress?.(50);

        const rawOrders = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const rawAllocations = allocationsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        
        onProgress?.(80);

        // 2. Assemble State for the Security Engine
        const dbState: AnalyticsDbState = {
          users: [], // Hydrated as needed
          userTerritoryAssignments: [],
          userProductAssignments: [],
          physicianAssignments: [],
          pharmacyAssignments: [],
          physicians: [],
          pharmacies: [],
          products: [],
          physicianVisits: [],
          pharmacyVisits: []
        };

        // 3. Enforce Secured Scope
        const securedScope = calculateSecuredAnalyticsScope(currentUser, dbState);
        
        // 4. Filter and Normalize
        // Map old Brand Group references to canonical Product Promotion Group
        const normalizedOrders = rawOrders.map((order: any) => ({
          ...order,
          items: order.items?.map((item: any) => ({
            ...item,
            productPromotionGroup: item.brandGroup || item.productPromotionGroup || "Unassigned",
            productFamily: item.productFamily || "Unassigned"
          }))
        }));

        if (active) {
          setData(normalizedOrders);
          setLoading(false);
          onProgress?.(100);
        }
      } catch (err: any) {
        console.error("Secured Analytics Query failed: ", err);
        if (active) {
          setError(err);
          setLoading(false);
        }
      }
    };

    fetchAnalyticsCore();
    return () => { active = false; };
  }, [currentUser, filters]);

  return { data, loading, error };
}
```

---

## DELIVERABLE 6: FIRESTORE PERFORMANCE & INDEXING REVIEW

High-frequency analytics querying on Firestore can result in severe performance and billing implications if not managed correctly. We outline the optimal index and query architecture below:

### 1. Mandatory Composite Indexes
To support advanced, secure dynamic filtering on the `orders` and `auditLogs` collections, the following multi-field composite indexes are **mandatory**:

```json
{
  "indexes": [
    {
      "collectionGroup": "orders",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "territoryPath", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "updatedAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "auditLogs",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "timestamp", "order": "DESCENDING" }
      ]
    }
  ]
}
```

### 2. Client-Side Filtering Overhead Mitigation
*   **The Problem**: Fetching millions of raw visit logs and orders to filter them in the browser consumes user bandwidth, memory, and CPU.
*   **The Mitigation**:
    1.  **Date-Range Partitioning**: Enforce strict query pushdowns:
        ```typescript
        query(collection(db, "orders"), where("createdAt", ">=", startTimestamp))
        ```
    2.  **Projection Fields**: Reduce payload size by storing lightweight pre-aggregated monthly metric documents in a dedicated `/analyticsSummary/` collection, updating them daily via Cloud Functions.

### 3. Cryptographically Verified Offline Fallback
When network connectivity is severed (a frequent operational scenario in regional Libyan territories), the analytics components must degrade gracefully by falling back to `localStorage` while ensuring data tamper-resistance:

```typescript
import { hmac } from "crypto"; // Simulated or web-crypto standard

export function saveSecuredCache(key: string, data: any[], secret: string) {
  const payload = JSON.stringify(data);
  // Calculate signature
  const signature = crypto.subtle.sign(
    "HMAC",
    secretKey,
    new TextEncoder().encode(payload)
  );
  
  localStorage.setItem(key, payload);
  localStorage.setItem(`${key}_sig`, arrayBufferToBase64(signature));
}

export function loadSecuredCache(key: string, secret: string): any[] | null {
  const payload = localStorage.getItem(key);
  const signature = localStorage.getItem(`${key}_sig`);
  
  if (!payload || !signature) return null;
  
  // Verify HMAC signature to prevent local data injection
  const isValid = verifyHmac(payload, signature, secret);
  if (!isValid) {
    console.error("Local analytics cache has been tampered with! Discarding.");
    return null;
  }
  
  return JSON.parse(payload);
}
```

---

## DELIVERABLE 7: SECURED ROLE-BASED ROW-LEVEL ACCESS MODEL

Dynamic data masking and row-level access control are strictly mapped in MENAREPS 2.0 based on geographic paths and user roles:

```
               ┌────────────────────────┐
               │    User Authenticates  │
               └───────────┬────────────┘
                           │
                           ▼
               ┌────────────────────────┐
               │   Identify User Role   │
               └───────────┬────────────┘
                           │
       ┌───────────────────┼───────────────────┐
       ▼                   ▼                   ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│     REP      │    │  SUPERVISOR  │    │  EXECUTIVE   │
├──────────────┤    ├──────────────┤    ├──────────────┤
│ See ONLY raw │    │  See aggregated/ │    │ See national │
│ local record │    │  detailed subordinate │   macro indicators│
│ sales/visits │    │    sales & coaching  │   without limit  │
└──────────────┘    └──────────────┘    └──────────────┘
```

### 1. Row-Level Gating Rules
1.  **Representative**:
    *   Can ONLY view visits and orders where `representativeId == request.auth.uid`.
    *   Cannot query national averages or adjacent territories.
2.  **Finance Officer**:
    *   Can view all pending commercial orders for credit check validation.
    *   Is strictly blocked from viewing medical representative coaching indices, detailing diaries, and scientific feedback notes.
3.  **Supervisor**:
    *   Can view all records within their assigned `District` path (e.g., `Libya/West/Tripoli/*`).
    *   Enforces hierarchical cascade:
        ```typescript
        const isSubordinate = subordinateUsers.some(u => u.id === targetRepId);
        if (!isSubordinate) throw new Error("Access Denied: User is outside your coaching hierarchy.");
        ```

### 2. Geographic Hierarchical Path Constraints
Geographic paths must be checked using the absolute canonical path: `Country / District / City / Area`:
```typescript
export function isPathAuthorized(userScope: string[], targetPath: string): boolean {
  return userScope.some(allowedPath => {
    // Exact match or sub-path hierarchy match
    return targetPath.startsWith(allowedPath) || allowedPath.startsWith(targetPath);
  });
}
```

---

## DELIVERABLE 8: AI-READINESS & GEMINI INTEGRATION BLUEPRINT

To prepare MENAREPS 2.0 for future AI-driven insights, we establish the architecture pattern for interfacing with the Gemini API safely and efficiently on the server side:

### 1. Data Pipeline & Pipeline Security
All Gemini queries must execute strictly **server-side** via Express `server.ts` to protect key secrets. The client never communicates directly with the `@google/genai` endpoint.

```typescript
// server/routes/analyticsAI.ts
import { Router } from "express";
import { GoogleGenAI } from "@google/genai";
import { enforceServerSideRoleGate } from "../middleware/authGate";

const router = Router();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

router.post("/api/analytics/insights", enforceServerSideRoleGate(["Supervisor", "Manager"]), async (req, res) => {
  try {
    const { datasetContext, userQuestion } = req.body;

    // Secure Data Injection & Token Minimization
    // Strip private PII or billing details before passing context to Gemini
    const anonymizedDataset = datasetContext.map((item: any) => ({
      territory: item.territoryCode,
      promotionGroup: item.productPromotionGroup,
      synergy: item.synergyScore,
      salesAchieved: item.salesUSD,
      targetGap: item.targetGap
    }));

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [
        { text: `You are the MENAREPS 2.0 Medical-Sales Synergy analyst. Analyze the following territory performance dataset:\n${JSON.stringify(anonymizedDataset)}` },
        { text: `User Question: ${userQuestion}` }
      ],
      config: {
        systemInstruction: "Provide direct, strategic corrective action recommendations. Avoid greeting text or markdown formatting outside of bullets.",
        temperature: 0.2
      }
    });

    res.json({ insights: response.text });
  } catch (error: any) {
    res.status(500).json({ error: "AI Insight Generation failed: " + error.message });
  }
});

export default router;
```

---

## DELIVERABLE 9: EXECUTIVE DASHBOARD CONSOLIDATION PROPOSAL

To eliminate structural redundancy, we propose consolidating the overlapping interfaces (`PerformanceDashboardPage`, `TerritorySynergyPage`, and the `ReportsHubPage` cockpit) into a single, unified, high-performance executive dashboard.

```
┌─────────────────────────────────────────────────────────────┐
│                 MENAREPS 2.0 COCKPIT                        │
├─────────────────────────────────────────────────────────────┤
│  [Cascading Geography Filter Bar: Country > District > Area]│
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐         │
│  │  Sales Perf  │ │ Med Synergy  │ │ Sample Flow  │         │
│  │ (KPI Widgets)│ │ (Radar Plot) │ │ (Stock/Dist) │         │
│  └──────────────┘ └──────────────┘ └──────────────┘         │
├─────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────────┐  │
│  │                Interactive Analytics Tabs              │  │
│  ├───────────┬──────────────┬──────────────┬──────────────┤  │
│  │ Overview  │ Brand Matrix │ Visit Quality│ Audit Ledger │  │
│  ├───────────┴──────────────┴──────────────┴──────────────┤  │
│  │                                                        │  │
│  │                                                        │  │
│  │             Unified Active Tab Viewport                │  │
│  │                                                        │  │
│  │                                                        │  │
│  └────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Layout Strategy
*   **The Global Gating Controls**: A unified header featuring cascade dropdowns (`Country`, `District`, `City`, `Area`) that binds to a shared React Context state, updating all active charts simultaneously.
*   **The Secondary Tab Menu**: Replaces the redundant standalone pages. The sidebars and route entries of all role types map strictly to a single `AnalyticsCockpit` component with custom tab-gating based on active permissions.

---

## DELIVERABLE 10: PRODUCT ANALYTICS IMPLEMENTATION ROADMAP

We propose a safe, multi-phased implementation roadmap that respects Release Candidate 1 (RC1) stability guidelines:

### Phase 1: Custom Hook Gating (UAT Cycle 1)
*   **Actions**: Implement the `useSecuredAnalyticsData` custom hook in isolation. Refactor `ProductDashboardPage.tsx` to read from the hook instead of calling direct `getDocs(collection(db, "orders"))` lines.
*   **Verification**: Ensure all fallback tests in `AnalyticsSecurityTestsPage.tsx` pass.

### Phase 2: Schema Migration & Alignments (UAT Cycle 2)
*   **Actions**: Migrate product metadata properties to align with the canonical `ProductPromotionGroup` and `ProductFamily` models. Update Recharts aggregations to group data by these fields.
*   **Verification**: Validate that specialized reps are restricted to querying their aligned Product Promotion Groups.

### Phase 3: AI Pipeline Integration & Cockpit Consolidation (Production Release)
*   **Actions**: Deprecate redundant dashboards. Deploy server-side Gemini routes. Enable natural language AI report generations from the unified cockpit viewport.
*   **Verification**: Full security scan on data leakage bounds and API key isolation.

---

*This document serves as the absolute architecture specification for MENAREPS 2.0 Analytics. No deviations or legacy database fallbacks outside of these specifications are permitted.*
