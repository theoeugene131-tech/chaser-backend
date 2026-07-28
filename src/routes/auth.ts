import { Router } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import { db } from "../lib/db";
import { hashPassword, verifyPassword, signToken } from "../lib/auth";
import { User, Organization } from "../types";

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

  const user: User = {
    id: nanoid(),
    orgId: org.id,
    email,
    passwordHash: await hashPassword(password),
    name,
    createdAt: new Date().toISOString(),
  };
  await db.insert("users", user);

  const token = signToken({ userId: user.id, orgId: org.id });
  res.status(201).json({ token, user: { id: user.id, name: user.name, email: user.email }, org: { id: org.id, name: org.name } });
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { email, password } = parsed.data;

  const user = ((await db.table("users")) as User[]).find((u) => u.email === email);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const token = signToken({ userId: user.id, orgId: user.orgId });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});
