// Post-build guard: fails the build if server secrets (or server-only config) leaked into the
// browser bundle (.next/static). Runs automatically after `npm run build`.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(".next/static");
if (!existsSync(root)) {
  console.error("check-client-bundle: .next/static not found — run next build first");
  process.exit(1);
}

const SECRET_VARS = ["SESSION_SECRET", "WHATSAPP_ACCESS_TOKEN", "MSG91_AUTH_KEY", "COGNITO_CLIENT_SECRET", "AWS_SECRET_ACCESS_KEY", "AWS_ACCESS_KEY_ID", "AWS_SESSION_TOKEN"];
const SERVER_ONLY_MARKERS = ["DYNAMODB_TABLE_NAME", "S3_ASSETS_BUCKET", "COGNITO_USER_POOL_ID", "@aws-sdk/client-dynamodb", "TransactWriteItems", "local-dev-secret-change-me"];
const patterns = [/AKIA[0-9A-Z]{16}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];

const values = SECRET_VARS.map((k) => [k, process.env[k]]).filter(([, v]) => v && v.length >= 8);

const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|css|json|map|txt|html)$/.test(f)) files.push(p);
  }
})(root);

const problems = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const name of [...SECRET_VARS, ...SERVER_ONLY_MARKERS]) if (text.includes(name)) problems.push(`${path.relative(".", file)}: contains "${name}"`);
  for (const [name, value] of values) if (text.includes(value)) problems.push(`${path.relative(".", file)}: contains the VALUE of ${name}`);
  for (const re of patterns) if (re.test(text)) problems.push(`${path.relative(".", file)}: matches ${re}`);
}

if (problems.length) {
  console.error("✗ Secrets or server-only code found in the browser bundle:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log(`✓ check-client-bundle: ${files.length} browser files scanned, no secrets or server-only code`);
