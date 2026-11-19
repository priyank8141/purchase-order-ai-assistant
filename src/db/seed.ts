import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { demoCurrency, demoToday } from "../config";
import { appPool, closePools } from "./client";
import { generateSeedData } from "./generateSeed";
import * as schema from "./schema";

const CHUNK = 500;

function chunks<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
  return out;
}

/** Replaces all ERP data with the deterministic fake dataset. App tables (conversations, traces) are left alone. */
async function main(): Promise<void> {
  const today = demoToday();
  const data = generateSeedData(today, demoCurrency());
  const db = drizzle(appPool(), { schema });

  await db.transaction(async (tx) => {
    await tx.execute("TRUNCATE payments, po_items, purchase_orders, suppliers RESTART IDENTITY CASCADE");
    for (const c of chunks(data.suppliers)) await tx.insert(schema.suppliers).values(c);
    for (const c of chunks(data.orders)) await tx.insert(schema.purchaseOrders).values(c);
    for (const c of chunks(data.items)) await tx.insert(schema.poItems).values(c);
    for (const c of chunks(data.payments)) await tx.insert(schema.payments).values(c);
    // IDs were inserted explicitly, so move the sequences past them.
    for (const table of ["suppliers", "purchase_orders", "po_items", "payments"]) {
      await tx.execute(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), (SELECT max(id) FROM ${table}))`);
    }
  });

  console.log(
    `✓ seeded (today=${today}): ${data.suppliers.length} suppliers, ${data.orders.length} orders, ` +
      `${data.items.length} items, ${data.payments.length} payments`,
  );
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePools());
