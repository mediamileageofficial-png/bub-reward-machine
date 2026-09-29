import { NextResponse, type NextRequest } from "next/server";
import { dispatch } from "@/lib/api/dispatch";
import { clientIp, parseCookies, serializeCookie } from "@/lib/api/http";
import { getServerConfig } from "@/config/server";

/**
 * Next.js adapter for the shared API route table (src/lib/api/routes.ts).
 * In production the same table runs in AWS Lambda behind API Gateway (infra/lambda/api.ts);
 * set API_PROXY_URL to route /api/* there instead of these Next.js handlers.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY = 3_000_000;

async function handle(req: NextRequest) {
  const cfg = getServerConfig();
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));

  let body: unknown = undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const len = Number(req.headers.get("content-length") ?? "0");
    if (len > MAX_BODY) return NextResponse.json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Request too large" } }, { status: 413 });
    const raw = await req.text();
    if (raw.length > MAX_BODY) return NextResponse.json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Request too large" } }, { status: 413 });
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        return NextResponse.json({ error: { code: "INVALID_JSON", message: "Body must be JSON" } }, { status: 400 });
      }
    }
  }

  const res = await dispatch({
    method: req.method,
    path: req.nextUrl.pathname,
    query: req.nextUrl.searchParams,
    body,
    headers,
    cookies: parseCookies(req.headers.get("cookie") ?? undefined),
    ip: clientIp(headers, "local", cfg.trustProxyHeaders),
  });

  const out = res.redirect
    ? NextResponse.redirect(new URL(res.redirect, req.nextUrl.origin), res.status === 301 ? 301 : 302)
    : res.text !== undefined
      ? new NextResponse(res.text, { status: res.status, headers: { "Content-Type": res.contentType ?? "text/plain" } })
      : NextResponse.json(res.body ?? null, { status: res.status });

  out.headers.set("Cache-Control", res.headers?.["Cache-Control"] ?? "no-store");
  for (const [k, v] of Object.entries(res.headers ?? {})) out.headers.set(k, v);
  const secure = cfg.appBaseUrl.startsWith("https://");
  for (const c of res.cookies ?? []) out.headers.append("Set-Cookie", serializeCookie(c, secure));
  return out;
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
