import { Router } from "express";
import { AuthedRequest, requireAuth } from "../middleware/requireAuth";
import { runEscalationSweep } from "../services/escalation";

export const jobsRouter = Router();
jobsRouter.use(requireAuth);

// In production, call this from a scheduled job (cron / queue) once a day
// per org instead of a button click. See README "Running the daily job".
jobsRouter.post("/escalation-sweep", async (req: AuthedRequest, res) => {
  const result = await runEscalationSweep(req.auth!.orgId);
  res.json(result);
});
