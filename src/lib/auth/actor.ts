import { createHmac, timingSafeEqual } from "node:crypto";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import type { AppContext } from "@/lib/context";
import { forbidden, unauthorized } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { Role } from "@/types";

export interface Actor {
  user_id: string;
  email: string;
  role: Role;
  sponsor_id: string | null;
}

export const AUTH_COOKIE = "bub_auth";

// ---------------- mock mode (AWS_MOCK_MODE=true only) ----------------

export function signMockToken(ctx: AppContext, userId: string, ttlSeconds = 12 * 3600): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `mock.${userId}.${exp}`;
  const sig = createHmac("sha256", ctx.cfg.sessionSecret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verifyMockToken(ctx: AppContext, token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "mock") return null;
  const [, userId, expStr, sig] = parts;
  const expected = createHmac("sha256", ctx.cfg.sessionSecret).update(`mock.${userId}.${expStr}`).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Number(expStr) < Math.floor(Date.now() / 1000)) return null;
  return userId;
}

// ---------------- Cognito ----------------

let verifier: ReturnType<typeof CognitoJwtVerifier.create<{ userPoolId: string; tokenUse: "id"; clientId: string }>> | null = null;

function cognitoVerifier(ctx: AppContext) {
  if (!verifier) {
    verifier = CognitoJwtVerifier.create({ userPoolId: ctx.cfg.cognito.userPoolId, tokenUse: "id", clientId: ctx.cfg.cognito.clientId });
  }
  return verifier;
}

function extractToken(headers: Record<string, string | undefined>, cookies: Record<string, string>): string | null {
  const auth = headers["authorization"];
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return cookies[AUTH_COOKIE] ?? null;
}

/**
 * Resolves the signed-in dashboard user, or null.
 * Role comes from Cognito groups (ADMIN / SPONSOR). A SPONSOR's sponsor_id comes ONLY from the
 * server-side user mapping (DashboardUser) or the admin-controlled custom:sponsor_id attribute —
 * never from anything the browser sends.
 */
export async function getActor(ctx: AppContext, headers: Record<string, string | undefined>, cookies: Record<string, string>): Promise<Actor | null> {
  const token = extractToken(headers, cookies);
  if (!token) return null;

  if (ctx.cfg.awsMockMode) {
    if (!ctx.cfg.allowMockLogin) return null;
    const userId = verifyMockToken(ctx, token);
    if (!userId) return null;
    const user = await ctx.repo.getDashboardUser(userId);
    return user ? { user_id: user.user_id, email: user.email, role: user.role, sponsor_id: user.sponsor_id } : null;
  }

  if (!ctx.cfg.cognito.userPoolId || !ctx.cfg.cognito.clientId) return null;
  try {
    const payload = await cognitoVerifier(ctx).verify(token);
    const groups = (payload["cognito:groups"] as string[] | undefined) ?? [];
    const sub = payload.sub;
    const email = String(payload.email ?? "");
    const mapping = await ctx.repo.getDashboardUser(sub);
    if (groups.includes("ADMIN")) return { user_id: sub, email, role: "ADMIN", sponsor_id: null };
    if (groups.includes("SPONSOR")) {
      const sponsorId = mapping?.sponsor_id ?? ((payload["custom:sponsor_id"] as string | undefined) || null);
      if (!sponsorId) return null;
      return { user_id: sub, email, role: "SPONSOR", sponsor_id: sponsorId };
    }
    return null;
  } catch (e) {
    logger.debug("auth.verify_failed", { error: (e as Error).message });
    return null;
  }
}

export function requireActor(actor: Actor | null): Actor {
  if (!actor) throw unauthorized();
  return actor;
}

export function requireAdmin(actor: Actor | null): Actor {
  const a = requireActor(actor);
  if (a.role !== "ADMIN") throw forbidden();
  return a;
}

/** Returns the caller's own sponsor_id. Admins are not sponsors and are rejected here too. */
export function requireSponsor(actor: Actor | null): Actor & { sponsor_id: string } {
  const a = requireActor(actor);
  if (a.role !== "SPONSOR" || !a.sponsor_id) throw forbidden();
  return a as Actor & { sponsor_id: string };
}
