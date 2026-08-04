# Chaser — backend

A real, running API for the AR collections dashboard: auth, invoices, payments,
a matching engine, an escalation cadence, and adapters for Stripe, QuickBooks,
NetSuite, Bill.com, and Coupa.

## Quick start

You need a Postgres database running first — see "Local Postgres" below if
you don't have one. Once `chaser` database exists:

```bash
npm install
cp .env.example .env      # points at postgres://postgres:devpassword@localhost:5432/chaser by default
npm run seed               # creates the schema + a demo org + sample data
npm run dev                 # starts the API on http://localhost:4000
```

Demo login: `demo@chaser.app` / `password123`

Check it's alive:
```bash
curl http://localhost:4000/health
```

## How it's put together

```
src/
  index.ts              Express app + route mounting
  types.ts              Shared domain types (Invoice, Payment, Customer, ...)
  lib/
    db.ts                Postgres-backed datastore (see "Data layer: Postgres" below)
    auth.ts              Password hashing + JWT signing/verification
  middleware/
    requireAuth.ts        Reads the Bearer token, attaches { userId, orgId }
  routes/
    auth.ts               POST /api/auth/signup, /login
    overview.ts            GET  /api/overview           (dashboard metrics)
    inbox.ts                GET  /api/inbox               (unified event feed)
    invoices.ts             GET  /api/invoices, POST /:id/remind, /:id/escalate
    customers.ts             GET  /api/customers
    integrations.ts           GET  /api/integrations, POST /:provider/connect, /:provider/sync
    jobs.ts                    POST /api/jobs/escalation-sweep
  services/
    matching.ts            Matches incoming payments to open invoices
    escalation.ts           Runs the reminder → escalation cadence
  integrations/
    types.ts                The IntegrationAdapter interface every provider implements
    stripe.ts                Real Stripe API calls (live when a key is set)
    quickbooks.ts             Stub — OAuth2 flow documented inline
    netsuite.ts                Stub — OAuth1 TBA flow documented inline
    billcom.ts                  Stub — session-auth flow documented inline
    coupa.ts                     Stub — OAuth2 client-credentials flow documented inline
    registry.ts               Maps provider name → adapter
  seed.ts                 Populates demo data (mirrors the frontend prototype)
```

Every request is scoped by `orgId` pulled off the JWT — this is a multi-tenant
API from day one. I verified isolation: a second org signed up via `/signup`
sees zero invoices until it connects its own integrations.

## The two things worth understanding before you extend this

**1. Integration adapters are the extension point.**
Routes and services never call a vendor SDK directly — they call
`adapter.fetchInvoices()` / `adapter.fetchPayments()` / `adapter.connect()`.
Adding a new provider (Ariba, Sage, Xero, whatever) means writing one file
in `src/integrations/` that implements `IntegrationAdapter` — no changes to
routes, matching, or escalation logic. Stripe's adapter is fully wired to
the real API (tested against Stripe's live endpoint — a fake key correctly
comes back `403`). QuickBooks/NetSuite/Bill.com/Coupa are stubs with the
real endpoint, auth flow, and required credential shape documented in each
file's comment block — wiring them up is a few hours of API-mapping work
per provider, not a redesign.

**2. The matching engine is intentionally conservative.**
`services/matching.ts` tries an exact single-invoice match, then a
multi-invoice sum match (customer paid three invoices in one wire), then a
2%-tolerance fuzzy match — but a fuzzy match never auto-closes an invoice,
it posts to the inbox flagged for review instead. That mirrors the
product's own promise: automate the matching, but escalate ambiguity to a
human rather than silently guessing with someone's cash.

## Running the daily job

