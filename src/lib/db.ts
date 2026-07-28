import { Pool } from "pg";

/**
 * Postgres-backed datastore.
 *
 * Storage model: every domain row (organizations, users, invoices, ...)
 * is stored as a JSONB blob in one `records` table, keyed by
 * (table_name, id), with org_id pulled out into its own indexed column.
 * This is a deliberate middle ground: real Postgres durability and
 * transactional writes, without a full relational schema + migrations
 * per domain type. Every route/service still calls db.table() / insert()
 * / update() / find() exactly as before — only now they're async and
 * the data survives a redeploy.
 *
 * Going further (typed columns, foreign keys, real indexes per field)
 * is a reasonable next step once the schema has stabilized — see
 * README "Splitting into real tables" for how to do that incrementally,
 * table by table, without a big-bang rewrite.
 */

const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false,
});

export async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS records (
      table_name TEXT NOT NULL,
      id TEXT NOT NULL,
      org_id TEXT,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (table_name, id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_records_table_org ON records (table_name, org_id);`);
}

export const db = {
  async reset() {
    await pool.query("TRUNCATE records");
  },

  async table(name: string): Promise<any[]> {
    const res = await pool.query("SELECT data FROM records WHERE table_name = $1 ORDER BY created_at ASC", [name]);
    return res.rows.map((r) => r.data);
  },

  async insert(name: string, row: any) {
    await pool.query(
      "INSERT INTO records (table_name, id, org_id, data) VALUES ($1, $2, $3, $4)",
      [name, row.id, row.orgId ?? null, JSON.stringify(row)]
    );
    return row;
  },

  async update(name: string, id: string, patch: Record<string, any>): Promise<any | null> {
    const existing = await pool.query("SELECT data FROM records WHERE table_name = $1 AND id = $2", [name, id]);
    if (existing.rowCount === 0) return null;
    const merged = { ...existing.rows[0].data, ...patch };
    await pool.query(
      "UPDATE records SET data = $1, org_id = $2, updated_at = now() WHERE table_name = $3 AND id = $4",
      [JSON.stringify(merged), merged.orgId ?? null, name, id]
    );
    return merged;
  },

  async find(name: string, id: string): Promise<any | null> {
    const res = await pool.query("SELECT data FROM records WHERE table_name = $1 AND id = $2", [name, id]);
    return res.rowCount ? res.rows[0].data : null;
  },

  async close() {
    await pool.end();
  },
};
