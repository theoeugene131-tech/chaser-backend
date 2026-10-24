import { test } from "node:test";
import assert from "node:assert/strict";
import { toneFor, formatAmount, daysPastDue } from "../src/services/reminders";
import { sendEmail, escapeHtml } from "../src/lib/reminderEmail";

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

test("HTML email values are escaped", () => {
  assert.equal(escapeHtml(`A & <B> "C" 'D'`), "A &amp; &lt;B&gt; &quot;C&quot; &#39;D&#39;");
});

test("production email fails closed when the API key is missing", async () => {
  const oldKey = process.env.RESEND_API_KEY;
  const oldNodeEnv = process.env.NODE_ENV;
  try {
    delete process.env.RESEND_API_KEY;
    process.env.NODE_ENV = "production";
    await assert.rejects(() => sendEmail({ to: "customer@example.com", subject: "Test", html: "<p>Test</p>", text: "Test" }), /RESEND_API_KEY/);
  } finally {
    if (oldKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = oldKey;
    if (oldNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldNodeEnv;
  }
});

test("sender address is required and must be configured before sending", async () => {
  const oldKey = process.env.RESEND_API_KEY;
  const oldFrom = process.env.EMAIL_FROM;
  const oldNodeEnv = process.env.NODE_ENV;
  try {
    process.env.RESEND_API_KEY = "test-key";
    process.env.NODE_ENV = "production";
    delete process.env.EMAIL_FROM;
    await assert.rejects(() => sendEmail({ to: "customer@example.com", subject: "Test", html: "<p>Test</p>", text: "Test" }), /EMAIL_FROM must be set/);
  } finally {
    if (oldKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = oldKey;
    if (oldFrom === undefined) delete process.env.EMAIL_FROM; else process.env.EMAIL_FROM = oldFrom;
    if (oldNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldNodeEnv;
  }
});

test("email provider acceptance is reported as sent and provider errors are surfaced", async () => {
  const oldKey = process.env.RESEND_API_KEY;
  const oldFrom = process.env.EMAIL_FROM;
  const oldNodeEnv = process.env.NODE_ENV;
  const oldFetch = globalThis.fetch;
  try {
    process.env.RESEND_API_KEY = "test-key";
    process.env.EMAIL_FROM = "Invoice Chaser <billing@example.com>";
    process.env.NODE_ENV = "production";
    globalThis.fetch = (async (_input: any, init?: any) => {
      assert.equal(init?.headers?.Authorization, "Bearer test-key");
      const body = JSON.parse(init?.body || "{}");
      assert.equal(body.from, "Invoice Chaser <billing@example.com>");
      return new Response(JSON.stringify({ id: "test-email-id" }), { status: 200 });
    }) as typeof fetch;
    assert.deepEqual(await sendEmail({ to: "customer@example.com", subject: "Test", html: "<p>Test</p>", text: "Test" }), { sent: true });

    globalThis.fetch = (async () => new Response("invalid sender", { status: 422 })) as typeof fetch;
    await assert.rejects(() => sendEmail({ to: "customer@example.com", subject: "Test", html: "<p>Test</p>", text: "Test" }), /Resend API error \(422\)/);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = oldKey;
    if (oldFrom === undefined) delete process.env.EMAIL_FROM; else process.env.EMAIL_FROM = oldFrom;
    if (oldNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldNodeEnv;
  }
});
