import "dotenv/config";
import { ensureSchema, db } from "./lib/db";
import { runAllOrgsSweep } from "./services/escalation";

async function main() {
  await ensureSchema();
  const results = await runAllOrgsSweep();
  const totals = Object.values(results).reduce(
    (total, current) => ({
      touched: total.touched + current.touched,
      sent: total.sent + current.sent,
      logged: total.logged + current.logged,
      skipped: total.skipped + current.skipped,
      failed: total.failed + current.failed,
    }),
    { touched: 0, sent: 0, logged: 0, skipped: 0, failed: 0 },
  );
  console.log(`[cron-sweep] ${new Date().toISOString()} orgs=${Object.keys(results).length}`, totals);
  await db.close();
  if (totals.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("[cron-sweep] fatal:", error);
  process.exitCode = 1;
});
