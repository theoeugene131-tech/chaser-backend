import { Router } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import { db } from "../lib/db";
import { AuthedRequest, requireAuth } from "../middleware/requireAuth";
import { User } from "../types";

export const analyticsRouter = Router();

const eventSchema = z.object({
  event: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_.-]+$/),
  path: z.string().max(300).optional().default("/"),
  target: z.string().max(120).optional(),
  referrer: z.string().max(500).optional(),
  sessionId: z.string().min(8).max(100),
});

analyticsRouter.post("/event", async (req, res) => {
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid analytics event" });
  const event = {
    id: nanoid(),
    event: parsed.data.event,
    path: parsed.data.path,
    target: parsed.data.target || null,
    referrer: parsed.data.referrer || null,
    sessionId: parsed.data.sessionId,
    createdAt: new Date().toISOString(),
  };
  try {
    await db.insert("analytics_events", event);
    return res.status(202).json({ ok: true });
  } catch (error) {
    console.error("Could not store analytics event", error);
    return res.status(503).json({ error: "Analytics temporarily unavailable" });
  }
});

analyticsRouter.get("/owner", requireAuth, async (req: AuthedRequest, res) => {
  const ownerEmail = (process.env.OWNER_EMAIL || "").trim().toLowerCase();
  if (!ownerEmail) return res.status(503).json({ error: "OWNER_EMAIL is not configured on the server" });

  const users = (await db.table("users")) as User[];
  const owner = users.find((u) => u.id === req.auth!.userId);
  if (!owner || owner.email.toLowerCase() !== ownerEmail) {
    return res.status(403).json({ error: "Owner access only" });
  }

  const [events, orgs, allUsers, subscriptions] = await Promise.all([
    db.table("analytics_events"),
    db.table("organizations"),
    db.table("users"),
    db.table("subscriptions"),
  ]);
  const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recent = events.filter((e: any) => new Date(e.createdAt).getTime() >= since);
  const uniqueVisitors = new Set(recent.map((e: any) => e.sessionId)).size;
  const clicks = recent.filter((e: any) => String(e.event).startsWith("click_")).length;
  const signups = allUsers.filter((u: any) => new Date(u.createdAt).getTime() >= since).length;
  const paid = subscriptions.filter((s: any) => ["active", "paid", "trialing"].includes(String(s.status).toLowerCase()) && String(s.status).toLowerCase() !== "trialing").length;

  const byEvent: Record<string, number> = {};
  for (const e of recent as any[]) byEvent[e.event] = (byEvent[e.event] || 0) + 1;
  const recentEvents = [...recent]
    .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 100)
    .map((e: any) => ({ event: e.event, path: e.path, target: e.target, referrer: e.referrer, createdAt: e.createdAt }));

  res.json({
    periodDays: 30,
    visitors: uniqueVisitors,
    pageViews: recent.filter((e: any) => e.event === "page_view").length,
    clicks,
    registrations: signups,
    registeredUsers: allUsers.length,
    organizations: orgs.length,
    payingCustomers: paid,
    eventCounts: byEvent,
    recentEvents,
  });
});
