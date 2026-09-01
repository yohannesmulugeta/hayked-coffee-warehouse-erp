import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isImplementedView } from "../app/view-registry.ts";

const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const processingSource = readFileSync(new URL("../app/processing-operations.tsx", import.meta.url), "utf8");

test("implemented navigation routes are enabled from one shared registry", () => {
  assert.equal(isImplementedView("Dashboard"), true);
  assert.equal(isImplementedView("Processing"), true);
  assert.equal(isImplementedView("Finance"), true);
  assert.equal(isImplementedView("Unknown future module"), false);
});

test("closed compact navigation is removed from keyboard and accessibility navigation", () => {
  assert.match(pageSource, /hidden=\{compact && !open\}/);
  assert.match(pageSource, /aria-hidden=\{compactNavigation && sidebarOpen\}/);
  assert.match(pageSource, /inert=\{compactNavigation && sidebarOpen/);
});

test("processing rows expose one clear next step and open details from the record", () => {
  assert.match(processingSource, /Review Request/);
  assert.match(processingSource, /Start Processing/);
  assert.match(processingSource, /Complete Processing/);
  assert.match(processingSource, /View Summary/);
  assert.match(processingSource, /Open .* details/);
  assert.doesNotMatch(processingSource, /Request & ECX/);
  assert.doesNotMatch(processingSource, /Order & files/);
  assert.doesNotMatch(processingSource, /muted-action">Locked/);
});
