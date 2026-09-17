# AP2Q — Firestore Canonical Field Security

## Root causes

The recovered Rules used unconditional `isRep()`, `isSupervisor()`, and `isManager()` alternatives on field, planner, customer, and financial collections. Those alternatives bypassed document ownership, canonical UID hierarchy, department, and Area constraints. Key Message writes separately admitted the noncanonical `Marketing` role and gave Product Manager collection-wide write authority while excluding canonical AP2P managers.

AP2O navigation and AP2P product authority masked several paths in the normal UI, while backend read services correctly used `operationalScope`. Direct Firestore SDK requests remained independently authorized by the broader Rules.

## Canonical Rules model after AP2Q

AP2Q adds shared Rules predicates for:

- the 24 active canonical application roles;
- bounded canonical UID ancestry;
- Medical-versus-Sales representative department compatibility;
- exact canonical `areaIds` access;
- field-record owner and immutable ownership/location fields;
- Pharmacy-derived customer/financial scope;
- backend-resolved operational Product/Promotion Group scope for Key Message writes.

Admin and Super Admin remain explicit administrative exceptions. Noncanonical, inactive, and profile-less identities fail closed. These predicates do not calculate backend operational scope and are not authorization tokens for server services.

## Collections corrected

| Collection | Before | After |
|---|---|---|
| `pharmacies` | Representatives/supervisors/managers had unconditional reads | Active canonical users require exact Area; Admin/Super Admin remain explicit |
| `pharmacyVisits` | Any representative/supervisor/manager could read any visit | Owner or proven compatible subordinate plus Area; admin explicit; writes remain backend-owned |
| `medicalPlannerVisits` | All field roles could read; writes backend-owned | Medical owner/hierarchy/Area reads only; writes remain backend-owned |
| `medicalPlannerApprovals` | Any representative could read/write any approval | Medical owner/hierarchy/Area; immutable owner; self submission or authorized hierarchy update |
| `salesPlannerVisits` | Any representative could read/create/update another rep's plan | Sales owner/hierarchy/Area; immutable owner/location |
| `salesPlannerApprovals` | Any representative could read/write any approval | Sales owner/hierarchy/Area; immutable owner; self submission or authorized hierarchy update |
| `pharmacyVisitDrafts` | Reads mostly scoped, but any rep could update/delete | Owner/hierarchy/Area for every operation; immutable owner/location |
| `marketingMaterialRequests` | Any rep/supervisor/manager could read/write | Owner or proven hierarchy; immutable owner/location |
| `kolSponsorships` | Any rep/supervisor/manager could read/write | Owner or proven hierarchy; immutable owner/location |
| `stockRequests` | Any representative could read/write | Owner/hierarchy/Area reads; backend-only create; scoped warehouse/admin update |
| `payments` | Any representative could read/write | Pharmacy/customer scope; owner or hierarchy, scoped Finance, or admin; immutable identity |
| `customerFinancialProfiles` | Every rep/supervisor/manager/Finance user had broad read/write | Pharmacy-derived Area/customer scope; Finance/admin writes; constrained creation |
| `customerLedgerEntries` | Every rep could read/create; Finance/admin updated | Pharmacy-derived reads; only scoped Finance/admin create/update |
| `paymentCollections` | Every rep/supervisor/manager/Finance user had broad read/write | Owner/customer/hierarchy/Area reads; owner submit; scoped Finance/admin workflow updates |
| `userTerritoryAssignments` | Any representative could read every assignment | Self, canonical subordinate, or admin; assignment identity/Area immutable |
| `detailingMaterialUsage` | Any representative could read another representative's usage | Owner or compatible hierarchy plus Area; self-owned writes only |
| `detailingPageAnalytics` | Any representative could read another representative's analytics | Owner or compatible hierarchy plus Area; self-owned writes only |
| `keyMessages` writes | Admin, Product Manager, and legacy `Marketing`; no product scope | Direct writes are Admin/Super Admin only; canonical AP2P managers use a scoped backend mutation |

