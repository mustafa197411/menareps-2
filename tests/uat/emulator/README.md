# MENAREPS local UAT/security regression harness

This harness is restricted to the Firebase Auth, Firestore, and Storage emulators under the exact namespace `demo-menareps-uat`. It never imports production data or credentials.

## Safety model

- `preflight.ts` verifies the certified rules at commit `0915da491745a474e3e826c069d0f3a8a5592a5b` and their pinned SHA-256 hashes.
- All Firebase endpoints must be exact IPv4 loopback addresses.
- Production-capable credential environment variables are rejected.
- Frontend and backend project/database variables are pinned to the demo namespace; both Firebase Storage emulator host forms are pinned to loopback.
- The frontend connects to emulators only when `VITE_MENAREPS_EMULATOR_MODE=true`; the guard then requires the exact demo project and endpoints.
- Synthetic identities use the reserved `.test` domain and generated per-run passwords.
- Every run clears, seeds, certifies, and clears the emulator namespace.

## Commands

The full suite must only be started through:

```bash
FIREBASE_CLI_DISABLE_UPDATE_CHECK=1 npx --no-install firebase-tools emulators:exec \
  --only auth,firestore,storage \
  --project demo-menareps-uat \
  --config firebase.uat.json \
  "npm run uat:emulator:certify"
```

Focused scripts are documented in `package.json`. They require all three emulators and the environment produced by the certification orchestrator.

Do not replace the demo project, remove the explicit config, import production exports, or configure service-account credentials.
