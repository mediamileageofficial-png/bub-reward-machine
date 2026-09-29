import type { AppContext } from "@/lib/context";
import { AppError, tooMany } from "@/lib/errors";
import { logger } from "@/lib/logger";

/** Framework-neutral request/response so the same handlers run in Next.js routes and AWS Lambda. */
export interface ApiRequest {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  headers: Record<string, string | undefined>; // lower-cased keys
  cookies: Record<string, string>;
  ip: string;
}

export interface SetCookie {
  name: string;
  value: string;
  maxAge: number; // seconds; 0 clears
  httpOnly?: boolean;
  path?: string;
}

export interface ApiResponse {
  status: number;
  body?: unknown;
  text?: string;
  contentType?: string;
  headers?: Record<string, string>;
  cookies?: SetCookie[];
  redirect?: string;
}

export type Handler = (req: ApiRequest, ctx: AppContext) => Promise<ApiResponse>;

export const ok = (body: unknown, extra: Partial<ApiResponse> = {}): ApiResponse => ({ status: 200, body, ...extra });
export const created = (body: unknown): ApiResponse => ({ status: 201, body });

export function bodyObject(req: ApiRequest): Record<string, unknown> {
  return req.body && typeof req.body === "object" && !Array.isArray(req.body) ? (req.body as Record<string, unknown>) : {};
}

/** Fixed-window rate limit. Throws 429 when exceeded. */
export async function rateLimit(ctx: AppContext, key: string, limit: number, windowSeconds: number) {
  const r = await ctx.repo.hitRateLimit(key, limit, windowSeconds);
  if (!r.allowed) throw tooMany(undefined, r.retryAfterSeconds);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function serializeCookie(c: SetCookie, secure: boolean): string {
  const parts = [`${c.name}=${encodeURIComponent(c.value)}`, `Path=${c.path ?? "/"}`, `Max-Age=${c.maxAge}`, "SameSite=Lax"];
  if (c.httpOnly !== false) parts.push("HttpOnly");
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clientIp(headers: Record<string, string | undefined>, fallback: string, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = headers["x-forwarded-for"];
    if (xff) return xff.split(",")[0].trim();
    const real = headers["x-real-ip"];
    if (real) return real.trim();
  }
  return fallback || "unknown";
}

export function errorResponse(e: unknown): ApiResponse {
  if (e instanceof AppError) {
    const headers: Record<string, string> = {};
    const retry = e.details?.retry_after_seconds;
    if (typeof retry === "number") headers["Retry-After"] = String(retry);
    return { status: e.status, body: { error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } }, headers };
  }
  logger.error("api.unhandled", { error: (e as Error)?.message, stack: (e as Error)?.stack?.split("\n").slice(0, 4).join(" | ") });
  return { status: 500, body: { error: { code: "INTERNAL", message: "Something went wrong. Please try again." } } };
}
