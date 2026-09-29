import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/** Every environment variable the code reads must be documented in .env.example, and vice versa. */
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) {
      if (!["node_modules", "dist", ".next"].includes(f)) walk(p, out);
    } else if (/\.(ts|tsx|mjs)$/.test(f)) out.push(p);
  }
  return out;
}

const RUNTIME_ONLY = new Set(["NODE_ENV", "AWS_REGION"]); // set by the platform, not by us

describe(".env.example", () => {
  const used = new Set<string>();
  for (const file of [...walk("src"), ...walk("infra"), ...walk("scripts"), "next.config.ts"]) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/(?:process\.env\.|read\("|env\(")([A-Z0-9_]+)/g)) used.add(m[1]);
  }
  const documented = new Set([...readFileSync(".env.example", "utf8").matchAll(/^#?\s?([A-Z0-9_]+)=/gm)].map((m) => m[1]));

  it("documents every variable the code reads", () => {
    const missing = [...used].filter((k) => !documented.has(k) && !RUNTIME_ONLY.has(k)).sort();
    expect(missing).toEqual([]);
  });

  it("does not document variables the code no longer reads", () => {
    const aliases = new Set(["BUB_AWS_REGION", "BUB_AWS_MOCK_MODE"]);
    const stale = [...documented].filter((k) => !used.has(k) && !aliases.has(k)).sort();
    expect(stale).toEqual([]);
  });

  it("never marks a secret as NEXT_PUBLIC", () => {
    const pub = [...documented].filter((k) => k.startsWith("NEXT_PUBLIC_"));
    expect(pub.filter((k) => /SECRET|TOKEN|AUTH_KEY|PASSWORD|ACCESS_KEY/.test(k))).toEqual([]);
  });
});
