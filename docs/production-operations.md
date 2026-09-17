# MENAREPS production operations contract

This runbook defines prerequisites and operator actions. It does not authorize or execute any cloud mutation.

## Backup and restore

### Required before deployment

- Enable Firestore point-in-time recovery for the canonical production database and verify its retention window.
- Create a named pre-release Firestore export in a restricted, versioned backup bucket before any deployment that changes Rules, indexes, schema expectations, or authoritative writes.
- Record the release ID, Git commit, database ID, export URI, export completion status, and object generation in the release record.
- Verify the Cloud Run service configuration and prior serving revision are recorded before traffic changes.

### Required before go-live

- Enable scheduled Firestore exports with retention appropriate to the organization’s recovery objectives.
- Enable Cloud Storage object versioning or soft delete and a documented retention/lifecycle policy for the production media bucket and backup bucket.
- Perform a restore drill into a dedicated non-production project/database and verify representative documents, audit lineage, order history, and protected media. Never test restore into production.
- Assign named operators for backup verification, restore authorization, and incident command.

### Optional post-go-live

- Automate restore-drill evidence collection and backup-age dashboards after the first manual drill is accepted.

An export is not considered a backup until its operation completed successfully, the destination objects exist, access is restricted, and a non-production restore has been demonstrated.

## Release and rollback

Before enabling traffic, record the candidate and previous Cloud Run revision, container/build identity, release ID, Git commit, Firebase project/database, Rules release, index manifest commit, and backup reference.

Rollback criteria include startup/readiness failure, sustained 5xx errors, authorization regression, missing-index errors, transaction/data-integrity failures, Scheduler recovery failure, or incorrect release identity.

1. Stop the rollout and preserve diagnostics; do not mutate application data to hide a failed release.
2. Route traffic back to the recorded previous healthy Cloud Run revision.
3. Verify `/api/health`, `/api/ready`, `/api/runtime-identity`, authentication, and one governed read on the restored revision.
4. Rules rollback uses the exact previously approved `firestore.rules` artifact. Do not weaken Rules as an emergency workaround.
5. Index rollback uses the previous manifest only after query compatibility and index deletion impact are reviewed. A newly required index should normally remain while application traffic is rolled back.
6. Data/schema migrations require their own reversible plan and pre-migration export. This release performs no migration.
7. Record timeline, impact, operator actions, evidence, and follow-up owner in the incident record.

## Attendance recovery Scheduler

The required job contract is captured in `ops/attendance-scheduler.template.yaml`.

- Method/path: `POST /api/internal/attendance/recover` with an empty JSON object.
- Authentication: Google-signed OIDC ID token.
- Audience: the exact configured `ATTENDANCE_SCHEDULER_AUDIENCE`, matching the template and deployed HTTPS endpoint identity.
- Principal: a dedicated service account whose email exactly matches `ATTENDANCE_SCHEDULER_SERVICE_ACCOUNT_EMAIL`.
- Least privilege: no Firebase Admin, Firestore, Storage, project Editor, or application UI role. Grant only invocation permission if required by the service IAM model.
- Frequency: hourly; the service evaluates every active market using persisted timezone and `autoCheckoutAt` settings.
- Retries: bounded exponential retry. Recovery transactions re-read open sessions and are idempotent, so repeated delivery cannot create a second checkout transition.
- Success evidence: HTTP 200 plus structured `ATTENDANCE_SCHEDULER_RECOVERY` output containing processed and market counts.
- Failure evidence: non-2xx request log or `ATTENDANCE_SCHEDULER_RECOVERY_ERROR`/authentication failure status.

Do not create the job until the candidate Cloud Run revision, OIDC audience, and dedicated service-account ownership have been approved.

## Monitoring and alerts

Create the following production alert policies before go-live. Route every alert to the documented on-call channel and include release/revision labels.

| Signal | Minimum condition | Evidence/source |
| --- | --- | --- |
| Cloud Run errors | 5xx rate or count above accepted baseline | Cloud Run request metric/logs |
| Latency | sustained high p95/p99 latency | Cloud Run request latency |
| Readiness/startup | readiness non-200 or startup failure | `/api/ready`, `MENAREPS_STARTUP_FAILED` |
| Release identity | expected release/commit/project/database mismatch | `/api/runtime-identity`, `/api/ready` |
| Authentication | abnormal 401/503 rate | API request logs, `AUTH MIDDLEWARE` codes |
| Authorization | abnormal 403/denial-code rate | API request logs and canonical denial codes |
| Firestore indexes/transactions | missing-index, aborted, contention, or transaction errors | Cloud Run application logs and Firestore metrics |
| Attendance recovery | Scheduler non-2xx, no successful hourly run, or recovery error | Scheduler execution logs, `ATTENDANCE_SCHEDULER_RECOVERY*` |
| Order workflow | transition endpoint 4xx/5xx anomaly or transition exception | workflow route logs and response codes |
| Invoice posting | delivered-invoice posting failure or ledger transaction error | invoice-posting route/application logs |
| Audit ledger | audit endpoint failure | `Trusted Audit Backend Error` and request metrics |
| Storage policy | denied-write anomaly or unexpected object growth | Cloud Audit Logs and Storage metrics |
| Backup freshness | missing/failed export or backup older than policy | Firestore export operation and bucket-object metrics |

Exact numeric thresholds and notification destinations are deployment configuration owned by operations; they must be documented in the release record before go-live.

## Incident response checklist

1. Declare severity, incident commander, affected release/revision, start time, and impacted modules.
2. Preserve Cloud Run, Scheduler, Firebase, Storage, and audit evidence; do not expose tokens or secret values.
3. Verify runtime identity and determine whether the failure is configuration, code, dependency, authorization, or data integrity.
4. Contain by stopping rollout or rolling traffic back. Disable a Scheduler job only when it is the identified source of harm and record the action.
5. Restore data only from a verified backup into non-production first; production restore requires explicit incident authorization.
6. Validate recovery through health/readiness, governed reads, audit lineage, and affected workflow checks.
7. Record root cause, recovery point/time achieved, remaining risk, and corrective owner.
