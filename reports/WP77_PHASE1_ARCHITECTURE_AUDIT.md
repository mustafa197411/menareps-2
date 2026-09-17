# WP77 Phase 1 Architecture and Hard-Code Audit

Baseline: `8d10ad5f597142f5eb2129136bdd04034a86fbdc`

This audit classifies runtime behavior before WP77 production implementation. Test fixtures, migration utilities, rollback evidence, and template examples are distinguished from active runtime assumptions.

## Market, currency, time, and calendar

| Area | Current implementation | Classification | WP77 disposition |
|---|---|---|---|
| Geography master | Firestore `countries`, `districts`, `cities`, `areas`; backend builds canonical `Country > District > City > Area` nodes | CANONICAL / SAFE TO REUSE | Market records reference canonical country IDs. |
| Country selection | User/customer/order records contain country IDs or legacy country labels; several helpers default to Libya | CONFLICTING / MIGRATION REQUIRED | Resolve a market from canonical IDs first; retain explicit backward-compatible defaults only. |
| Administration localization | `Administration.tsx` renders hard-coded Libya/Jordan IDs, currencies and date choices; save button does not persist canonical settings | DEMO / STATIC | Replace data source with the market registry; do not trust displayed IDs. |
| Currency | `LYD`, `$`, local `formatCurrency` functions and `Intl.NumberFormat` calls are distributed through orders, AR, pharmacy visits, products, targets, reports and analytics | DUPLICATE / HARD-CODED / MIGRATION REQUIRED | One formatter requires an explicit market/currency; mixed-currency aggregation fails closed. |
| Pharmacy currency helper | `features/pharmacyVisit/utils/currency.ts` maps Libya/Jordan locally | SAFE TO REUSE SEMANTICS / DUPLICATE | Redirect through canonical formatter. |
| Timezone | `User` type has timezone, but no operational market timezone resolver exists | STALE / MIGRATION REQUIRED | Registry owns IANA timezone and formatting. |
| Working calendar | No canonical week start, work hours, working weekdays, holiday or exception engine | MISSING / MIGRATION REQUIRED | Add canonical calendar policy and pure resolver. |
| Planner working-day gaps | Medical planner has local working-day behavior/tests | DUPLICATE / MIGRATION REQUIRED | Consume shared business-day classification. |
| Reporting currency | Reports and dashboards format monetary totals locally and can aggregate without currency identity | CONFLICTING / MIGRATION REQUIRED | Group by currency or reject mixed-currency totals. |

Legitimate occurrences: official templates, test fixtures, UAT evidence, migration/repair scripts, rollback reports and business-document examples. These are not runtime configuration sources.

## Attendance, workday, Team Activity, and leave

| Area | Current implementation | Classification | WP77 disposition |
|---|---|---|---|
| Team Activity | `TeamActivity.tsx` uses five fictional representatives, random timers/GPS values, simulated ping/sync, local visit totals and static 98.6% compliance | DEMO / STATIC / REMOVE DATA SOURCE | Preserve layout; replace calculations with canonical attendance/team projections. |
| Legacy Team Activity concepts | No repository implementation of Activity Log, Duty Status, History, Attendance Summary, attendance/session APIs, auto-checkout settings, orphan recovery, wrong-checkout recovery or manual auto-checkout processing | STALE/MISSING | Implement as one engine and explicit repository/API contracts. |
| My Workday | Productivity UI exists but is not a canonical attendance session authority | DUPLICATE / MIGRATION REQUIRED | Consume the attendance engine instead of defining policy. |
| Attendance sessions | No canonical session schema or duration/checkout-mode policy | MISSING | Add immutable session semantics and fail-closed transitions. |
| Workday end vs auto-checkout | Not modeled | MISSING | Scheduled end caps credited AUTO duration; fallback cutoff only closes an open session. |
| Orphan/wrong checkout | No deterministic recovery contract | MISSING | Add idempotent recovery decisions and `ADMIN_CORRECTION`. |
| Leave Approval | `LeaveApprovals.tsx` uses fictional local records and in-memory approve/reject/create | DEMO / STATIC | Preserve layout; define canonical leave records and scoped service. |
| Leave categories | UI has Annual, Sick, Emergency, Unpaid; required business set is annual, sick, personal, unpaid, work-from-home | CONFLICTING | Canonical enum supports required five; legacy Emergency normalizes to Personal. |
| Attendance denominator | No authoritative formula; dashboard percentages are unrelated local calculations | CONFLICTING | `expected = scheduled working days - approved leave working days`; holidays/non-working days are excluded before leave subtraction. |

## Navigation, capabilities, and data scope

