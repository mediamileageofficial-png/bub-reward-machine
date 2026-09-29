import { getContext, type AppContext } from "@/lib/context";
import { errorResponse, type ApiRequest, type ApiResponse } from "./http";
import { matchRoute } from "./routes";

/** Runs a request through the shared route table. Never throws. */
export async function dispatch(req: Omit<ApiRequest, "params">, ctxOverride?: AppContext): Promise<ApiResponse> {
  try {
    const m = matchRoute(req.method, req.path);
    if (!m) return { status: 404, body: { error: { code: "NOT_FOUND", message: "Not found" } } };
    if ("methodNotAllowed" in m) return { status: 405, body: { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } } };
    const ctx = ctxOverride ?? (await getContext());
    if (!sameOriginOk(req, ctx)) return { status: 403, body: { error: { code: "BAD_ORIGIN", message: "Cross-site request blocked" } } };
    const res = await m.route.handler({ ...req, params: m.params }, ctx);
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}

const PRIVILEGED = /^\/api\/(admin|sponsor|auth)\/|^\/api\/coupon\/[^/]+\/redeem$/;

/**
 * CSRF defence-in-depth for cookie-authenticated, state-changing requests (the auth cookie is
 * already SameSite=Lax). If the browser sends an Origin, it must be this site.
 */
export function sameOriginOk(req: Omit<ApiRequest, "params">, ctx: AppContext): boolean {
  if (req.method === "GET" || req.method === "HEAD" || !PRIVILEGED.test(req.path)) return true;
  const origin = req.headers["origin"];
  if (!origin) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const allowed = new Set<string>();
  for (const h of [req.headers["x-forwarded-host"], req.headers["host"]]) if (h) allowed.add(h.split(",")[0].trim());
  try {
    allowed.add(new URL(ctx.cfg.appBaseUrl).host);
  } catch {
    /* ignore */
  }
  return allowed.has(originHost);
}
