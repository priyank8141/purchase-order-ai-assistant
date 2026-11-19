import type { PoolClient } from "pg";

/** Tables the agent may read. Everything else (conversations, traces...) is off limits. */
export const AGENT_READABLE_TABLES = ["suppliers", "purchase_orders", "po_items", "payments"] as const;

/**
 * Creates/updates the `agent_readonly` role from DATABASE_URL_READONLY.
 * Done in code (not a SQL migration) because the password comes from env.
 * Idempotent: safe to run on every migrate.
 */
export async function ensureReadonlyRole(client: PoolClient, readonlyUrl: string): Promise<string> {
  const url = new URL(readonlyUrl);
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (!/^[a-z_][a-z0-9_]*$/.test(user)) {
    throw new Error(`Read-only username "${user}" must be a simple lowercase identifier`);
  }
  if (!password) throw new Error("DATABASE_URL_READONLY must include a password");

  const role = client.escapeIdentifier(user);
  const pwd = client.escapeLiteral(password);
  const { rows } = await client.query<{ db: string }>("SELECT current_database() AS db");
  const db = client.escapeIdentifier(rows[0]!.db);

  const exists = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [user]);
  if (exists.rowCount === 0) {
    await client.query(`CREATE ROLE ${role} LOGIN PASSWORD ${pwd}`);
  } else {
    await client.query(`ALTER ROLE ${role} LOGIN PASSWORD ${pwd}`);
  }

  // Start from zero, then grant only what is needed.
  await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${role}`);
  await client.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${role}`);
  await client.query(`GRANT CONNECT ON DATABASE ${db} TO ${role}`);
  await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
  const tables = AGENT_READABLE_TABLES.map((t) => client.escapeIdentifier(t)).join(", ");
  await client.query(`GRANT SELECT ON ${tables} TO ${role}`);

  // Defense in depth: even if a grant is wrong, every transaction is read-only,
  // and a runaway query is cut off quickly.
  await client.query(`ALTER ROLE ${role} SET default_transaction_read_only = on`);
  await client.query(`ALTER ROLE ${role} SET statement_timeout = '3s'`);
  return user;
}
