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
import { analyticsRouter } from "./routes/analytics";

const app = express();

const allowedOrigins = new Set(
  (process.env.FRONTEND_ORIGIN || "https://chaser-frontend-two.vercel.app")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

if (process.env.NODE_ENV !== "production") {
  allowedOrigins.add("http://localhost:5173");
  allowedOrigins.add("http://127.0.0.1:5173");
}

app.use(
  cors({
    origin(origin, callback) {
      // Permit requests without an Origin header (e.g. health checks/server-to-server).
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin not allowed by CORS"));
    },
  }),
);
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true, service: "chaser-backend" }));

app.use("/api/auth", authRouter);
app.use("/api/overview", overviewRouter);
app.use("/api/inbox", inboxRouter);
app.use("/api/invoices", invoicesRouter);
app.use("/api/customers", customersRouter);
app.use("/api/integrations", integrationsRouter);
app.use("/api/jobs", jobsRouter);
app.use("/api/analytics", analyticsRouter);

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
