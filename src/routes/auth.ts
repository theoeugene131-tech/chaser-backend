import { Router } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import crypto from "crypto";
import { db } from "../lib/db";
import { hashPassword, verifyPassword, signToken } from "../lib/auth";
import { sendVerificationEmail } from "../lib/email";
import { User, Organization } from "../types";

export const authRouter = Router();

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PUBLIC_URL = process.env.API_PUBLIC_URL || "http://localhost:4000";

function newVerificationToken() {
  return crypto.randomBytes(24).toString("hex");
}

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

  const verificationToken = newVerificationToken();
  const user: User = {
    id: nanoid(),
    orgId: org.id,
    email,
    passwordHash: await hashPassword(password),
    name,
    emailVerified: false,
    verificationToken,
    verificationTokenExpiresAt: new Date(Date.now() + VERIFICATION_TTL_MS).toISOString(),
    createdAt: new Date().toISOString(),
  };
  await db.insert("users", user);

  const verifyUrl = `${PUBLIC_URL}/api/auth/verify?token=${verificationToken}`;
  try {
    await sendVerificationEmail(email, name, verifyUrl);
  } catch (err) {
    // Don't fail signup just because email sending had a hiccup — the
    // account still exists and can request a resend.
    console.error("Failed to send verification email:", err);
  }

  // No login token here on purpose — you must verify before you can log in.
  res.status(201).json({
    requiresVerification: true,
    message: "Account created. Check your email to verify before logging in.",
  });
});

authRouter.get("/verify", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const users = (await db.table("users")) as User[];
  const user = users.find((u) => u.verificationToken === token);

  const htmlPage = (title: string, message: string, ok: boolean) => `
    <!doctype html>
    <html><head><meta charset="utf-8"><title>${title}</title></head>
    <body style="font-family: sans-serif; background:#0F1B2D; color:#EDEAE0; display:flex; align-items:center; justify-content:center; height:100vh; margin:0;">
      <div style="text-align:center; max-width:400px; padding:32px;">
        <div style="font-size:40px; margin-bottom:12px;">${ok ? "✅" : "⚠️"}</div>
        <h2 style="margin:0 0 8px 0;">${title}</h2>
        <p style="color:#8B9AAE;">${message}</p>
      </div>
    </body></html>
  `;

  if (!user) {
    return res.status(400).send(htmlPage("Link not valid", "This verification link is invalid or has already been used.", false));
  }
  if (user.verificationTokenExpiresAt && new Date(user.verificationTokenExpiresAt) < new Date()) {
    return res.status(400).send(htmlPage("Link expired", "This verification link has expired. Please request a new one from the login screen.", false));
  }

  await db.update("users", user.id, {
    emailVerified: true,
    verificationToken: null,
    verificationTokenExpiresAt: null,
  });

  res.send(htmlPage("Email verified", "Your account is active — you can close this tab and log in.", true));
});

const resendSchema = z.object({ email: z.string().email() });

authRouter.post("/resend-verification", async (req, res) => {
  const parsed = resendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = ((await db.table("users")) as User[]).find((u) => u.email === parsed.data.email);

  // Always return the same generic response whether or not the account
  // exists — avoids leaking which emails have accounts.
  const genericResponse = { message: "If that account exists and isn't verified yet, a new email has been sent." };

  if (!user || user.emailVerified) return res.json(genericResponse);

  const verificationToken = newVerificationToken();
  await db.update("users", user.id, {
    verificationToken,
    verificationTokenExpiresAt: new Date(Date.now() + VERIFICATION_TTL_MS).toISOString(),
  });

  const verifyUrl = `${PUBLIC_URL}/api/auth/verify?token=${verificationToken}`;
  try {
    await sendVerificationEmail(user.email, user.name, verifyUrl);
  } catch (err) {
    console.error("Failed to resend verification email:", err);
  }

  res.json(genericResponse);
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

  // Users created before this feature shipped have emailVerified === true
  // via the one-time backfill script — only new signups are gated here.
  if (!user.emailVerified) {
    return res.status(403).json({ error: "EMAIL_NOT_VERIFIED", message: "Please verify your email before logging in." });
  }

  const token = signToken({ userId: user.id, orgId: user.orgId });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});
