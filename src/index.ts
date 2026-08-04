import "dotenv/config";
import express from "express";
import cors from "cors";
import { ensureSchema } from "./lib/db";
import { authRouter } from "./routes/auth";
import { overviewRouter } from "./routes/overview";
import { inboxRouter } from "./routes/inbox";
import { invoicesRouter } from "./routes/invoices";
import { customersRouter } from "./routes/customers";
import { integrationsRouter } from "./routes/integrations";
import { jobsRouter } from "./routes/jobs";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true, service: "chaser-backend" }));

app.use("/api/auth", authRouter);
app.use("/api/overview", overviewRouter);
app.use("/api/inbox", inboxRouter);
app.use("/api/invoices", invoicesRouter);
app.use("/api/customers", customersRouter);
app.use("/api/integrations", integrationsRouter);
app.use("/api/jobs", jobsRouter);

app.use((req, res) => res.status(404).json({ error: "Not found" }));

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

// Create the records table/index on boot if they don't exist yet — safe to
// run on every startup, including redeploys, since it's all IF NOT EXISTS.
ensureSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Chaser backend listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to connect to Postgres / prepare schema:", err);
    process.exit(1);
  });
