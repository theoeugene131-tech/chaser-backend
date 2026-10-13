import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../lib/auth";
import { db } from "../lib/db";

const CURRENT_TERMS_VERSION = "2026-10-13-v1";

export interface AuthedRequest extends Request {
  auth?: { userId: string; orgId: string };
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing bearer token" });
  }
  const token = header.slice("Bearer ".length);
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
  req.auth = payload;

  // The explicit acceptance endpoint must remain reachable before acceptance.
  if (req.path !== "/terms/accept") {
    const acceptances = await db.table("terms_acceptances");
    const accepted = acceptances.some((record: any) => record.userId === payload.userId && record.version === CURRENT_TERMS_VERSION);
    if (!accepted) return res.status(403).json({ error: "TERMS_ACCEPTANCE_REQUIRED", message: "Please review and accept the current Terms and Conditions to continue." });
  }
  next();
}
