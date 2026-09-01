import assert from "node:assert/strict";
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
});
