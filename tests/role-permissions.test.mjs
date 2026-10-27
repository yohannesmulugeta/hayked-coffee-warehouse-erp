import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as permissions from "../app/role-permissions.ts";

const { canAccessView, canManageCoreMasterData, normalizeAppRole } = permissions;

test("unknown roles fail closed as viewers", () => {
  assert.equal(normalizeAppRole("unexpected_role"), "viewer");
  assert.equal(canAccessView("unexpected_role", "Administration"), false);
  assert.equal(canAccessView("unexpected_role", "Reports"), true);
});

test("viewer navigation contains no operational or administrative write areas", () => {
  for (const view of ["Warehouse Receipts", "Processing", "Dispatch", "Finance", "Approvals", "Administration"]) {
    assert.equal(canAccessView("viewer", view), false, view);
  }
  for (const view of ["Dashboard", "Clients", "Coffee Lots", "Reports", "Documents"]) {
    assert.equal(canAccessView("viewer", view), true, view);
  }
});

test("administration is reserved for system administrators", () => {
  assert.equal(canAccessView("system_admin", "Administration"), true);
  for (const role of ["warehouse_manager", "warehouse_officer", "processing_supervisor", "finance_officer", "auditor", "viewer"]) {
    assert.equal(canAccessView(role, "Administration"), false, role);
  }
});

test("only system administrators and warehouse managers manage core master data", () => {
  assert.equal(canManageCoreMasterData("system_admin"), true);
  assert.equal(canManageCoreMasterData("warehouse_manager"), true);
  assert.equal(canManageCoreMasterData("finance_officer"), false);
  assert.equal(canManageCoreMasterData("viewer"), false);
});

test("processing actions are role-aware and system administrators can perform every step", () => {
  assert.equal(typeof permissions.canPerformProcessingAction, "function");
  for (const action of ["create", "approve", "queue", "start", "complete"]) {
    assert.equal(permissions.canPerformProcessingAction("system_admin", action), true, action);
    assert.equal(permissions.canPerformProcessingAction("warehouse_officer", action), false, action);
  }
  for (const role of ["production_assistant", "production_assistant_weighbridge"]) {
    assert.equal(permissions.canPerformProcessingAction(role, "create"), true);
    for (const action of ["approve", "queue", "start", "complete"]) {
      assert.equal(permissions.canPerformProcessingAction(role, action), false, `${role}: ${action}`);
    }
  }
  assert.equal(canAccessView("production_assistant", "Dispatch"), false);
  assert.equal(canAccessView("production_assistant_weighbridge", "Dispatch"), true);
});

test("laboratory is visible to staff without granting edit rights through navigation", () => {
  for (const role of ["system_admin", "warehouse_manager", "processing_supervisor", "auditor", "viewer"]) {
    assert.equal(canAccessView(role, "Laboratory"), true, role);
  }
  assert.equal(canAccessView("viewer", "Processing"), false);
});

test("database role defaults match navigation and every assignable view is catalogued", () => {
  const migration = readFileSync(new URL("../supabase/migrations/20261022073724_user_feature_access.sql", import.meta.url), "utf8");
  const assistantMigration = readFileSync(new URL("../supabase/migrations/20261027213713_production_assistant_access.sql", import.meta.url), "utf8");
  for (const view of permissions.configurableViews) {
    assert.ok(migration.includes(`('${view}', true)`), `${view} is absent from the database catalog`);
  }
  for (const role of permissions.appRoles) {
    if (role === "system_admin") continue;
    const match = migration.match(new RegExp(`select '${role}', unnest\\(array\\[([\\s\\S]*?)\\]\\);`));
    const databaseViews = match
      ? [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1])
      : [...assistantMigration.matchAll(new RegExp(`\\('${role}', '([^']+)'\\)`, "g"))].map((item) => item[1]);
    assert.ok(databaseViews.length, `${role} defaults are missing`);
    for (const view of ["Dashboard", ...permissions.configurableViews, "Administration"]) {
      assert.equal(databaseViews.includes(view), canAccessView(role, view), `${role}: ${view}`);
    }
  }
});
