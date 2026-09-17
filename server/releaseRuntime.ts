export interface ReleaseRuntimeIdentity {
  production: boolean;
  port: number;
  releaseId: string;
  gitCommit: string;
  buildTimestamp: string;
  cloudRunRevision: string;
  finalS2Fingerprint: string;
}

type RuntimeEnvironment = Record<string, string | undefined>;

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`RELEASE_RUNTIME_REQUIRED:${name}`);
  return normalized;
}

function port(value: string | undefined): number {
  if (!value?.trim()) return 3000;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("RELEASE_RUNTIME_INVALID:PORT");
  }
  return parsed;
}

export function resolveReleaseRuntime(env: RuntimeEnvironment): ReleaseRuntimeIdentity {
  const production = env.NODE_ENV === "production";
  const releaseId = production ? required(env.MENAREPS_RELEASE_ID, "MENAREPS_RELEASE_ID") : env.MENAREPS_RELEASE_ID?.trim() || "development";
  const gitCommit = production ? required(env.MENAREPS_GIT_COMMIT, "MENAREPS_GIT_COMMIT") : env.MENAREPS_GIT_COMMIT?.trim() || "development";
  return {
    production,
    port: port(env.PORT),
    releaseId,
    gitCommit,
    buildTimestamp: env.MENAREPS_BUILD_TIMESTAMP?.trim() || "not-injected",
    cloudRunRevision: env.K_REVISION?.trim() || "local",
    finalS2Fingerprint: env.MENAREPS_FINAL_S2_FINGERPRINT?.trim() || "not-injected",
  };
}

export function assertProductionAssets(runtime: ReleaseRuntimeIdentity, hasIndex: boolean): void {
  if (runtime.production && !hasIndex) throw new Error("RELEASE_RUNTIME_REQUIRED:DIST_INDEX");
}