| Area | Current implementation | Classification | WP77 disposition |
|---|---|---|---|
| Sidebar model | `Sidebar.tsx` combines role conditions, per-user `sidebarVisibility`, and page IDs | DUPLICATE / CONFLICTING | Navigation registry returns visibility only. |
| Role sidebar settings | Administration/role settings are separate from backend authorization | DEMO/CONFLICTING | Consolidate into Access & Navigation; never authorize data from sidebar state. |
| Module permissions | `userPolicyEngine.ts` contains a large static role/module matrix and optionally applies Firestore `rolePermissions` | CANONICAL FALLBACK + HARD-CODED | Preserve fail-closed fallback; canonical resolver applies dynamic capability records. |
| Client scope | `securityEngine.ts`, analytics scope engines and local component checks each derive variants | DUPLICATE / CONFLICTING | Canonical scope-mode vocabulary and adapters; backend operational scope remains authority. |
| Backend scope | Organizational hierarchy + operational scope resolves authenticated actor, descendants, geography assignments and products; queries remain server-scoped | CANONICAL / SAFE TO REUSE | Wrap/reuse; do not weaken validation. |
| WP76J visit history | Server-scoped `repId in` + dates plus geography post-filter; certified counts 6/6/4/2 | CANONICAL / REGRESSION INVARIANT | Must remain unchanged. |
| Analytics/reporting scope | Client and Functions contain separate analytics scope engines | DUPLICATE / MIGRATION REQUIRED | Share scope descriptors and compare population identifiers. |
| Field Operations navigation | Existing role/page conditions do not express the required allow/deny matrix independently of data scope | CONFLICTING | Add explicit navigation policy with dynamic override support. |

## Orders and workflow

| Area | Current implementation | Classification | WP77 disposition |
|---|---|---|---|
| Order state machine | `orderWorkflowEngine.ts` has canonical statuses, transitions, capabilities and transition history | CANONICAL / SAFE TO REUSE | Retain state and audit contracts. |
| Stage staffing | Role-to-capability mapping fixes Finance/Operations/Store staffing assumptions | HARD-CODED / MIGRATION REQUIRED | Workflow template supplies allowed roles per stage. |
| Same actor stages | Administration advertises consolidation through localStorage; backend engine remains governed by fixed capabilities | CONFLICTING / DEMO | Template explicitly permits roles per stage; each transition remains separate. |
| Workflow settings UI | `pharma_crm_workflow_rules` localStorage only | DEMO / STATIC | Canonical workflow-template repository plus audit metadata. |
| Queue/detail security | Backend scoped queue/detail/transition services exist | CANONICAL / SAFE TO REUSE | Template authorization is an additional constraint, never a client bypass. |

## Administration and audits

| Page | Classification | Decision |
|---|---|---|
| User Management | CANONICAL with overlapping access controls | KEEP; consume unified access/scope resolvers. |
| Product Assignment Audit | Three fictional rows in component state | REBUILD from canonical assignments/products/groups/users/geography/sync state. |
| Role Sidebar Settings | Overlaps sidebar and RBAC | MERGE into Access & Navigation. |
| RBAC Matrix | Static fallback plus dynamic records | MERGE into Access & Navigation / capability registry. |
| Data Import | Uses template/schema services and Firestore | KEEP. |
| Template Catalog | Canonical template registry | KEEP. |
| Location Management | Reads canonical geography collections | KEEP. |
| Regional Localization | Hard-coded display-only values | REBUILD as Market / Regional Settings. |
| Order Workflow Settings | localStorage and fixed display stages | REBUILD as Workflow Configuration. |
| Field-detailing settings | Local component state | MIGRATION REQUIRED; retain until canonical persistence is approved. |
| Diagnostics | Firebase/runtime probes | KEEP under Audit & Diagnostics. |
| Audit Ledger | UI exists; not a substitute for configuration audit history | KEEP and extend with typed configuration events. |

## Migration safety decisions

1. New registries are additive and accept legacy records through explicit adapters.
2. No production data, rules, indexes, IAM, Auth or traffic changes occur in WP77 implementation.
3. Missing/invalid market, capability, workflow or attendance policy fails closed for mutation and mixed-currency aggregation.
4. Libya may be a seed/default market, never a global invariant.
5. Backend operational scope remains authoritative; navigation never grants data access.
6. Existing order statuses and separate transition audit records remain compatible.
7. WP76J visit queries, filtering and role outcomes remain regression locked.

## WP77 implementation reconciliation (local worktree)

Implemented and locally exercised:

- additive `marketSettings`, `businessCalendarExceptions`, `configurationAudit`, `attendanceSessions`, `leaveRequests`, `accessGovernance`, and `orderWorkflowTemplates` contracts;
- a shared market formatter/calendar resolver with explicit Libya and Jordan seeds and mixed-currency refusal;
- calendar-driven Medical/Sales Planner working days and rolling periods;
- scoped Team Activity/Leave APIs, canonical leave mutations, attendance duration/duty/summary engine, and Admin-only orphan-session recovery;
- navigation/capability/data-scope separation, with Field Operations/Pharmacy navigation corrected for the required roles;
- workflow-template authorization in the live order workspace while retaining separate transition history;
- a real Product Assignment Audit and typed configuration audit events;
- scoped product analytics replacing its broad `orders` scan and removal of its fictional product, sales, trend, message, and territory values;
- removal of broad hardening-report reads and browser-local workflow/order authorities;
- WP76J physician-visit query/service left unchanged.

