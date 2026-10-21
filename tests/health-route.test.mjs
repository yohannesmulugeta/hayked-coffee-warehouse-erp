import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("health check verifies Supabase REST connectivity without reading business tables", async () => {
  const source = await readFile(
    new URL("../app/api/health/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /fetch\(`\$\{url\}\/rest\/v1\/`/);
  assert.doesNotMatch(source, /organizations\?select=/);
});
