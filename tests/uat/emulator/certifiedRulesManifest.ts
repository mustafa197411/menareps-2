import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { UAT_RULE_HASHES, UAT_RULES_CANDIDATE } from "./constants";

export function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function verifyCertifiedRules(): void {
  for (const [file, expected] of [
    ["firestore.rules", UAT_RULE_HASHES.firestore],
    ["storage.rules", UAT_RULE_HASHES.storage],
  ] as const) {
    const local = readFileSync(file);
    if (sha256(local) !== expected) {
      throw new Error(`[MENAREPS UAT] ${file} does not match rules candidate ${UAT_RULES_CANDIDATE}.`);
    }
  }
}
