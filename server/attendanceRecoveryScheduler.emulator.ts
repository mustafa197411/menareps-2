import assert from "node:assert/strict";
import { assertProductionIsolation } from "../tests/uat/emulator/preflight";
import { getFirebaseAdminServices } from "./firebaseAdmin";
import { executeScheduledAttendanceRecovery } from "./attendanceRecoveryService";

assertProductionIsolation();
const { db } = getFirebaseAdminServices();
const sessionId = "WP95-CONCURRENT-RECOVERY";
const ref = db.collection("attendanceSessions").doc(sessionId);
await ref.set({
  id: sessionId, userId: "uat-medical-rep-west-a", marketId: "LY", countryId: "LY", date: "2026-08-21", timezone: "Africa/Tripoli",
  scheduledStart: "2026-08-21T06:00:00.000Z", scheduledEnd: "2026-08-21T14:00:00.000Z", actualCheckIn: "2026-08-21T06:01:00.000Z",
  status: "OPEN", createdBy: "uat-medical-rep-west-a", createdAt: "2026-08-21T06:01:00.000Z", updatedBy: "uat-medical-rep-west-a", updatedAt: "2026-08-21T06:01:00.000Z",
});
try {
  const results = await Promise.all([executeScheduledAttendanceRecovery("2026-08-21T16:00:00.000Z"), executeScheduledAttendanceRecovery("2026-08-21T16:00:00.000Z")]);
  assert.equal(results.reduce((sum, result) => sum + result.processed, 0), 1);
  const persisted = (await ref.get()).data();
  assert.equal(persisted?.status, "AUTO_CHECKED_OUT");
  assert.equal(persisted?.checkoutMode, "AUTO");
  assert.equal(persisted?.updatedBy, "ATTENDANCE_SCHEDULER");
  const repeated = await executeScheduledAttendanceRecovery("2026-08-21T16:01:00.000Z");
  assert.equal(repeated.processed, 0);
  console.log("WP95_ATTENDANCE_RECOVERY_CONCURRENCY=PASS");
} finally { await ref.delete(); }
