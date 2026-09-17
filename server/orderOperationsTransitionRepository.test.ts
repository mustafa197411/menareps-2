import { describe, expect, it } from "vitest";
import fs from "node:fs";

describe("Order Operations Firestore repository contract", () => {
  it("uses a Firestore transaction and document reads", () => {
    const source = fs.readFileSync(new URL("./orderOperationsTransitionRepository.ts", import.meta.url), "utf8");
    expect(source).toContain("db.runTransaction");
    expect(source).toContain("transaction.get(orderRef)");
  });
  it("uses Firestore updateTime as the version token", () => expect(fs.readFileSync(new URL("./orderOperationsTransitionRepository.ts", import.meta.url), "utf8")).toContain("snapshot.updateTime"));
  it("writes a merge patch and audit in the same transaction", () => {
    const source = fs.readFileSync(new URL("./orderOperationsTransitionRepository.ts", import.meta.url), "utf8");
    expect(source).toContain("transaction.set(orderRef, patch, { merge: true })");
    expect(source).toContain('db.collection("auditLogs").doc(audit.id)');
  });
});
