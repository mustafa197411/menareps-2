import fs from "node:fs";
import { assertProductionSnapshotIdentity, validateProductionReadiness, type ProductionReadinessSnapshot } from "./productionReadinessValidator";

const argument = (name: string): string => {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1]?.trim() : "";
  if (!value) throw new Error(`PRODUCTION_VALIDATION_ARGUMENT_REQUIRED:${name}`);
  return value;
};

try {
  const snapshotPath = argument("--snapshot");
  const projectId = argument("--project");
  const databaseId = argument("--database");
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as ProductionReadinessSnapshot;
  assertProductionSnapshotIdentity(snapshot.metadata, projectId, databaseId);
  const report = validateProductionReadiness(snapshot);
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "PASS") process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ status: "FAIL", code: error instanceof Error ? error.message : "PRODUCTION_VALIDATION_FAILED" }));
  process.exitCode = 1;
}
