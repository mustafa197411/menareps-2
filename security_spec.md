# MENAREPS 2.0 Security Specification

## 1. Data Invariants
1. **User Identity Security**: A user can never modify their own operational `role` or `securityScope` fields to prevent self-assigned permissions or privilege escalation.
2. **Representative Isolation**: A Representative (Medical/Sales) can only create, update, or read planning and visit documents where `repId` or `salesRep` matches their authenticated `uid`.
3. **Audit Trail Integrity**: Audit logs are strictly append-only. Once written, they can never be modified or deleted by any non-admin/super-admin user.
4. **Master Data Protection**: Master data collections (`physicians`, `pharmacies`, `products`, `keyMessages`) can only be modified by authorized Roles (`Admin`, `Super Admin`, `Marketing`, `Product Manager`).
5. **Template Governance**: The document templates and history are restricted. Only `Admin` and `Super Admin` can create, edit, or delete template schemas.
6. **Finance Guardrails**: Operational financial files, limits, and outstanding commercial balance approvals are restricted to `Finance Officer` and `Admin`/`Super Admin`.
7. **Warehouse Integrity**: Inventory items and sample catalog transactions are guarded from representatives and can only be managed by `Warehouse / Inventory` and `Admin`/`Super Admin`.

---

## 2. The "Dirty Dozen" Malicious Payloads

### Payload 1: Role Escalation Attack (Identity)
A Sales Representative attempts to update their own user profile to elevate their role to "Super Admin".
```json
{
  "id": "USR-123",
  "name": "Malicious Rep",
  "email": "rep@menareps.com",
  "role": "Super Admin",
  "region": "Tripoli"
}
```

### Payload 2: Hostile Audit Log Alteration (Integrity)
A normal user attempts to update a critical security audit log to hide unauthorized actions.
```json
{
  "id": "log-456",
  "action": "DELETED_RECORDS",
  "details": "User changed details to hide tracks",
  "userId": "attacker-uid",
  "timestamp": "2026-07-01T10:00:00Z"
}
```

### Payload 3: Template Registry Hijacking (Integrity)
A representative attempts to modify the official import template schemas to inject faulty data fields.
```json
{
  "id": "physician_template",
  "name": "Malicious Physician Template",
  "fields": ["invalid_field"]
}
```

### Payload 4: Spoofed Visit Report (Identity)
A representative attempts to submit a physician visit report under another representative's ID to claim fake visit counts.
```json
{
  "id": "visit-999",
  "physicianId": "PHY-555",
  "physicianName": "Dr. Salem",
  "date": "2026-07-01",
  "repId": "innocent-rep-uid",
  "repName": "Innocent Rep"
}
```

### Payload 5: Unauthorized Sample Allocation Increase (State)
A medical representative attempts to directly write a new sample allocation document giving themselves unlimited samples.
```json
{
  "id": "alloc-777",
  "repId": "attacker-uid",
  "productId": "PROD-001",
  "allocatedQuantity": 10000,
  "month": "2026-07"
}
```

### Payload 6: Unapproved Sample Request Dispatch (State)
A representative attempts to bypass the approval workflow by creating an already "Approved" and "Dispatched" sample request.
```json
{
  "id": "req-888",
  "repId": "attacker-uid",
  "productId": "PROD-001",
  "quantity": 500,
  "status": "Dispatched"
}
```

### Payload 7: Fake Territory Assignment Injection (Identity)
An unassigned user attempts to create a dummy record in `userTerritoryAssignments` to gain read access to Tripoli region data.
```json
{
  "assignmentId": "ass-333",
  "userId": "attacker-uid",
  "territoryName": "Libya / West District / Tripoli / Downtown",
  "status": "Active"
}
```

### Payload 8: Order Price Tampering (Integrity)
A representative attempts to save a commercial order with a massive total value but sets the status to "Paid" without actual payment review.
```json
{
  "id": "order-111",
  "pharmacyId": "PHARM-222",
  "pharmacyName": "Tripoli Pharmacy",
  "total": 99999,
  "status": "Paid",
  "salesRep": "attacker-uid"
}
```

### Payload 9: Shadow Inventory Adjustment (State)
A Sales Representative attempts to overwrite a warehouse inventory item's stock quantity directly.
```json
{
  "id": "inv-item-444",
  "name": "Medicine A",
  "qty": 500000,
  "available": 500000
}
```

