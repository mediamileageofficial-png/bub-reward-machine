import { createHash, randomBytes } from "node:crypto";
import type { AppContext } from "@/lib/context";
import { AppError, badRequest } from "@/lib/errors";

/**
 * Cognito Hosted UI — OAuth 2.0 authorization-code flow with PKCE.
 * The ID token is kept in an httpOnly cookie and verified server-side on every request.
 */

export const OAUTH_COOKIE = "bub_oauth";

export function safeNextPath(raw: unknown, fallback = "/admin"): string {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return fallback;
  return raw.slice(0, 200);
}

export function buildLoginRedirect(ctx: AppContext, next: string) {
  const { domain, clientId } = ctx.cfg.cognito;
  if (!domain || !clientId) throw new AppError(500, "COGNITO_NOT_CONFIGURED", "Cognito is not configured (COGNITO_DOMAIN / COGNITO_CLIENT_ID).");
  const state = randomBytes(16).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: `${ctx.cfg.appBaseUrl}/api/auth/callback`,
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return {
    url: `${domain}/oauth2/authorize?${params.toString()}`,
    cookieValue: `${state}.${verifier}.${Buffer.from(next).toString("base64url")}`,
  };
}

export async function exchangeCode(ctx: AppContext, code: string, cookieValue: string | undefined, state: string | null) {
  const [expectedState, verifier, nextB64] = (cookieValue ?? "").split(".");
  if (!expectedState || !verifier || !state || state !== expectedState) throw badRequest("OAUTH_STATE", "Sign-in expired. Please try again.");
  const { domain, clientId, clientSecret } = ctx.cfg.cognito;
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (clientSecret) headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  const res = await fetch(`${domain}/oauth2/token`, {
    method: "POST",
    headers,
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code, redirect_uri: `${ctx.cfg.appBaseUrl}/api/auth/callback`, code_verifier: verifier }).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as { id_token?: string; expires_in?: number };
  if (!res.ok || !json.id_token) throw new AppError(401, "OAUTH_EXCHANGE_FAILED", "Sign-in failed. Please try again.");
  return { idToken: json.id_token, expiresIn: json.expires_in ?? 3600, next: safeNextPath(Buffer.from(nextB64 ?? "", "base64url").toString()) };
}

export function logoutUrl(ctx: AppContext): string | null {
  const { domain, clientId } = ctx.cfg.cognito;
  if (!domain || !clientId) return null;
  return `${domain}/logout?${new URLSearchParams({ client_id: clientId, logout_uri: `${ctx.cfg.appBaseUrl}/` }).toString()}`;
}