`runEscalationSweep(orgId)` is what decides "this invoice needs a reminder"
or "this invoice needs to escalate to a human," based on days-past-due. In
this build it's exposed as `POST /api/jobs/escalation-sweep` so you can
trigger it manually. In production, call it from a real scheduler — a cron
job or a queue worker (e.g. a nightly Railway cron job, a Vercel Cron
Function, or a `node-cron` process) — looping over every org once a day. It's
idempotent per invoice (tracked via `reminderCount`), so re-running it
safely no-ops on invoices that already got today's step.

## Data layer: Postgres

`src/lib/db.ts` is backed by real Postgres, not a JSON file. Storage model:
every domain row (organizations, users, invoices, payments, ...) lives as a
JSONB blob in one `records` table, keyed by `(table_name, id)`, with `org_id`
pulled into its own indexed column for fast per-tenant filtering. Every
route and service calls the same four methods it always did —
`db.table()`, `db.insert()`, `db.update()`, `db.find()` — they're just
async now and the data survives a restart or redeploy. I verified this
directly: seeded data, killed the server process (simulating a redeploy),
restarted it, and confirmed every invoice status change was still there.

`ensureSchema()` runs on every boot and is idempotent (`CREATE TABLE IF NOT
EXISTS`), so it's safe to leave in place across redeploys — it won't touch
existing data.

### Local Postgres

```bash
# macOS
brew install postgresql@16 && brew services start postgresql@16
createdb chaser

# Ubuntu/Debian
sudo apt-get install postgresql
sudo -u postgres createdb chaser
```
Then set `DATABASE_URL` in `.env` to point at it (see `.env.example`).

### On Railway

```bash
railway add            # choose PostgreSQL — this injects DATABASE_URL automatically
railway run npm run seed
```
Nothing else changes — `src/lib/db.ts` reads `process.env.DATABASE_URL` if
it's set, falling back to the local default otherwise.

### Splitting into real tables (optional, later)

The JSONB-blob model is a deliberate middle ground: real transactional
Postgres without a full relational schema up front. Once your data shape
has stabilized, moving a given table (say, `invoices`) to real typed
columns is incremental and low-risk:

1. Create a proper `invoices` table with typed columns matching `Invoice`
   in `src/types.ts`.
2. Write a one-off migration that reads `SELECT data FROM records WHERE
   table_name='invoices'` and inserts into the new table.
3. Change only `db.table("invoices")` / `insert("invoices", ...)` / etc.
   to hit the new table instead of the generic `records` table — every
   caller elsewhere in the app is unaffected, since they only ever go
   through `db.*`.

Do this table-by-table as it earns its complexity, not all at once.

### Remaining production hardening

- Move `credentials` on `IntegrationConnection` from plaintext JSON to an
  encrypted column or a secrets manager (AWS Secrets Manager / Vault) —
  right now they're stored as-is, which is fine for a prototype and not
  fine for real OAuth tokens.
- Add the scheduler for the escalation sweep (above).
- Add real webhook receivers for providers that support them (Stripe
  `payment_intent.succeeded`, Coupa payment-doc-uploaded events) so
  matching happens in near-real-time instead of only on manual/polled sync.

## Deploying

- **API**: Railway or Render both deploy a Node/Express app from this repo
  with almost no config — set `JWT_SECRET` and (once you're off the JSON
  store) a `DATABASE_URL`.
- **Frontend**: the dashboard artifact from earlier expects this API's
  shape (`/api/overview`, `/api/inbox`, etc.) — point its fetch calls at
  your deployed API URL and deploy the frontend itself to Vercel or
  Netlify.
- **Secrets**: never commit `.env` — `.env.example` documents every
  variable including where each vendor's real API key goes.

## Environment variables

See `.env.example`. `JWT_SECRET` and `PORT` are the only ones required to
run locally. Everything else is a real integration credential, only needed
once you connect a provider through `POST /api/integrations/:provider/connect`
(credentials are supplied per-request in that call, not read from env, so
each of your customers can connect their *own* Stripe/QuickBooks/etc.
accounts — the env vars are there for a server-side sandbox/testing setup
only).
