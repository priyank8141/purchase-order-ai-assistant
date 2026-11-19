/**
 * Demo-wide settings. "Today" is pinned (DEMO_TODAY) so that seed data,
 * relative phrases like "this quarter", and eval expectations stay reproducible.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name} (see .env.example)`);
  return value;
}

/** ISO date string, e.g. "2026-11-15". */
export function demoToday(): string {
  const value = process.env.DEMO_TODAY ?? "2026-11-15";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`DEMO_TODAY must be YYYY-MM-DD, got "${value}"`);
  }
  return value;
}

export function demoCurrency(): string {
  return process.env.DEMO_CURRENCY ?? "USD";
}

export function databaseUrl(): string {
  return requireEnv("DATABASE_URL");
}

export function readonlyDatabaseUrl(): string {
  return requireEnv("DATABASE_URL_READONLY");
}
