import { describe, expect, it } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { handler } from "../infra/lambda/api";

function ev(method: string, rawPath: string, body?: unknown, stage = "prod"): APIGatewayProxyEventV2 {
  return {
    rawPath,
    rawQueryString: "",
    headers: { "x-forwarded-for": "203.0.113.9" },
    body: body ? JSON.stringify(body) : undefined,
    isBase64Encoded: false,
    requestContext: { stage, http: { method, sourceIp: "10.1.1.1" } },
  } as unknown as APIGatewayProxyEventV2;
}

describe("Lambda adapter (API Gateway HTTP API)", () => {
  it("strips a named stage prefix and runs the shared route table", async () => {
    const r = await handler(ev("POST", "/prod/api/session", { src: "N001", event: "visit" }));
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body!).source.source_id).toBe("N001");
  });

  it("works on the $default stage too", async () => {
    const r = await handler(ev("GET", "/api/story/templates", undefined, "$default"));
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body!).templates.length).toBe(4);
  });

  it("rejects invalid JSON and protects admin routes", async () => {
    const bad = await handler({ ...ev("POST", "/prod/api/play"), body: "{nope" });
    expect(bad.statusCode).toBe(400);
    expect((await handler(ev("GET", "/prod/api/admin/overview"))).statusCode).toBe(401);
  });
});
