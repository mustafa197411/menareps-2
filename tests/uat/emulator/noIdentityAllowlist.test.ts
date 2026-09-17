import { readFileSync, readdirSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CANONICAL_USER_ROLES } from "../../../src/types";
import { UAT_IDENTITIES } from "./roles";

const RUNTIME_PATHS = ["src", "server", "server.ts", "firestore.rules", "storage.rules"];
const ALLOWED_OWNERSHIP = /(auth\.uid|request\.auth\.uid).{0,80}(userId|repId|createdBy|ownerId)|(userId|repId|createdBy|ownerId).{0,80}(auth\.uid|request\.auth\.uid)/;

function sourceFiles(path: string): string[] {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap(entry => sourceFiles(`${path}/${entry}`));
}

describe("MENAREPS emulator harness identity-generic authorization", () => {
  it("covers every canonical role once", () => {
    expect(CANONICAL_USER_ROLES).toHaveLength(24);
    expect(UAT_IDENTITIES.map(identity => identity.role)).toEqual(CANONICAL_USER_ROLES);
  });

  it("contains no identity-based privilege grant in active runtime sources", () => {
    const files = RUNTIME_PATHS.flatMap(sourceFiles).filter(file => /\.(ts|tsx|js|mjs|cjs|rules)$/.test(file));
    const prohibited: string[] = [];
    const identityLiteralGrant = /(?:\b|\.)(uid|email|name)\s*(===|==)\s*["'][^"']+["']|["'][^"']+["']\s*(===|==)\s*[^\n]{0,40}\.(uid|email|name)|(uid|email)\s*\.includes\(\s*["']/i;
    const hardCodedUid = /["'](?=[A-Za-z0-9]{25,128}["'])(?=[A-Za-z0-9]*[A-Z])(?=[A-Za-z0-9]*[a-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{25,128}["']/;
    for (const file of files) {
      if (/\.test\.|\/tests?\/|test[-_]|uat|fixture|migration|backup|rollback|certification/i.test(file)) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        if ((identityLiteralGrant.test(line) || hardCodedUid.test(line)) && !ALLOWED_OWNERSHIP.test(line) && /allow|role|admin|access|permission|authoriz|privilege/i.test(line)) prohibited.push(`${file}:${index + 1}`);
      });
    }
    expect(prohibited, `Identity privilege candidates: ${prohibited.join(", ")}`).toEqual([]);
  });
});
