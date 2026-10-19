import { test } from "node:test";
import assert from "node:assert/strict";
import { toneFor, formatAmount, daysPastDue } from "../src/services/reminders";

test("reminder tone gets firmer as an invoice ages", () => {
  assert.equal(toneFor(-3), "friendly");
  assert.equal(toneFor(0), "friendly");
  assert.equal(toneFor(1), "overdue");
  assert.equal(toneFor(14), "firm");
  assert.equal(toneFor(30), "final");
});

test("currency amounts are formatted with a safe fallback", () => {
  assert.equal(formatAmount(123456, "usd"), "$1,234.56");
  assert.match(formatAmount(1000, "zzz"), /10\.00/);
});

test("days past due counts whole days", () => {
  const invoice = { dueDate: "2026-08-01T00:00:00.000Z" } as any;
  assert.equal(daysPastDue(invoice, new Date("2026-08-11T12:00:00.000Z")), 10);
  assert.equal(daysPastDue(invoice, new Date("2026-07-29T00:00:00.000Z")), -3);
});
