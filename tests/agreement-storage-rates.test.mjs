import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

test("Agreement 001/2018 storage rates remain a traceable inactive draft", () => {
  const migration = readdirSync("supabase/migrations").find((name) =>
    name.endsWith("_transcribe_agreement_001_2018_storage_rates.sql"),
  );
  assert.ok(migration);
  const sql = readFileSync(`supabase/migrations/${migration}`, "utf8");

  assert.match(sql, /source_clause text/i);
  assert.match(sql, /source_pdf_page smallint/i);
  assert.match(sql, /active = false/i);
  assert.match(sql, /verified_by_1 = null/i);
  assert.match(sql, /verified_by_2 = null/i);

  for (const expected of [
    /'NO_PROCESSING',\s*1,\s*90,\s*5\.00,\s*false,\s*'14\.2'/i,
    /'NO_PROCESSING',\s*91,\s*null,\s*7\.00,\s*false,\s*'14\.3'/i,
    /'WAITING_PROCESSING',\s*1,\s*20,\s*0\.00,\s*false,\s*'15\.1'/i,
    /'WAITING_PROCESSING',\s*21,\s*110,\s*2\.75,\s*false,\s*'15\.2'/i,
    /'WAITING_PROCESSING',\s*111,\s*null,\s*3\.50,\s*false,\s*'15\.3'/i,
    /'EMPTY_BAGS',\s*1,\s*10,\s*0\.00,\s*false,\s*'16\.1'/i,
    /'EMPTY_BAGS',\s*11,\s*40,\s*4\.00,\s*false,\s*'16\.2'/i,
    /'EMPTY_BAGS',\s*41,\s*null,\s*5\.00,\s*false,\s*'16\.3'/i,
    /'PROCESSED_EXPORT',\s*1,\s*15,\s*0\.00,\s*false,\s*'17\.1'/i,
    /'PROCESSED_EXPORT',\s*16,\s*105,\s*3\.00,\s*false,\s*'17\.2'/i,
    /'PROCESSED_EXPORT',\s*106,\s*null,\s*5\.00,\s*false,\s*'17\.3'/i,
    /'PROCESSED_EXPORT',\s*106,\s*null,\s*6\.00,\s*true,\s*'17\.3'/i,
    /'REJECT',\s*1,\s*10,\s*0\.00,\s*false,\s*'18\.1'/i,
    /'REJECT',\s*11,\s*30,\s*4\.00,\s*false,\s*'18\.2'/i,
    /'REJECT',\s*31,\s*null,\s*6\.00,\s*false,\s*'18\.3'/i,
  ]) {
    assert.match(sql, expected);
  }

  assert.doesNotMatch(sql, /'GRADE_IMPROVEMENT'/i);
});

test("legacy demo bands are replaced only while the tariff is unverified", () => {
  const migration = readdirSync("supabase/migrations").find((name) =>
    name.endsWith("_replace_unverified_demo_storage_rates.sql"),
  );
  assert.ok(migration);
  const sql = readFileSync(`supabase/migrations/${migration}`, "utf8");

  assert.match(sql, /delete from public\.tariff_line_items/i);
  assert.match(sql, /tariff\.active = false/i);
  assert.match(sql, /tariff\.verified_by_1 is null/i);
  assert.match(sql, /tariff\.verified_by_2 is null/i);
  assert.match(sql, /count\(\*\).*15/is);
  assert.match(sql, /raise exception 'Expected 15 Agreement 001\/2018 storage rate bands/i);
});

test("Rates page shows the agreement clause and draft limitation", () => {
  const source = readFileSync("app/finance-operations.tsx", "utf8");
  assert.match(source, /source_clause/);
  assert.match(source, /Agreement 001\/2018/);
  assert.match(source, /30-day month/);
  assert.match(source, /No separate rate identified in Agreement 001\/2018/);
});
