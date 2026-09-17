export interface FrontendFirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  databaseId: string;
}

export function resolveFrontendFirebaseConfig(input: {
  production: boolean;
  env: Record<string, string | undefined>;
  bundled: Record<string, string | undefined>;
}): FrontendFirebaseConfig {
  const source = input.production ? input.env : { ...input.bundled, ...Object.fromEntries(Object.entries(input.env).filter(([, value]) => Boolean(value))) };
  const names = ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId", "databaseId"] as const;
  const output: Record<string, string> = {};
  for (const name of names) {
    const value = source[name]?.trim();
    if (!value) throw new Error(`FIREBASE_FRONTEND_CONFIG_REQUIRED:${name}`);
    output[name] = value;
  }
  if (input.production) {
    if (input.bundled.projectId?.trim() && input.bundled.projectId.trim() !== output.projectId) {
      throw new Error("FIREBASE_FRONTEND_PROJECT_MISMATCH");
    }
    const bundledDatabaseId = input.bundled.databaseId?.trim();
    if (bundledDatabaseId && bundledDatabaseId !== output.databaseId) {
      throw new Error("FIREBASE_FRONTEND_DATABASE_MISMATCH");
    }
  }
  return output as unknown as FrontendFirebaseConfig;
}
