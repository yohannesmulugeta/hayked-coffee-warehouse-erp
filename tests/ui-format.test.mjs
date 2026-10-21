import assert from "node:assert/strict";
import test from "node:test";
import { countLabel, greetingForHour, warehouseHour } from "../lib/ui-format.ts";

test("count labels use correct singular and plural wording", () => {
  assert.equal(countLabel(0, "lot"), "0 lots");
  assert.equal(countLabel(1, "lot"), "1 lot");
  assert.equal(countLabel(2, "lot"), "2 lots");
});

test("warehouse greetings match the operational time of day", () => {
  assert.equal(greetingForHour(7), "Good morning");
  assert.equal(greetingForHour(14), "Good afternoon");
  assert.equal(greetingForHour(21), "Good evening");
  assert.equal(warehouseHour(new Date("2026-08-30T20:00:00Z")), 23);
});
