import type { NextFunction, Request, Response } from "express";
import { OAuth2Client, type TokenPayload } from "google-auth-library";

export interface SchedulerAuthenticatedRequest extends Request { schedulerPrincipal?: string }
export type SchedulerTokenVerifier = (token: string, audience: string) => Promise<TokenPayload | undefined>;

const bearer = (header: string | undefined): string | null => {
  if (!header) return null;
  const match = /^Bearer ([^\s]+)$/.exec(header);
  return match?.[1] || null;
};

export async function verifyAttendanceSchedulerRequest(
  authorization: string | undefined,
  config: { audience?: string; serviceAccountEmail?: string },
  verify: SchedulerTokenVerifier,
): Promise<{ authorized: true; principal: string } | { authorized: false; code: string }> {
  const audience = config.audience?.trim(); const expectedEmail = config.serviceAccountEmail?.trim().toLowerCase();
  if (!audience || !expectedEmail) return { authorized: false, code: "ATTENDANCE_SCHEDULER_AUTH_NOT_CONFIGURED" };
  const token = bearer(authorization);
  if (!token) return { authorized: false, code: "ATTENDANCE_SCHEDULER_AUTH_REQUIRED" };
  try {
    const payload = await verify(token, audience);
    const email = payload?.email?.trim().toLowerCase();
    if (!email || email !== expectedEmail || payload?.email_verified !== true) return { authorized: false, code: "ATTENDANCE_SCHEDULER_AUTH_DENIED" };
    return { authorized: true, principal: email };
  } catch { return { authorized: false, code: "ATTENDANCE_SCHEDULER_AUTH_DENIED" }; }
}

const oauth = new OAuth2Client();
export async function requireAttendanceSchedulerAuth(req: SchedulerAuthenticatedRequest, res: Response, next: NextFunction) {
  const result = await verifyAttendanceSchedulerRequest(req.headers.authorization, {
    audience: process.env.ATTENDANCE_SCHEDULER_AUDIENCE,
    serviceAccountEmail: process.env.ATTENDANCE_SCHEDULER_SERVICE_ACCOUNT_EMAIL,
  }, async (token, audience) => (await oauth.verifyIdToken({ idToken: token, audience })).getPayload());
  if ("code" in result) return res.status(result.code.endsWith("NOT_CONFIGURED") ? 503 : 401).json({ success: false, code: result.code, processed: 0 });
  req.schedulerPrincipal = result.principal;
  return next();
}
