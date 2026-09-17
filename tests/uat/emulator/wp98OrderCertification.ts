import { uatEnvironment } from "./constants";

Object.assign(process.env, uatEnvironment("wp98-local-synthetic-certification-secret-000000000000000000000000"));
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
delete process.env.FIREBASE_TOKEN;
await import("../../../server/pharmacyOrderCreateService.emulator");
