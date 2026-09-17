# MENAREPS production configuration and data readiness

This contract defines prerequisites for the full certified platform. It does not authorize production reads, imports, repairs, migrations, or writes.

## Configuration inventory

| Category | Classification | Canonical authority | Missing/invalid behavior |
| --- | --- | --- | --- |
| Firebase project/database and Admin identity | REQUIRED_BEFORE_DEPLOYMENT | Runtime environment and Application Default Credentials | Process fails before binding |
| Firestore Rules and indexes | REQUIRED_BEFORE_DEPLOYMENT | Committed Rules/index manifests | Direct access denied or indexed query fails |
| Backup, Storage protection, release identity | REQUIRED_BEFORE_DEPLOYMENT | PR-3/PR-4 runtime and operations contracts | Deployment gate fails |
| Scheduler audience and service-account identity | REQUIRED_BEFORE_DEPLOYMENT | Runtime environment; approved Scheduler plan | Scheduler endpoint returns 503/401 |
| Firebase Auth identities and `users/{uid}` | REQUIRED_BEFORE_GO_LIVE | Firebase Auth UID plus canonical user document | Authentication/session fails closed |
| Roles and permissions | REQUIRED_BEFORE_GO_LIVE | canonical role registry and `rolePermissions/{role}` | Navigation/actions and backend authority denied |
| Reporting hierarchy | REQUIRED_BEFORE_GO_LIVE | `users/{uid}.managerId` | Readiness/hierarchy scope denied |
| Geography | REQUIRED_BEFORE_GO_LIVE | `countries`, `districts`, `cities`, `areas` | Operational scope excludes invalid ancestry |
| Territory assignments | REQUIRED_BEFORE_GO_LIVE | `userTerritoryAssignments` | Representative/customer scope denied |
| Promotion Groups | REQUIRED_BEFORE_GO_LIVE | `productPromotionGroups` | Representative/physician readiness fails |
| Products and commercial SKUs/prices | REQUIRED_BEFORE_GO_LIVE | `products` | Detailing/order line denied |
| Product assignments | REQUIRED_BEFORE_GO_LIVE | `userProductAssignments` | Product scope/readiness/order creation denied |
| Physician specialties | REQUIRED_BEFORE_GO_LIVE | `physicianSpecialties` | Physician master validation fails |
| Physicians and alignment | REQUIRED_BEFORE_GO_LIVE | `physicians` with canonical Area, specialty, groups, Products | Planner/Visit access denied |
| Pharmacies | REQUIRED_BEFORE_GO_LIVE | `pharmacies` with canonical Area and active state | Pharmacy Visit/order creation denied |
| Market, currency, calendar, document code | REQUIRED_BEFORE_GO_LIVE | one active valid `marketSettings` per Country | Attendance, samples, finance, and orders fail closed |
| Calendar exceptions | OPTIONAL_POST_GO_LIVE | `businessCalendarExceptions` | Base working-week policy remains authoritative; configured holidays absent |
| Customer financial profiles | OPTIONAL_POST_GO_LIVE | `customerFinancialProfiles` | First delivered invoice initializes profile transactionally; malformed existing profile fails validation |
| Customer ledger/invoices | NOT_REQUIRED | Governed delivered-invoice posting | Created from completed commercial workflow only |
| Document sequences | NOT_REQUIRED | `businessDocumentSequences` transaction | Missing sequence initializes at one; malformed existing sequence fails closed |
| Enterprise order workflow | REQUIRED_BEFORE_GO_LIVE | `orderWorkflowTemplates/ENTERPRISE_V1` | Order creation/transitions fail closed |
| Key Messages | REQUIRED_BEFORE_GO_LIVE | `keyMessages` owned by canonical Product | Missing message remains an explicit configuration absence |
| Sample SKUs, batches, allocations | REQUIRED_BEFORE_GO_LIVE when Samples are enabled | `sampleCatalog`, `sampleBatches`, `sampleAllocations` | Distribution unavailable/fails closed |
| Historical visits/orders/audit records | NOT_REQUIRED | Governed runtime writes | Created through certified workflows |
| Storage bucket and object protection | REQUIRED_BEFORE_DEPLOYMENT | Firebase Storage configuration and operational retention controls | Upload/storage operation unavailable |

## Dependency order