Residual whole-repository classification from the post-change scan:

| Residual family | Classification | Release consequence |
|---|---|---|
| AR, payments, targets, product pricing, notifications, invoice posting and several pharmacy-visit reducers still default to `LYD` | HARD-CODED / MIGRATION REQUIRED | Blocks WP77H certification until persistence and display currency are explicit. |
| Activation/import/user/customer creation paths still synthesize `Libya` when country is absent | HARD-CODED / MIGRATION REQUIRED | Blocks multi-market fail-closed certification. |
| Synergy, visit-quality, inventory, brands and finance analytics still label values as USD/LYD locally | HARD-CODED / MIGRATION REQUIRED | Blocks system-wide currency-consumer certification. |
| Alignment seed arrays, official import examples, test fixtures, UAT evidence and migration utilities name Libya | LEGITIMATE SEED / TEST FIXTURE | Does not block when it is not a runtime fallback. |
| Territory Management, Pharmacy Visit History/Profile and several analytics pages still contain fictional rows/text | DEMO / STATIC / REBUILD OR REMOVE | Blocks WP77F/WP77H certification. |
| Existing order/AR persistence assumes one currency in some document types | CONFLICTING / MIGRATION REQUIRED | Requires an additive compatibility adapter and focused persistence regression before changing those contracts. |

Accordingly, this audit does **not** certify WP77H yet. The worktree remains an implementation checkpoint; no deployment or production mutation is authorized.

## WP77 residual migration continuation (2026-08-16)

Closed locally in the continuation:

- introduced an explicit financial-identity adapter used by AR profiles, ledger entries, delivered-invoice posting, payment posting and single-currency aggregation;
- new invoice/payment/order records now carry canonical `marketId`, `countryId`, `currencyCode` where their live write path was migrated; legacy records are interpreted only from an explicit country/market or an unambiguous ISO currency;
- removed absent-country Libya synthesis from activation, user creation/import, physician/pharmacy import, and canonical geography editing paths touched by the residual scan;
- made pharmacy-visit currency resolution fail closed when neither the selected pharmacy nor its persisted draft supplies a resolvable market; legacy explicit `LY` remains read-compatible;
- removed fictional Territory Management fallback rows and Pharmacy Visit History rows; retired the wholly fictional Finance Manager, Brands Distribution and non-canonical Pharmacy Profile subviews from runtime presentation;
- changed Territory Synergy order loading from a broad Firestore scan/localStorage fallback to the backend-authoritative scoped product-analytics endpoint;
- made official order export require explicit geography and currency.

Remaining active runtime blockers after that migration:

| Runtime path | Proven residual | Classification / consequence |
|---|---|---|
| `PaymentCollectionPage` / `paymentService.getPaymentCollections` | Broad collection reads plus representative authorization applied after retrieval; UI still labels all values LYD | CONFLICTING / SECURITY + CURRENCY BLOCKER. Requires a backend-scoped payment query and per-record/grouped formatter. |
| `CustomerAccountsPage`, AR bootstrap/reconcile services | Broad `pharmacies`, `customerFinancialProfiles`, and `orders` reads remain; global summary is not rendered by currency group | CONFLICTING / SECURITY + CURRENCY BLOCKER. Requires backend finance-scope query and grouped totals. |
| Legacy `SalesOrders` surfaces | Many LYD labels, locally aggregated revenue, and legacy client-side order filtering remain alongside the canonical scoped workflow workspace | DUPLICATE / CONFLICTING. Requires completing the scoped order-read migration for every live role before removing the legacy reader. |
| `PerformanceDashboardPage` and `SalesVisitQualityPage` | Direct broad `orders` reads remain | SECURITY BLOCKER. Must consume the same backend operational scope resolver. |
| Product/Pharmacy list and summary surfaces | Product prices, outstanding balances and visit budget labels still use LYD locally | CURRENCY BLOCKER. Must resolve record market/currency and reject mixed totals. |
| Administration listeners | Administration still attaches broad operational collections for diagnostics/audits | GOVERNANCE BLOCKER. Requires capability-gated, purpose-specific backend diagnostics rather than treating navigation as authorization. |
| Legacy runtime regression suite | 1,467/1,472 Vitest assertions passed; five assertions failed, including stale deferred-analytics expectations and three pre-existing/runtime-source invariants | TEST BLOCKER. The assertions must be reconciled against the intended WP77 architecture, not ignored. |
| Firestore rules | Rules/index changes are prepared, but emulator execution is unavailable in this environment | RELEASE PREREQUISITE. Static review is not emulator certification. |

Remaining Libya/LYD occurrences in canonical market seeds, alignment seeds, tests, UAT evidence, migration utilities, and explicitly legacy record fixtures are justified and are not themselves blockers. The live paths listed above are unjustified active assumptions, so WP77H remains uncertified.
