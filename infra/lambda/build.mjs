// Bundles the Lambda handlers with esbuild → infra/lambda/dist/{api,sweeper}/index.mjs
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

for (const name of ["api", "sweeper"]) {
  await build({
    entryPoints: [path.join(here, `${name}.ts`)],
    outfile: path.join(here, "dist", name, "index.mjs"),
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    minify: true,
    sourcemap: true,
    alias: { "@": path.join(root, "src") },
    // The AWS SDK v3 ships with the Lambda Node.js runtime.
    external: ["@aws-sdk/*"],
    banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
    logLevel: "info",
  });
}
