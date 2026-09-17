import { configDefaults, defineConfig } from "vitest/config";

// These files are executable regression/UAT/emulator scripts, not Vitest suites.
// Keep them independently runnable through their dedicated npm scripts or tsx.
const standaloneRegressionScripts = [
  "server/organizationalHierarchyService.test.ts",
  "src/appRender.test.ts",
  "src/auth_activation_claim.test.ts",
  "src/hierarchyRules.test.ts",
  "src/hierarchyService.test.ts",
  "src/onboardingLifecycle.test.ts",
  "src/performanceCertification.test.ts",
  "src/pharmacyImport.test.ts",
  "src/productAssignment.test.ts",
  "src/productTargetFoundation.test.ts",
  "src/productTargetLifecycle.test.ts",
  "src/rules.test.ts",
  "src/sampleRules.test.ts",
  "src/visitMarketingRequestRules.test.ts",
  "src/targetCalculation.test.ts",
  "src/targetImport.test.ts",
  "src/userImport.test.ts",
  "src/wp52cg_certification.test.ts",
  "src/wp52d2_lifecycle.test.ts",
  "src/wp52f2_uat.test.ts",
  "src/wp75a.test.ts",
  "src/wp75b.test.ts",
  "src/wp75c.test.ts",
  "src/wp7_1a_order_officer.test.ts",
  "src/wp7_1b_order_officer.test.ts",
  "src/lib/productTargetResolver.test.ts",
  "src/features/orders/exportEngine.test.ts",
  "tests/uat/emulator/firestoreSecurity.test.ts",
  "tests/uat/emulator/ap2qFirestoreCanonicalFieldSecurity.test.ts",
  "tests/uat/emulator/storageSecurity.test.ts",
  "tests/uat/emulator/routeAuthorization.test.ts",
  "tests/uat/emulator/authPersistence.spec.ts",
  "tests/uat/emulator/navigation.spec.ts",
  "tests/uat/emulator/settingsVisibility.spec.ts",
  "tests/uat/emulator/scopeIsolation.spec.ts",
  "tests/uat/emulator/**/*.spec.ts",
  "tests/uat/emulator/medicalE2EContract.test.ts",
];

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, ...standaloneRegressionScripts],
  },
});
