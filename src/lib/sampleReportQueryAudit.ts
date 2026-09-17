export interface SampleReportQueryAuditEntry {
  report: string;
  collection: string;
  serverFilters: string;
  scope: string;
  compositeIndexRequired: boolean;
  note: string;
}

export const SAMPLE_REPORT_QUERY_AUDIT: readonly SampleReportQueryAuditEntry[] = [
  { report: "Catalog/Summary", collection: "sampleCatalog", serverFilters: "none", scope: "signed-in catalog read", compositeIndexRequired: false, note: "Canonical SKU lookup; display joins use sampleSku.productId." },
  { report: "Inventory/Expiry", collection: "sampleInventory", serverFilters: "none", scope: "VIEW_SAMPLE_INVENTORY only", compositeIndexRequired: false, note: "Central Sample stock; never products.stock or products.stockQuantity." },
  { report: "Inventory/Expiry", collection: "sampleBatches", serverFilters: "none", scope: "VIEW_SAMPLE_INVENTORY only", compositeIndexRequired: false, note: "Batch and hard expiry facts." },
  { report: "Requests/Requested-vs-Actual", collection: "sampleRequests", serverFilters: "repId == UID or repId in authorized UID chunk", scope: "OWN / TEAM / ORG", compositeIndexRequired: false, note: "Date and report filters are applied after server-side identity scope." },
  { report: "Requests", collection: "sampleApprovals", serverFilters: "repId == UID or repId in authorized UID chunk", scope: "OWN / TEAM / ORG", compositeIndexRequired: false, note: "Decision history only; does not drive allocation totals." },
  { report: "Allocations/Balance", collection: "sampleAllocations", serverFilters: "repId == UID or repId in authorized UID chunk", scope: "OWN / TEAM / ORG", compositeIndexRequired: false, note: "Canonical rep custody and remaining balance." },
  { report: "Distribution/Requested-vs-Actual", collection: "sampleDisbursedLogs", serverFilters: "repId == UID or repId in authorized UID chunk", scope: "OWN / TEAM / ORG", compositeIndexRequired: false, note: "Actual physician utilization only." },
  { report: "Movement/Audit", collection: "sampleTransactions", serverFilters: "none", scope: "inventory operator or approval manager rules", compositeIndexRequired: false, note: "Immutable operational ledger. Large-range server pagination remains a future scale hardening item." }
] as const;
