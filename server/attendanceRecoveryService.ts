import { autoCheckoutOpenSession, type AttendanceSession } from "../src/lib/attendanceEngine";
import { marketDateForInstant, marketTimeForInstant, validateMarketSettings, type MarketBusinessSettings } from "../src/lib/marketSettings";
import { getFirebaseAdminServices } from "./firebaseAdmin";

export interface AttendanceRecoveryRepository {
  getActor(uid: string): Promise<{ role?: string; active?: boolean } | null>;
  getMarket(marketId: string): Promise<MarketBusinessSettings | null>;
  getActiveMarkets(): Promise<MarketBusinessSettings[]>;
  getOpenSessions(marketId: string, throughDate: string): Promise<AttendanceSession[]>;
  recoverOpenSession(id: string, market: MarketBusinessSettings, executedAt: string): Promise<boolean>;
}
const DATE = /^\d{4}-\d{2}-\d{2}$/; const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const previousDate = (date: string) => { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() - 1); return value.toISOString().slice(0, 10); };

export function parseAttendanceRecoveryRequest(body: unknown): { marketId: string; throughDate: string; executedAt: string } | null { if (!body || typeof body !== "object" || Array.isArray(body)) return null; const value = body as Record<string, unknown>; if (Object.keys(value).some(key => !["marketId", "throughDate", "executedAt"].includes(key))) return null; const marketId = text(value.marketId), throughDate = text(value.throughDate), executedAt = text(value.executedAt); return marketId && DATE.test(throughDate) && Number.isFinite(Date.parse(executedAt)) ? { marketId, throughDate, executedAt } : null; }

export function attendanceRecoveryThroughDate(executedAt: string, market: MarketBusinessSettings): string {
  const currentDate = marketDateForInstant(executedAt, market.timezone);
  return marketTimeForInstant(executedAt, market.timezone) >= market.autoCheckoutAt ? currentDate : previousDate(currentDate);
}

export function createFirestoreAttendanceRecoveryRepository(): AttendanceRecoveryRepository { const { db } = getFirebaseAdminServices(); return {
  async getActor(uid) { const snap = await db.collection("users").doc(uid).get(); return snap.exists ? snap.data() as any : null; },
  async getMarket(id) { const snap = await db.collection("marketSettings").doc(id).get(); return snap.exists ? ({ marketId: snap.id, ...snap.data() } as MarketBusinessSettings) : null; },
  async getActiveMarkets() { const snap = await db.collection("marketSettings").where("active", "==", true).get(); return snap.docs.map(doc => ({ marketId: doc.id, ...doc.data() } as MarketBusinessSettings)); },
  async getOpenSessions(marketId, throughDate) { const snap = await db.collection("attendanceSessions").where("marketId", "==", marketId).where("status", "==", "OPEN").where("date", "<=", throughDate).get(); return snap.docs.map(item => ({ id: item.id, ...item.data() } as AttendanceSession)); },
  async recoverOpenSession(id, market, executedAt) { const ref = db.collection("attendanceSessions").doc(id); return db.runTransaction(async transaction => { const snapshot = await transaction.get(ref); if (!snapshot.exists) return false; const session = { id: snapshot.id, ...snapshot.data() } as AttendanceSession; if (session.status !== "OPEN" || session.marketId !== market.marketId || session.actualCheckOut || session.checkoutMode) return false; const recovered = autoCheckoutOpenSession(session, executedAt, market.maximumWorkdayMinutes); if (recovered.status === "OPEN") return false; transaction.set(ref, { ...recovered, updatedBy: "ATTENDANCE_SCHEDULER", updatedAt: executedAt }, { merge: false }); return true; }); },
}; }

async function recoverMarket(market: MarketBusinessSettings, throughDate: string, executedAt: string, repository: AttendanceRecoveryRepository): Promise<number> {
  const sessions = await repository.getOpenSessions(market.marketId, throughDate); let processed = 0;
  for (const session of sessions) if (session.date <= throughDate && await repository.recoverOpenSession(session.id, market, executedAt)) processed++;
  return processed;
}

export async function executeAttendanceRecovery(actorUid: string, request: { marketId: string; throughDate: string; executedAt: string }, repository: AttendanceRecoveryRepository = createFirestoreAttendanceRecoveryRepository()) { const actor = await repository.getActor(actorUid); if (!actor || actor.active === false || !["Admin", "Super Admin"].includes(text(actor.role))) return { success: false, code: "ATTENDANCE_RECOVERY_DENIED", processed: 0 }; const market = await repository.getMarket(request.marketId); if (!market || !market.active) return { success: false, code: "MARKET_NOT_FOUND", processed: 0 }; const eligibleThroughDate = attendanceRecoveryThroughDate(request.executedAt, market); return { success: true, processed: await recoverMarket(market, request.throughDate < eligibleThroughDate ? request.throughDate : eligibleThroughDate, request.executedAt, repository) }; }

export async function executeScheduledAttendanceRecovery(executedAt: string, repository: AttendanceRecoveryRepository = createFirestoreAttendanceRecoveryRepository()) {
  if (!Number.isFinite(Date.parse(executedAt))) return { success: false, code: "INVALID_ATTENDANCE_RECOVERY_CLOCK", processed: 0, markets: 0 };
  const markets = (await repository.getActiveMarkets()).filter(market => market.active && validateMarketSettings(market).length === 0);
  let processed = 0; for (const market of markets) processed += await recoverMarket(market, attendanceRecoveryThroughDate(executedAt, market), executedAt, repository);
  return { success: true, processed, markets: markets.length };
}
