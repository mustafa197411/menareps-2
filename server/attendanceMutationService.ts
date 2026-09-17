import { checkInAttendance, manualCheckout, type AttendanceLocation, type AttendanceSession } from "../src/lib/attendanceEngine";
import { resolveBusinessCalendarDay, resolveMarketForIdentity, validateMarketSettings, type BusinessCalendarException, type MarketBusinessSettings } from "../src/lib/marketSettings";
import { getFirebaseAdminServices } from "./firebaseAdmin";

export type AttendanceMutation = { action: "CHECK_IN" | "CHECK_OUT"; occurredAt: string; location: AttendanceLocation };
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value);
export function parseAttendanceMutation(body: unknown): AttendanceMutation | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null; const value = body as Record<string, any>;
  if (Object.keys(value).some(key => !["action", "occurredAt", "location"].includes(key)) || !["CHECK_IN", "CHECK_OUT"].includes(value.action) || !Number.isFinite(Date.parse(value.occurredAt)) || !value.location || !finite(value.location.latitude) || !finite(value.location.longitude)) return null;
  if (Math.abs(value.location.latitude) > 90 || Math.abs(value.location.longitude) > 180 || (value.location.accuracyMeters !== undefined && (!finite(value.location.accuracyMeters) || value.location.accuracyMeters < 0))) return null;
  return { action: value.action, occurredAt: new Date(value.occurredAt).toISOString(), location: { latitude: value.location.latitude, longitude: value.location.longitude, ...(finite(value.location.accuracyMeters) ? { accuracyMeters: value.location.accuracyMeters } : {}) } };
}
const localDate = (iso: string, timezone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
function zonedIso(date: string, time: string, timezone: string): string {
  const [year, month, day] = date.split("-").map(Number); const [hour, minute] = time.split(":").map(Number); let guess = Date.UTC(year, month - 1, day, hour, minute);
  for (let attempt = 0; attempt < 3; attempt++) { const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(guess)); const map = Object.fromEntries(parts.map(part => [part.type, part.value])); const represented = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(map.hour) % 24, Number(map.minute)); guess += Date.UTC(year, month - 1, day, hour, minute) - represented; }
  return new Date(guess).toISOString();
}
export async function executeAttendanceMutation(actorUid: string, request: AttendanceMutation) {
  const { db } = getFirebaseAdminServices(); const actorSnap = await db.collection("users").doc(actorUid).get();
  if (!actorSnap.exists) return { success: false, code: "ACTOR_NOT_FOUND" }; const actor = actorSnap.data() as Record<string, any>;
  if (actor.active === false || actor.status === "Inactive") return { success: false, code: "ACTOR_INACTIVE" };
  const marketsSnap = await db.collection("marketSettings").where("active", "==", true).get(); const markets = marketsSnap.docs.map(doc => ({ marketId: doc.id, ...doc.data() } as MarketBusinessSettings));
  const market = resolveMarketForIdentity(markets, actor); if (!market || validateMarketSettings(market).length) return { success: false, code: "MARKET_CONFIGURATION_REQUIRED" };
  const date = localDate(request.occurredAt, market.timezone); const sessionId = `${actorUid}:${date}`; const ref = db.collection("attendanceSessions").doc(sessionId);
  const exceptionsSnap = await db.collection("businessCalendarExceptions").where("marketId", "==", market.marketId).where("date", "==", date).get(); const exceptions = exceptionsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as BusinessCalendarException));
  if (!resolveBusinessCalendarDay(date, market, exceptions, text(actor.regionId || actor.region)).scheduledWorkingDay) return { success: false, code: "NON_WORKING_DAY" };
  return db.runTransaction(async transaction => { const snapshot = await transaction.get(ref); const existing = snapshot.exists ? ({ id: snapshot.id, ...snapshot.data() } as AttendanceSession) : null;
    if (request.action === "CHECK_IN") { if (existing) return { success: false, code: "DUPLICATE_CHECK_IN" }; const session = checkInAttendance({ id: sessionId, userId: actorUid, marketId: market.marketId, countryId: market.countryId, date, timezone: market.timezone, scheduledStart: zonedIso(date, market.normalWorkdayStart, market.timezone), scheduledEnd: zonedIso(date, market.normalWorkdayEnd, market.timezone), actualCheckIn: request.occurredAt, checkInLocation: request.location, createdBy: actorUid, createdAt: request.occurredAt, updatedBy: actorUid, updatedAt: request.occurredAt }, market.lateToleranceMinutes); transaction.create(ref, session); return { success: true, session }; }
    if (!existing) return { success: false, code: "OPEN_SESSION_NOT_FOUND" }; if (existing.actualCheckOut || existing.checkoutMode) return { success: false, code: "ALREADY_CHECKED_OUT" }; const session = manualCheckout(existing, request.occurredAt, request.location); transaction.set(ref, session, { merge: false }); return { success: true, session };
  });
}
