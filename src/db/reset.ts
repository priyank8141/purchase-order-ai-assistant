import "dotenv/config";
import { appPool, closePools } from "./client";

/** Drops all app + ERP tables and the migration journal. `db:reset` then re-migrates and re-seeds. */
async function main(): Promise<void> {
  const pool = appPool();
  await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await pool.query("CREATE SCHEMA public");
  console.log("✓ database reset");
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePools());
