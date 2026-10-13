import { Router } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import { db } from "../lib/db";
import { hashPassword, verifyPassword, signToken } from "../lib/auth";
import { User, Organization } from "../types";
import { AuthedRequest, requireAuth } from "../middleware/requireAuth";

export const TERMS_VERSION = "2026-10-13-v1";

async function hasAcceptedTerms(userId: string) {
  const records = await db.table("terms_acceptances");
  return records.some((record: any) => record.userId === userId && record.version === TERMS_VERSION);
}

export const authRouter = Router();

const signupSchema = z.object({
  orgName: z.string().min(2),
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

authRouter.post("/signup", async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { orgName, name, email, password } = parsed.data;

  const existing = ((await db.table("users")) as User[]).find((u) => u.email === email);
  if (existing) return res.status(409).json({ error: "An account with that email already exists" });

  const org: Organization = { id: nanoid(), name: orgName, createdAt: new Date().toISOString() };
  await db.insert("organizations", org);

  // Email verification is disabled. New accounts are active immediately.
  const user: User = {
    id: nanoid(),
    orgId: org.id,
    email,
    passwordHash: await hashPassword(password),
    name,
    emailVerified: true,
    verificationToken: null,
    verificationTokenExpiresAt: null,
    createdAt: new Date().toISOString(),
  };
  await db.insert("users", user);

  const token = signToken({ userId: user.id, orgId: user.orgId });
  res.status(201).json({
    token,
    user: { id: user.id, name: user.name, email: user.email },
    termsAccepted: await hasAcceptedTerms(user.id),
  });
});

authRouter.post("/login", async (req, res) => {
  const parsed = z.object({
    email: z.string().email(),
    password: z.string(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { email, password } = parsed.data;

  const user = ((await db.table("users")) as User[]).find((u) => u.email === email);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  // Email verification is disabled; existing accounts can log in directly.
  const token = signToken({ userId: user.id, orgId: user.orgId });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email }, termsAccepted: await hasAcceptedTerms(user.id) });
});


// Record explicit acceptance of the current Terms version for audit purposes.
authRouter.post("/terms/accept", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = z.object({ version: z.string().min(1), accepted: z.literal(true) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Explicit acceptance is required" });
  if (parsed.data.version !== TERMS_VERSION) return res.status(409).json({ error: "These Terms have changed. Reload the app and review the current version." });

  const existing = (await db.table("terms_acceptances")).find((record: any) => record.userId === req.auth!.userId && record.version === TERMS_VERSION);
  if (!existing) {
    await db.insert("terms_acceptances", {
      id: nanoid(), userId: req.auth!.userId, orgId: req.auth!.orgId,
      version: TERMS_VERSION, acceptedAt: new Date().toISOString(),
      ipAddress: req.ip, userAgent: req.get("user-agent") || null,
    });
  }
  res.json({ accepted: true, version: TERMS_VERSION });
});
