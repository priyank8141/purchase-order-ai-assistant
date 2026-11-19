import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readonlyDatabaseUrl } from "../config";
import { appPool, closePools } from "./client";
import { ensureReadonlyRole } from "./readonlyRole";

async function main(): Promise<void> {
  const pool = appPool();
  const client = await pool.connect();
  try {
    // pg_trgm must exist before the migration that creates the trigram index.
    await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  } finally {
    client.release();
  }

  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  console.log("✓ migrations applied");

  const roleClient = await pool.connect();
  try {
    const user = await ensureReadonlyRole(roleClient, readonlyDatabaseUrl());
    console.log(`✓ read-only role "${user}" configured`);
  } finally {
    roleClient.release();
  }
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePools());
