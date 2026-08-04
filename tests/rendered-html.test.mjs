import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("renders the Hayked warehouse sign-in or secure session check", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Hayked Coffee Warehouse ERP/i);
  assert.match(html, /Every coffee lot|Checking secure session/);
  assert.match(html, /Arrival &amp; GRN|Checking secure session/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});
