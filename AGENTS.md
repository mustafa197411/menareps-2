# MENAREPS 2.0 Global Project Rules & Specifications

You are working on **MENAREPS 2.0**, an enterprise pharmaceutical commercial operations CRM platform. Adhere strictly to the non-negotiable rules and blueprint specifications below across all coding tasks and agent turns.

---

## 1. Non-Negotiable Development Rules

1. **Do Not Redesign Existing UIs**: The user interface, dashboards, planners, sidebar layouts, forms, and general page layouts are fully completed. Do not attempt to redesign, restructure, or alter the theme. Focus strictly on connecting pages to the backend (Firebase Firestore, Storage, Auth) and implementing robust business/permission logic.
2. **Authoritative Master Data Models**: Use the official Excel templates (for Users, Products, Physicians, Pharmacies, Key Messages) as the absolute schema definitions for your Firestore documents, forms, CRUD elements, and CSV/Excel import/export rules.
3. **Finance Officer Role**: The generic "Finance" role is strictly replaced by **Finance Officer** (which maps to `Role.FINANCE` with value `"Finance Officer"`). This is an operational, workflow-driven financial approval role (approve/reject/return orders, view balances/credits), not a corporate budget or ledger role.
4. **Geographic Hierarchy Path**: Geography is modeled strictly as `Country > District > City > Area/Territory`. Always identify territories/areas using the complete geographic path (`Country / District / City / Area`) rather than just the area name alone, since area names are not globally unique.
5. **Robust Data Visibility and Security**: All queries, reports, and dashboards must filter data dynamically based on the user's role, territory assignment, product assignment, and direct reporting hierarchy line. Representatives must only see their assigned customers/products, and supervisors/managers must only see subordinates' data.

---

## 2. Priority Implementation Roadmap

1. **Phase 1: Firebase & Security Foundation** — Core Auth, role-based state, and configurable sidebar access control. (Completed/Established)
2. **Phase 2: Territory & Product Security Engine** — Enforcing Country-District-City-Area path checks and product-customer alignments.
3. **Phase 3: Official Template Import/Export Center** — High-resilience Excel/CSV parsers matching master spreadsheet columns precisely.
4. **Phase 4: Users, Products, Physicians, and Pharmacies Modules** — Connecting CRUD screens, profiles, search/filters, and data models to Firestore.
5. **Phase 5: Medical & Sales Planners** — Planning, calendar-based submission, and territory-secured approval loops.
6. **Phase 6: Visits & Detailing Workflows** — Active visit timers, GPS compliance checks, digital detailing message engagement, and sample drop validation.
7. **Phase 7: Order Fulfilment & Finance Officer Workflows** — Secure commercial order entry, Supervisor dispatch, Finance Officer operational checks, and Warehouse/Delivery dispatches.
8. **Phase 8: Synergy Analytics & Audit Systems** — Dashboards, medical-sales comparison reports, exports, and comprehensive audit ledger logs.

---

## 3. Configurable Permissions Matrix

Do not hardcode role-based access to features. Load permissions dynamically from `rolePermissions` records:
- **View**: General page or module entry.
- **Create / Edit / Delete**: Resource modification rights.
- **Approve / Reject / Return**: Operational workflow decisions (primarily for Supervisors, Managers, and Finance Officers).
- **Import / Export**: Batch file management.
- **Assign**: Product/territory relationships management.

---

*Always reference this file at the start of any work turn to verify alignment with the MENAREPS 2.0 master specification.*
