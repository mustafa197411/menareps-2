# AP2O — Canonical Access Control Consolidation

## Architecture before AP2O

Frontend authorization was split between `canAccessGroup`, `canAccessView`, sidebar-only `accessGovernance` defaults, route restoration without hydrated permissions, the hardcoded `CRM_MODULE_PERMISSIONS`, and specialized Samples, Orders, and Visit Marketing Request policies. Several roles reached permissive fall-through branches. Sidebar `roles` arrays were metadata but looked like a competing authorization source.

Backend `roleScopePolicy`, UID organizational hierarchy, `operationalScope`, canonical geography/product assignments, promotion-group alignment, resource services, and Firestore rules independently controlled data access.

## Architecture after AP2O

`src/lib/canonicalAccessControl.ts` is the shared frontend module/view evaluator. It consumes the AP2N baseline and is used by Sidebar parent filtering, Sidebar child filtering, `SidebarPageRouter` direct-page authorization, App pharmacy hydration gating, and restored/current route reconciliation.

The evaluator returns a typed decision with its reason, resolved module, and AP2N classification. Unknown modules, unknown views, unknown roles, and noncanonical roles fail closed.

### Explicit route registration corrections

The recovered router contains four legitimate identifiers that are not covered by the normal view-family prefixes:

- `physicians` is a compatibility alias of `field-physician-list`; both render `PhysicianList` and the alias inherits the destination decision.
- `payment-collections` is a compatibility alias of `payment-collection`; both render `PaymentCollectionPage` and the alias inherits the destination decision. The canonical destination remains a conditional Sales and Orders route, so Sales roles are not granted payment functionality merely because they can enter the module.
- `admin` independently renders the `Administration` page and is explicitly governed by Administration authority.
- `audit` independently renders `AuditLedger` and is explicitly governed by Administration authority.

`visits-review` is an explicit shared route across Field Operations and Pharmacies, matching its two recovered Sidebar placements and its combined `VisitsPage`. It is allowed only when at least one of those two module authorities allows it. The recovered `visits` and `field-visits-review` router spellings are aliases of that shared decision. This preserves Medical-side Field review and Sales-side Pharmacy review without granting Sales access to other Field routes.

Two recovered Sidebar parent differences are intentional presentation choices, not authorization ownership:

- `products-key-messages` remains canonically owned by Products although it is displayed under Master Data.
- `admin-template-catalog` remains canonically owned by Administration although it is displayed under both Master Data and Administration.

Child evaluation is independent of the displayed parent; parent visibility cannot grant either route. No Master Data, Administration, Field Operations, or Sales and Orders module baseline was broadened for these placements.

## Precedence

1. Resolve a canonical role and registered module/view family.
2. Apply explicit AP2N route exceptions.
3. Apply AP2N `DENY` as a non-overridable ceiling.
4. Apply applicable active `accessGovernance` navigation restriction. Governance can restrict but cannot override AP2N denial.
5. Delegate AP2N `CONDITIONAL` to the existing specialized Samples, Orders, or Marketing Request policy.
6. Apply recovered dynamic restrictions, including role-level `view: false` for Productivity and the Administration permission for workflow settings.
7. Allow only after all preceding checks pass.

Dynamic `rolePermissions` is not reinterpreted as a universal grant engine. Existing static module permissions and specialized capability semantics remain in place pending later deliberate migration.

## Runtime consumers migrated

- `Sidebar.tsx`: parent and child visibility use the same canonical context. The `roles` arrays remain presentation metadata and are not consulted as authorization.
- `SidebarPageRouter.tsx`: direct rendering uses the same evaluator and retains `access-denied-view`.
- `App.tsx`: loads role-keyed `accessGovernance`, uses canonical access for pharmacy hydration, and re-evaluates restored/current routes with hydrated role permissions and governance.

Legacy `canAccessView`/`canAccessGroup` remain for non-migrated backend compatibility and historical tests. `hasPermission` and `CRM_MODULE_PERMISSIONS` remain because specialized and backend workflows still consume them. Removing those is outside the safe AP2O caller boundary.

## Sidebar, direct routes, and restoration

An unauthorized parent is hidden, and children are evaluated independently. A visible parent cannot authorize a denied child. Direct navigation is independently rejected by the router. Route reconciliation runs again when role, permissions, or governance changes. It selects only an authorized fallback; if none exists, the requested route remains and renders access denied.

`ap2oRouteRegistration.test.ts` inventories string route IDs declared by both production consumers (`Sidebar.tsx` and `SidebarPageRouter.tsx`). Every ID must resolve through exactly one ordinary module family or be explicitly registered as a compatibility alias, independent route, or shared route. This test also covers alias equivalence, shared-route isolation, parent/child independence, the payment boundary, and unknown-route fail-closed behavior. A new production route without registration fails the suite.

## rolePermissions and accessGovernance

Role permissions participate in both Sidebar and router contexts. Conditional modules use their existing capability semantics. Recovered explicit dynamic denials remain effective.

The app now hydrates `accessGovernance` records. Missing/malformed navigation and capability arrays are normalized to empty arrays. Existing Field Operations and Pharmacies defaults are preserved when a record is unavailable; other governance modules restrict only through an explicit active navigation entry. Navigation never grants record access.

## Legacy role treatment

`Warehouse / Inventory`, `Marketing`, and `System Administrator` remain in the enum but outside `CANONICAL_USER_ROLES`. The AP2O evaluator denies them rather than inheriting former permissive fall-through behavior. They are not removed because existing runtime data may require a later identity/data migration.

## Specialized policies

- Samples continue through `canAccessSampleView` and sample capabilities.
- Orders continue through `canAccessCommercialOrderQueue`/`hasPermission` when AP2N marks the module conditional.
- Visit Marketing Requests continue through `canAccessVisitMarketingRequestWorklist` and their lifecycle capabilities.

No specialized policy may turn an AP2N `DENY` into `ALLOW`.

## Backend and data-scope boundary

AP2O changes no backend scope, Firestore rules, geography, product assignment, promotion-group assignment, hierarchy, or representative-scope implementation. Frontend authorization is navigation/page availability only. `navigationDecisionDoesNotAuthorizeData` deliberately returns false to make that boundary testable.

## Validation

- `npm run lint`: passed.
- AP2N + AP2O + exhaustive route registration: 3 files, 77 tests passed.
- Affected authorization/navigation/specialized/backend boundary suite: 11 files, 101 tests passed.
- Full suite: 167 files, 2,039 tests passed, zero failures.

## Remaining AP2P boundary

AP2P may define cross-functional Product/Medical/Marketing authority. It must consume this evaluator for module availability while retaining backend `operationalScope` for product, promotion-group, physician, geography, and record scope. AP2O does not implement that authority.
