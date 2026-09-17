# AP2P — Product / Medical / Marketing Authority

## Architecture before AP2P

Product application authority was split among Product List's legacy geography filter and Medical-Supervisor-only operational filter, `hasPermission`, local role arrays in Key Messages and Marketing pages, Master Data promotion-group workflows, physician-alignment helpers, and representative detailing eligibility. Backend `operationalScope` already produced canonical product and promotion-group IDs, while physician services enforced geography and promotion-group overlap.

The recovered behavior was mixed:

- Product Manager is a functional role with direct canonical geography/product assignments and required product scope.
- Medical Manager and Medical Supervisor derive product scope from descendants; Medical Representative uses self assignments.
- Marketing Manager derives descendant scope; Marketing Officer uses self scope; Sales & Marketing Manager derives hierarchy scope.
- Product List applied canonical operational product IDs only to Medical Supervisor and otherwise returned its legacy-filtered input.
- Key Messages and Marketing Campaigns used local management-role arrays.
- Marketing Materials used a different string-based array containing the noncanonical `Marketing` role but not Marketing Officer.
- Physician product eligibility already intersects active Product Master records, representative product assignments, and physician primary/target promotion groups.

## Authority model after AP2P

`src/lib/productMarketingAuthority.ts` is the canonical application decision layer. Every decision first applies AP2O module/view authority, then an explicit recovered action capability, then backend-issued product/promotion-group scope and physician alignment when a target record is supplied. It consumes `CanonicalOperationalScope`; it does not calculate hierarchy, geography, assignments, or representative scope.

Decisions return `allowed`, a reason, and a scope basis. Denial reasons distinguish noncanonical roles, module denial, role denial, product scope, promotion-group scope, physician alignment, and inactive products. Scope bases distinguish administrative global navigation/capability, operational product/group scope, physician alignment, and role-only capability.

## Actions

- Product: `VIEW_PRODUCT`, `VIEW_PRODUCT_LIST`, `MANAGE_PRODUCT`
- Promotion group: `VIEW_PROMOTION_GROUP`, `MANAGE_PROMOTION_GROUP`
- Key messages: `VIEW_KEY_MESSAGES`, `MANAGE_KEY_MESSAGES`
- Marketing: `VIEW_MARKETING_CONTENT`, `MANAGE_MARKETING_CONTENT`, `MANAGE_MARKETING_SETTINGS`
- Physician alignment: `VIEW_PHYSICIAN_ALIGNMENT`, `MANAGE_PHYSICIAN_ALIGNMENT`

`MANAGE_MARKETING_SETTINGS` is separate because the recovered Materials settings role list differs from Campaign content management. This avoids flattening two distinct behaviors.

## Product scope semantics

Product List now fails closed for every role until an authenticated, actor-matched, authorized operational-scope session is ready. Products are retained only when their exact IDs and, when present, promotion-group IDs occur in that backend-issued scope. Inactive products are rejected by authority. The existing legacy presentation/geography filter remains as an additional restriction before AP2P filtering; it is not treated as canonical product authority.

`MANAGE_PRODUCT` continues to consume the recovered Products create/edit permission behavior, but permission cannot override AP2O or operational product scope. Admin and Super Admin are explicit; targeted product operations still require the backend-issued organization scope rather than using navigation as data authority.

## Promotion-group and key-message semantics

Promotion-group scope never substitutes for a missing product assignment. A product-bound key message requires both its product and group to be inside operational scope. Key Message management retains the recovered canonical roles (Admin/Super Admin, Product Manager, Marketing Manager/Officer, and Sales & Marketing Manager), subject to AP2O and target scope.

Master Data promotion-group persistence was not migrated because it performs direct Firestore writes and has no safely hydrated operational-scope context at that local boundary. The AP2P evaluator defines its authority contract for a later server-owned mutation cutover.

## Marketing content semantics

Marketing Campaign management now uses AP2P rather than a local role array. Marketing Materials settings use their separate recovered role semantics; the legacy noncanonical `Marketing` value is denied, and Marketing Officer is not silently added to settings authority. Product Manager's former Marketing-page role check remains blocked by AP2O's Marketing module denial, as required by the module prerequisite.

Visit Marketing Request policy remains unchanged and specialized.

## Physician-alignment semantics

AP2P may authorize viewing/managing alignment only after the Field route, role capability, operational product/group overlap, and physician `alignedProductIds` plus primary/target group overlap all succeed. It does not rewrite physician assignment, Visit Engine ordering, detailing, or samples. Existing representative eligibility continues to intersect active products, active assignments, and physician promotion groups.

The review gate confirmed and corrected one governance/module contradiction: AP2N grants Medical Manager the Field module, while recovered default `accessGovernance` omitted Medical Manager from `FIELD_OPERATIONS`. Medical Manager was added only to the authoritative default Field navigation set. This aligns the AP2O module ceiling; it grants no geography, hierarchy, product, promotion-group, physician, or record scope. AP2P still requires backend-issued descendant operational scope and physician alignment overlap.

## Role behavior

- Admin/Super Admin: explicit application capability, with organization operational scope required for targeted records.
- Product Manager: Products/Key Message actions only inside direct functional product scope; no AP2O-bypassing Marketing or Field grant.
- Medical Manager/Supervisor: descendant-derived products only; Medical Manager now passes the canonical default Field ceiling, while persisted governance restrictions and record scope continue to apply.
- Medical Representative: self-assigned products only; physician/detailing eligibility remains a separate intersection.
- Marketing Manager: descendant-derived products; explicit Marketing/Key Message capability.
- Marketing Officer: self products; Campaign/Key Message capability, but no recovered Materials-settings capability.
- Sales & Marketing Manager: hierarchy products and explicit content capability.
- Sales roles: view only where AP2O and operational assignments permit; no management grant was added.
- Unknown and legacy/noncanonical roles: fail closed.

## Files migrated

- Product List authorization now uses AP2P filtering.
- Key Messages management and Marketing Campaign management use AP2P.
- Marketing Materials settings use the distinct AP2P settings action.
- Direct role checks retained for Key Message specialty registration because specialty authority is not a Product/Marketing action.
- Master Data promotion-group writes, Resource Center's specialized resource policy, physician persistence, detailing, samples, and Visit Marketing Requests remain unchanged.

## Backend and data-scope boundary

No backend file, operational-scope implementation, Firestore rule, deployment configuration, or production data was changed. `operationalScopeService` remains authoritative for UID hierarchy, geography, subject UIDs, products, and product groups. `physicianReadService` remains authoritative for scoped reads. Visit writes and Firestore ABAC remain independent enforcement boundaries. AP2P decisions are not backend authorization tokens.

## Validation

- `npm run lint`: passed with no TypeScript errors.
- AP2N/AP2O/AP2P plus Product List focused gate: 5 files, 122 tests passed.
- Affected governance/product/physician/marketing/backend-boundary suite: 19 files, 340 tests passed.
- Full suite: 168 files, 2,064 tests passed, zero failures.
- `git diff --check`: passed.

## Unresolved contradictions and deployment readiness

The Medical Manager Field-governance mismatch is resolved at the navigation/module layer only. Direct client writes in Product, Key Message, Marketing, and Promotion Group screens remain subject to existing Firestore rules and should ultimately move behind scoped server mutations. AP2P is not deployment authorization and no production verification was performed.