1. Approve release identity, Firebase project/database, service account, backups, Storage protection, Rules, and indexes.
2. Create canonical roles/permissions and access-governance configuration.
3. Establish Country → District → City → Area registries and one active market per Country.
4. Establish active Promotion Groups, Products, commercial pricing, and physician specialties.
5. Provision Firebase Auth identities through the governed process and create matching `users/{uid}` profiles.
6. Establish manager/supervisor relationships, then territory and Product assignments; complete assignment synchronization.
7. Import physicians, pharmacies, Product-owned Key Messages, and canonical promotion alignment.
8. Validate pharmacy financial identity. Pre-created customer profiles are optional because governed invoice posting can initialize them.
9. Persist and validate `orderWorkflowTemplates/ENTERPRISE_V1`.
10. If Samples are enabled, load sample catalog SKUs, active batches, and representative allocations in that order.
11. Configure business-calendar exceptions, Scheduler runtime values, and the approved Scheduler job.
12. Run the read-only validator, remediate through governed administration/import procedures, deploy the no-traffic candidate, and execute final smoke tests before traffic.

Records from steps 3–10 may use approved template imports where a certified importer exists. Firebase Auth provisioning, role permissions, reporting relationships, assignments, workflow configuration, financial configuration, inventory allocation, and Scheduler/IAM must use governed administrative setup; they must not be fabricated by a bulk data import.

## Read-only production validation contract

The validator consumes a separately approved read-only JSON export; it never connects to Firebase and contains no write or repair operation.

```text
npm run validate:production-readiness -- \
  --snapshot /approved/path/readiness-snapshot.json \
  --project EXACT_PROJECT_ID \
  --database EXACT_DATABASE_ID
```

The snapshot must declare the same explicit project/database and `mode: PRODUCTION_READ_ONLY_EXPORT`. Demo/test project IDs and emulator environment variables are rejected. Output contains deterministic `PASS`, `FAIL`, and `WARN` issues and no secret values.

The validation contract checks:

- one canonical Auth identity for each user UID and no duplicate email identities;
- canonical active roles, permissions, and manager relationships;
- complete geography ancestry and non-orphan territory assignments;
- active Promotion Group/Product lineage and representative readiness assignments;
- physician Area, specialty, Promotion Group, and Product alignment;
- pharmacy Area plus canonical market/currency resolution;
- validity of any existing customer financial profile and document sequence;
- valid `ENTERPRISE_V1` workflow configuration;
- sample SKU/Product, batch/availability, and allocation lineage where configured;
- PITR, backup, Storage, and Scheduler prerequisites supplied as explicit external evidence;
- absence of records explicitly marked or identified as UAT/demo/mock/synthetic fixtures.

Warnings identify intentionally lazy configuration, such as a customer profile that will be initialized by first invoice posting or an empty transactionally initialized sequence collection. Warnings are not silently promoted to authority.

## Before deployment

- Confirm exact commit/release identity and Node 22 build artifact.
- Confirm explicit production Firebase project/database and service account.
- Complete the PR-4 backup/export gate and record the previous Cloud Run revision.
- Apply approved Rules/index manifests through the separate deployment process.
- Confirm Storage bucket, Rules, versioning/soft delete, retention, and access logging.
- Approve Scheduler audience, dedicated service account, and least-privilege plan; the job need not run before the candidate exists.
- Prepare an approved read-only snapshot process and named validation operator.

## After deployment, before traffic/go-live

- Verify health, readiness, and runtime identity on the no-traffic candidate.
- Complete steps 2–11 of the dependency order using governed administration/import paths.
- Run the read-only readiness validator against an explicitly identified production snapshot and resolve every `FAIL`.
- Review each `WARN`, document acceptance, and confirm no certification fixture records exist.
- Create/enable the approved Attendance Scheduler job and confirm one authenticated successful invocation.
- Confirm monitoring/alert routing and backup freshness.
- Keep traffic at zero until final smoke prerequisites are satisfied.

## Final smoke-test prerequisites

- Authentication/navigation: one active non-production-designated smoke identity per exercised canonical role, matching `users/{uid}` and `rolePermissions`.
- Medical: Medical Representative → applicable Supervisor → eligible higher manager; assigned Area/Product/groups; active physician, specialty, Key Message, optional sample SKU/batch/allocation.
- Attendance: active market/calendar, representative Area, browser GPS permission, manager/subordinate relationship, Scheduler identity.
- Pharmacy: Sales Representative, assigned Area/Product, active pharmacy, pricing, market/currency, and workflow template.
- Commercial: Finance Officer, Order Operations Officer with canonical geography, Store/Warehouse actor, assigned Delivery Officer, and governed order created through Pharmacy Visit.
- Audit/history: access to governed readback for visits, requests, attendance, order history, invoice/ledger posting, and audit events.

Smoke identities and records must be explicitly approved production smoke data, clearly owned, minimally scoped, and removable through governed administration. UAT/demo fixture IDs must never be copied into authoritative production collections.
