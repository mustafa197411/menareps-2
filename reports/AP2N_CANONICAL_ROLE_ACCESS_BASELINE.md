# AP2N — Canonical Role Access Baseline

## Scope

This report characterizes the authorization behavior recovered from the 2026-08-26 Cloud Run source. AP2N adds a typed declarative baseline; it does not migrate callers, alter operational scope, or grant data access. UID hierarchy, canonical geography, product assignments, and backend `operationalScope` remain authoritative for record visibility.

## Role inventory

`Role` defines 27 values. `CANONICAL_USER_ROLES` includes 24 application roles. The canonical list includes Super Admin, Admin, General/Regional/Country management, Sales & Marketing/Sales/Area/Supervisor/Representative roles, Marketing Manager/Product Manager/Marketing Officer, Medical Manager/Supervisor/Representative, Finance Manager/Finance Officer/Treasury Officer, Warehouse Manager/Inventory Officer/Store Manager/Delivery Officer, and Order Operations Officer.

The enum values excluded from `CANONICAL_USER_ROLES` are explicitly classified as legacy/noncanonical:

- `Warehouse / Inventory`
- `Marketing`
- `System Administrator`

This is contradictory because existing code gives System Administrator administrator-like access, and `roleScopePolicy` contains policies for all three excluded values. AP2N does not silently promote them into the canonical inventory.

## Current access behavior

The typed registry in `src/lib/canonicalRoleAccessBaseline.ts` records all application modules for every canonical role as `ALLOW`, `DENY`, or `CONDITIONAL`, and assigns every module an explicit family of exact view IDs and view prefixes. Conditional modules depend on dynamic `rolePermissions` or specialized sample, order, or marketing-request capability policies. The baseline intentionally does not make those decisions.

Current broad patterns are:

- Super Admin and Admin: global route/module exceptions, subject to specialized capability paths such as Samples.
- General Manager: broad access, but most `admin-*` routes are denied except User Management and Template Catalog.
- Sales & Marketing Manager: broad route exception in `canAccessView`, but group navigation follows Sales-family behavior; this is an existing route/sidebar contradiction.
- Medical family: field, product, sample, marketing, territory, supervision, analytics, productivity, master-data, dashboard, and account families, with representative isolation from pharmacy/sales/finance routes.
- Sales family: pharmacy, product, orders, territory, supervision, analytics, productivity, master-data, dashboard, and account families, with Sales Representative isolation from medical/physician routes.
- Finance Officer and Treasury Officer: dashboard, finance, operations, productivity routes, and account.
- Product Manager: dashboard, products, master data, productivity routes, and account.
- Warehouse/Store and delivery/order specialists: limited operational route families.

## Hardcoded exceptions and contradictions

- `canAccessView` and `canAccessGroup` contain direct role and department branches.
- `CRM_MODULE_PERMISSIONS` is a second hardcoded matrix beneath dynamic permission vetoes.
- Sidebar `roles` metadata is declared but runtime filtering calls `canAccessGroup`/`canAccessView` and does not consult those arrays.
- `accessGovernance` navigation is checked only for Field Operations and Pharmacies, and the persisted governance record is not supplied by Sidebar.
- `canAccessView` grants visits/account/dashboard routes before role-family checks.
- Sales & Marketing Manager has broad direct-route access but Sales-family group visibility.
- Finance Manager, Marketing Manager, Marketing Officer, and Inventory Officer fall through to permissive group/route defaults in places.
- Route restoration calls `canAccessView`, but does not pass the hydrated dynamic permission record.

## Dynamic configuration interaction

`App.tsx` hydrates `rolePermissions`. Existing `hasPermission` treats those values primarily as denials layered over `CRM_MODULE_PERMISSIONS`; it is not yet a purely dynamic permission authority. Samples, commercial orders, and marketing requests have additional capability semantics.

`accessGovernance.scopePolicy` can override backend role-scope policy. Its navigation/capability model is mostly not wired into frontend routing. Navigation never grants operational data scope.

## Sidebar and route safety

Sidebar groups and children are filtered separately. `SidebarPageRouter` independently calls `canAccessView` and renders `access-denied-view` when rejected. App route restoration also checks `canAccessView` before restoring a view. Characterization tests preserve these protections and explicitly assert that navigation visibility is not data authorization.

## AP2O migration boundary

AP2O may consolidate consumers around a canonical evaluator that combines this static baseline with hydrated `rolePermissions` and applicable `accessGovernance` records. It must preserve `roleScopePolicy`, UID organizational hierarchy, and backend `operationalScope` as the data authority. AP2O should remove duplicated caller logic only after behavior-level tests cover each migration and should fail closed on conflicts rather than broadening access.