## Key Message authority

Catalog reads remain organization-wide as required by the AP2Q policy freeze. Direct Rules writes now deny legacy `Marketing`, unknown roles, and non-admin canonical roles. Product Manager, Marketing Manager, Marketing Officer, and Sales & Marketing Manager use `/api/key-messages/mutate`; the authenticated service resolves backend `operationalScope`, requires both Product and promotion-group scope, validates the active Product relationship, and writes through Admin SDK. Admin and Super Admin retain explicit direct Rules authority.

Firestore Rules do not fabricate product scope from client input. Arbitrary Product IDs require encoded assignment document IDs that Rules cannot reproduce safely, so non-admin mutations are server-owned.

## Attack-path tests

`tests/uat/emulator/ap2qFirestoreCanonicalFieldSecurity.test.ts` uses synthetic records and authenticated direct SDK contexts. It bypasses Sidebar, React routing, AP2P filters, and backend services. Coverage includes:

- Pharmacy known-document and scoped-query reads;
- representative, supervisor, manager, inactive, profile-less, unknown, and legacy identities;
- cross-owner and cross-department Pharmacy Visit attacks;
- direct reads and writes across every corrected planner/field collection;
- financial customer isolation;
- territory-assignment isolation;
- canonical in-scope and out-of-scope Key Message writes;
- frozen Product and Key Message catalog reads.

Tests-first characterization against the prior Rules produced 19 failures and 2 passes. With AP2Q Rules, the focused suite passes 21/21.

The stale `routeAuthorization.test.ts` assertion now checks the approved AP2O `canAccessCanonicalModule(accessContext, group.id)` call. Its behavioral representative/admin route assertions remain unchanged.

## Application query compatibility

- Pharmacy directory and Pharmacy Visit history continue through backend services that query explicit operational Area and subject UID chunks.
- Admin SDK server operations bypass client Rules and retain backend `operationalScope` enforcement.
- Representative Pharmacy queries constrained by exact `areaId` and Visit queries constrained by exact `repId` plus `areaId` pass emulator tests.
- Sales Planner's existing `repId`-bounded queries remain compatible; reads resolve geography from the linked Pharmacy when `areaId` is absent.
- Medical Planner geography resolves from the linked Physician when needed.
- Client collection scans that depended on broad financial or stock Rules must use scoped queries or existing server endpoints; AP2Q intentionally does not preserve insecure whole-collection scans.

## Explicit non-changes

- Product Master organization-wide reads were not changed.
- Key Message catalog reads were not changed.
- `academicResources`, product groups, and promotion-group reads were not changed.
- `storage.rules` and resource blob reads were not changed.
- Resource upload/management policy was not changed.
- AP2N/AP2O Sidebar, route, and restoration authority was not changed.
- AP2P product/medical/marketing application authority was not weakened.
- Backend `operationalScope`, UID hierarchy services, physician services, and production data were not changed.

## Validation

- Focused AP2Q emulator suite: 1 file, 21 tests passed.
- Existing emulator scope gate: 2 files, 60 tests passed.
- TypeScript lint: passed.
- AP2N/AP2O/AP2P plus Key Message backend regression: 7 files, 149 tests passed.
- Full unit suite: 169 files, 2,072 tests passed, zero failures.

The Storage emulator emitted its existing Java `sun.misc.Unsafe` deprecation warning; it did not affect test results.

## Unresolved policy decisions

AP2Q deliberately leaves organization-wide reads for Product Master, Key Messages, academic-resource metadata/blobs, and Product/Promotion Group reference catalogs unchanged. Whether sensitive Product fields or academic resources need field-level/product-level confidentiality remains a separate approved policy decision.

## Deployment implications

The candidate Cloud Run application and Rules must not be treated as independently deployable security states. AP2Q Rules require a controlled Firebase Rules deployment and emulator/UAT verification before production traffic. No Rules or application deployment occurred in this work package.
