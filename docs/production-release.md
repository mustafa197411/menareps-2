# MENAREPS production release contract

MENAREPS is deployed to Cloud Run with the Node.js 22 buildpack contract declared in `package.json` and `.nvmrc`.

## Reproducible build and start

1. Build with `npm ci && npm run build`.
2. Start with `npm start`. The start script sets `NODE_ENV=production` and binds to Cloud Run's `PORT` (default `3000` for local production verification).
3. Configure the Cloud Run startup probe to `GET /api/health` and the readiness probe to `GET /api/ready`.

The process initializes Firebase Admin before binding its port. Invalid Firebase identity, release identity, or Admin initialization prevents the revision from accepting traffic.

## Required runtime environment

| Variable | Required | Secret | Purpose |
| --- | --- | --- | --- |
| `FIREBASE_PROJECT_ID` | yes | no | Explicit canonical Firebase project identity |
| `FIRESTORE_DATABASE_ID` | yes | no | Explicit canonical Firestore database identity |
| `MENAREPS_RELEASE_ID` | yes | no | Immutable release identifier |
| `MENAREPS_GIT_COMMIT` | yes | no | Exact source commit deployed |
| `PORT` | supplied by Cloud Run | no | HTTP listener port |
| `MENAREPS_BUILD_TIMESTAMP` | optional | no | Build provenance timestamp |
| `VITE_GIT_COMMIT` | yes at build time | no | Must equal `MENAREPS_GIT_COMMIT` for the same release; never reuse an inherited service-level value |
| `VITE_BUILD_TIMESTAMP` | recommended at build time | no | Frontend build timestamp for release correlation |
| `GEMINI_API_KEY` | optional | yes | Enables governed AI features; absence leaves those features unavailable |

Application Default Credentials are supplied by the Cloud Run service account. Do not configure emulator host variables on a production revision. Frontend `VITE_FIREBASE_*` configuration is injected at build time and must match the committed/runtime Firebase identity checks.

Before every source deployment, explicitly set `VITE_GIT_COMMIT` from the exact commit being packaged and set `MENAREPS_GIT_COMMIT` to the same value. Do not rely on an existing Cloud Run service build-environment annotation: source deploys can inherit stale `VITE_*` values. A candidate is not certifiable when `[MENAREPS_BUILD_IDENTITY_JSON].gitCommit` differs from `/api/runtime-identity.gitCommit`; the frontend also emits `[MENAREPS_BUILD_RUNTIME_IDENTITY_MISMATCH]` so the mismatch cannot remain silent.

## Release verification

- Complete the backup, rollback, monitoring, and incident prerequisites in `docs/production-operations.md`.
- Confirm the Firestore index manifest is applied before traffic is enabled.
- Confirm `/api/health` returns `200` for liveness.
- Confirm `/api/ready` returns `200` and the expected release, commit, project, and database identities.
- Confirm `/api/runtime-identity` matches the candidate revision and contains no `not-injected` release or commit identity.
- Confirm the browser build identity commit equals `/api/runtime-identity.gitCommit` and that no build/runtime mismatch diagnostic is emitted.
- Keep the prior Cloud Run revision available until smoke verification completes; rollback is a traffic change to that known revision.

This file is a deployment contract only. It does not deploy indexes, services, IAM, Scheduler jobs, or traffic.