### Payload 10: Poisoned Physician ID Injection (Resource Poisoning)
An attacker attempts to inject a massive 2MB junk string as a document ID to crash queries or consume excessive storage.
```json
{
  "id": "A_VERY_LONG_POISONED_STRING_REPEATED_TEN_THOUSAND_TIMES...",
  "name": "Poisoned Name"
}
```

### Payload 11: Direct Outstanding Balance Reset (Integrity)
A Sales Representative attempts to edit a pharmacy document directly to reset its outstanding balance to zero.
```json
{
  "id": "PHARM-222",
  "name": "Tripoli Pharmacy",
  "outstandingBalance": 0
}
```

### Payload 12: Hostile KOL Sponsorship Approval (State)
An unauthorized representative attempts to update a scientific sponsorship status to "Approved" with a massive budget.
```json
{
  "id": "spons-555",
  "doctorName": "Dr. Ahmad",
  "amount": 25000,
  "status": "Approved"
}
```

---

## 3. Test Runner Specification (`firestore.rules.test.ts`)

A complete test suite structure verifying all these constraints:

```typescript
import { assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "fs";

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "menareps-2",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe("MENAREPS 2.0 Security Rules Verification", () => {
  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  test("Payload 1: Normal rep should FAIL to escalate role to Super Admin", async () => {
    const repDb = testEnv.authenticatedContext("rep-123").firestore();
    const docRef = repDb.collection("users").doc("rep-123");
    await assertFails(docRef.update({ role: "Super Admin" }));
  });

  test("Payload 2: Normal user should FAIL to edit audit logs", async () => {
    const repDb = testEnv.authenticatedContext("rep-123").firestore();
    const docRef = repDb.collection("auditLogs").doc("log-456");
    await assertFails(docRef.update({ details: "Altered" }));
  });

  test("Payload 3: Normal user should FAIL to write template definitions", async () => {
    const repDb = testEnv.authenticatedContext("rep-123").firestore();
    const docRef = repDb.collection("templates").doc("physician_template");
    await assertFails(docRef.set({ name: "Malicious Template" }));
  });

  test("Payload 4: Rep should FAIL to submit visits for another representative", async () => {
    const repDb = testEnv.authenticatedContext("rep-123").firestore();
    const docRef = repDb.collection("physicianVisits").doc("visit-999");
    await assertFails(docRef.set({ id: "visit-999", repId: "innocent-rep" }));
  });

  test("Payload 5: Rep should FAIL to write sample allocations directly", async () => {
    const repDb = testEnv.authenticatedContext("rep-123").firestore();
    const docRef = repDb.collection("sampleAllocations").doc("alloc-777");
    await assertFails(docRef.set({ repId: "rep-123", allocatedQuantity: 10000 }));
  });

  test("Payload 6: Rep should FAIL to skip approval state on sample requests", async () => {
    const repDb = testEnv.authenticatedContext("rep-123").firestore();
    const docRef = repDb.collection("sampleRequests").doc("req-888");
    await assertFails(docRef.set({ repId: "rep-123", status: "Dispatched" }));
  });

  test("Payload 7: Unassigned user should FAIL to register active territory", async () => {
    const repDb = testEnv.authenticatedContext("rep-123").firestore();
    const docRef = repDb.collection("userTerritoryAssignments").doc("ass-333");
    await assertFails(docRef.set({ userId: "rep-123", status: "Active" }));
  });

  test("Payload 8: Rep should FAIL to alter order status to Paid directly", async () => {
    const repDb = testEnv.authenticatedContext("rep-123").firestore();
    const docRef = repDb.collection("orders").doc("order-111");
    await assertFails(docRef.set({ total: 99999, status: "Paid", salesRep: "rep-123" }));
  });

  test("Payload 9: Rep should FAIL to directly adjust warehouse inventory items", async () => {
    const repDb = testEnv.authenticatedContext("rep-123").firestore();
    const docRef = repDb.collection("sampleInventory").doc("inv-item-444");
    await assertFails(docRef.set({ qty: 500000 }));
  });

  test("Payload 11: Rep should FAIL to edit pharmacy balance sheet directly", async () => {
    const repDb = testEnv.authenticatedContext("rep-123").firestore();
    const docRef = repDb.collection("pharmacies").doc("PHARM-222");
    await assertFails(docRef.set({ outstandingBalance: 0 }));
  });

  test("Payload 12: Normal rep should FAIL to approve KOL sponsorships", async () => {
    const repDb = testEnv.authenticatedContext("rep-123").firestore();
    const docRef = repDb.collection("kolSponsorships").doc("spons-555");
    await assertFails(docRef.set({ amount: 25000, status: "Approved" }));
  });
});
```
