import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { databaseUrl, readonlyDatabaseUrl } from "../config";
import * as schema from "./schema";

/**
 * Two separate pools:
 * - appDb:      the app's own connection (conversations, messages, traces).
 * - readonlyDb: the agent tools' connection. The `agent_readonly` role has
 *               SELECT on the four ERP tables only and runs every transaction
 *               read-only, so even a bug in a tool cannot write data.
 *
 * Pools are cached on globalThis so Next.js hot reload doesn't leak connections.
 */

type Db = NodePgDatabase<typeof schema>;

interface PoolCache {
  appPool?: Pool;
  readonlyPool?: Pool;
}

const cache = globalThis as typeof globalThis & { __poAssistantPools?: PoolCache };
const pools: PoolCache = (cache.__poAssistantPools ??= {});

export function appPool(): Pool {
  return (pools.appPool ??= new Pool({ connectionString: databaseUrl(), max: 5 }));
}

export function readonlyPool(): Pool {
  return (pools.readonlyPool ??= new Pool({ connectionString: readonlyDatabaseUrl(), max: 5 }));
}

export function appDb(): Db {
  return drizzle(appPool(), { schema });
}

export function readonlyDb(): Db {
  return drizzle(readonlyPool(), { schema });
}

export async function closePools(): Promise<void> {
  await Promise.all([pools.appPool?.end(), pools.readonlyPool?.end()]);
  pools.appPool = undefined;
  pools.readonlyPool = undefined;
}
