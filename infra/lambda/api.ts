import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { dispatch } from "@/lib/api/dispatch";
import { clientIp, parseCookies, serializeCookie } from "@/lib/api/http";
import { getServerConfig, assertProductionConfig } from "@/config/server";
import { logger } from "@/lib/logger";

/**
 * AWS Lambda entry point (API Gateway HTTP API, payload v2.0, route: ANY /api/{proxy+}).
 * Runs the SAME route table as the Next.js /api routes (src/lib/api/routes.ts).
 */
const problems = assertProductionConfig();
if (problems.length) logger.error("config.invalid", { problems });

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const cfg = getServerConfig();
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(event.headers ?? {})) headers[k.toLowerCase()] = v;

  let body: unknown;
  if (event.body) {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
    if (raw.length > 3_000_000) return { statusCode: 413, body: JSON.stringify({ error: { code: "PAYLOAD_TOO_LARGE", message: "Request too large" } }) };
    try {
      body = JSON.parse(raw);
    } catch {
      return { statusCode: 400, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: { code: "INVALID_JSON", message: "Body must be JSON" } }) };
    }
  }

  // Named HTTP API stages prefix the path (/prod/api/...); the route table expects /api/...
  const stage = event.requestContext.stage;
  const path = stage && stage !== "$default" && event.rawPath.startsWith(`/${stage}/`) ? event.rawPath.slice(stage.length + 1) : event.rawPath;

  const res = await dispatch({
    method: event.requestContext.http.method,
    path,
    query: new URLSearchParams(event.rawQueryString ?? ""),
    body,
    headers,
    cookies: parseCookies((event.cookies ?? []).join("; ") || headers["cookie"]),
    ip: clientIp(headers, event.requestContext.http.sourceIp, cfg.trustProxyHeaders),
  });

  const outHeaders: Record<string, string> = { "Cache-Control": "no-store", ...(res.headers ?? {}) };
  const secure = cfg.appBaseUrl.startsWith("https://");
  const cookies = (res.cookies ?? []).map((c) => serializeCookie(c, secure));
  if (res.redirect) {
    return { statusCode: res.status === 301 ? 301 : 302, headers: { ...outHeaders, Location: res.redirect }, cookies };
  }
  if (res.text !== undefined) {
    return { statusCode: res.status, headers: { ...outHeaders, "Content-Type": res.contentType ?? "text/plain" }, cookies, body: res.text };
  }
  return { statusCode: res.status, headers: { ...outHeaders, "Content-Type": "application/json" }, cookies, body: JSON.stringify(res.body ?? null) };
}
