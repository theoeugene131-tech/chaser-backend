import "dotenv/config";
import { nanoid } from "nanoid";
import { db, ensureSchema } from "./lib/db";
import { hashPassword } from "./lib/auth";
import { runEscalationSweep } from "./services/escalation";

async function seed() {
  await ensureSchema();
  await db.reset();

  const orgId = nanoid();
  await db.insert("organizations", { id: orgId, name: "Demo Co.", createdAt: new Date().toISOString() });

  await db.insert("users", {
    id: nanoid(),
    orgId,
    email: "demo@chaser.app",
    passwordHash: await hashPassword("password123"),
    name: "Morgan Oyelaran",
    emailVerified: true,
    verificationToken: null,
    verificationTokenExpiresAt: null,
    createdAt: new Date().toISOString(),
  });

  const customerNames = [
    "Northwind Foods",
    "Talus Manufacturing",
    "Redline Freight Co.",
    "Ambient Retail Group",
    "Boreal Supply",
    "Ferro Industrial",
    "Quickline Logistics",
    "Cascade Materials",
  ];

  const customers = [];
  for (const name of customerNames) {
    const c = {
      id: nanoid(),
      orgId,
      name,
      email: `ap@${name.toLowerCase().replace(/[^a-z]+/g, "")}.com`,
      externalIds: {},
      createdAt: new Date().toISOString(),
    };
    await db.insert("customers", c);
    customers.push(c);
  }

  const providers = ["stripe", "quickbooks", "netsuite", "billcom", "coupa"] as const;

  // Spread due dates across current, 30/60/90+ buckets so the dashboard has real texture.
  const dueOffsets = [10, -41, -58, 8, -3, 3, -55, -29];
  const amounts = [2480000, 912000, 3120000, 1842000, 674000, 1298000, 1560000, 430000];

  for (let i = 0; i < customers.length; i++) {
    const customer = customers[i];
    const dueDate = new Date(Date.now() + dueOffsets[i] * 86_400_000);
    const issuedDate = new Date(dueDate.getTime() - 30 * 86_400_000);
    const invoiceId = nanoid();

    await db.insert("invoices", {
      id: invoiceId,
      orgId,
      customerId: customer.id,
      number: `INV-${3100 + i * 17}`,
      amountCents: amounts[i],
      amountPaidCents: 0,
      currency: "usd",
      dueDate: dueDate.toISOString(),
      issuedDate: issuedDate.toISOString(),
      status: "current",
      source: providers[i % providers.length],
      externalId: `ext_${nanoid(8)}`,
      lastReminderAt: null,
      reminderCount: 0,
      createdAt: issuedDate.toISOString(),
      updatedAt: issuedDate.toISOString(),
    });
  }

  // Mark one invoice fully paid to give recovery-rate/DSO stats something to compute.
  const allInvoices = await db.table("invoices");
  const paidTarget = allInvoices[3];
  await db.update("invoices", paidTarget.id, {
    status: "paid",
    amountPaidCents: paidTarget.amountCents,
    updatedAt: new Date().toISOString(),
  });
  await db.insert("inboxEvents", {
    id: nanoid(),
    orgId,
    type: "paid",
    customerId: paidTarget.customerId,
    invoiceId: paidTarget.id,
    detail: `$${(paidTarget.amountCents / 100).toLocaleString()} received via Stripe — invoice closed`,
    createdAt: new Date().toISOString(),
  });

  // Seed integration connections as "connected" in demo mode so the dashboard reads real.
  for (const provider of providers) {
    await db.insert("integrationConnections", {
      id: nanoid(),
      orgId,
      provider,
      connected: true,
      credentials: null,
      lastSyncedAt: new Date().toISOString(),
    });
  }

  // Run the cadence once so reminders/escalations populate the inbox realistically.
  await runEscalationSweep(orgId);

  console.log("Seed complete.");
  console.log(`  org: Demo Co. (${orgId})`);
  console.log("  login: demo@chaser.app / password123");

  await db.close();
}

seed();
