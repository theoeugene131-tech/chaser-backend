import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../lib/auth";
import { db } from "../lib/db";

const CURRENT_TERMS_VERSION = "2026-10-15-v3";

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
  if (!payload || !payload.userId || !payload.orgId) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  // A valid signature alone is not enough: confirm the account still exists
  // and that its current organization matches the organization in the token.
  const users = await db.table("users");
  const user = users.find((record: any) => record.id === payload.userId);
  if (!user) {
    return res.status(401).json({ error: "Account no longer exists. Please sign in again." });
  }
  if (user.orgId !== payload.orgId) {
    return res.status(401).json({ error: "Your session is no longer valid. Please sign in again." });
  }

  const organizations = await db.table("organizations");
  if (!organizations.some((record: any) => record.id === user.orgId)) {
    return res.status(401).json({ error: "Organization no longer exists. Please contact support." });
  }

  req.auth = { userId: user.id, orgId: user.orgId };

  // The explicit acceptance endpoint must remain reachable before acceptance.
  if (req.path !== "/terms/accept") {
    const acceptances = await db.table("terms_acceptances");
    const accepted = acceptances.some(
      (record: any) => record.userId === user.id && record.version === CURRENT_TERMS_VERSION
    );
    if (!accepted) {
      return res.status(403).json({
        error: "TERMS_ACCEPTANCE_REQUIRED",
        message: "Please review and accept the current Terms and Conditions to continue.",
      });
    }
  }

  next();
}
