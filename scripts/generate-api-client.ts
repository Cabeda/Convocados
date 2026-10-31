/**
 * Generate or verify the typed API client from the OpenAPI description.
 *
 * Usage:
 *   tsx scripts/generate-api-client.ts           # write src/lib/api/generated.ts
 *   tsx scripts/generate-api-client.ts --check   # fail if the committed file is stale
 *
 * `--check` exists for the same reason `generate-feature-parity-docs.ts` has one:
 * a gate that regenerates the file it checks repairs the drift and exits 0, so it
 * can never report that the file was wrong.
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { openApiSpec } from "../src/lib/openapi";
import { checkApiClient, renderApiClient } from "../src/lib/api/generate";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const target = resolve(ROOT, "src/lib/api/generated.ts");

if (process.argv.includes("--check")) {
  const committed = existsSync(target) ? readFileSync(target, "utf-8") : "";
  const failure = checkApiClient(committed, openApiSpec);
  if (failure) {
    console.error(`✗ ${failure}`);
    process.exit(1);
  }
  console.log("✓ src/lib/api/generated.ts is up to date");
} else {
  writeFileSync(target, renderApiClient(openApiSpec));
  console.log("✓ Generated src/lib/api/generated.ts");
}
