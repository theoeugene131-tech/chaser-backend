import { Router } from "express";
import { AuthedRequest, requireAuth } from "../middleware/requireAuth";
import { db } from "../lib/db";
import { InboxEvent, Customer } from "../types";

export const inboxRouter = Router();
inboxRouter.use(requireAuth);

inboxRouter.get("/", async (req: AuthedRequest, res) => {
  const orgId = req.auth!.orgId;
  const type = req.query.type as string | undefined;

  let events = ((await db.table("inboxEvents")) as InboxEvent[])
    .filter((e) => e.orgId === orgId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  if (type && type !== "all") events = events.filter((e) => e.type === type);

  const customers = (await db.table("customers")) as Customer[];
  const withCustomerNames = events.map((e) => ({
    ...e,
    customerName: customers.find((c) => c.id === e.customerId)?.name ?? "Unknown",
  }));

  res.json({ events: withCustomerNames.slice(0, 100) });
});
