import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../lib/auth";

export interface AuthedRequest extends Request {
  auth?: { userId: string; orgId: string };
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
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
  next();
}
