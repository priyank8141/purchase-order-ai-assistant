import { Faker, en } from "@faker-js/faker";
import { addDays, daysBetween, maxDate, minDate } from "../lib/dates";
import type { payments, poItems, purchaseOrders, suppliers } from "./schema";
import { CATALOG, SUPPLIERS } from "./seedReference";

type SupplierRow = typeof suppliers.$inferInsert & { id: number };
type OrderRow = typeof purchaseOrders.$inferInsert & { id: number };
type ItemRow = typeof poItems.$inferInsert & { id: number };
type PaymentRow = typeof payments.$inferInsert & { id: number };
type PoStatus = OrderRow["status"];
type PaymentStatus = PaymentRow["status"];

export interface SeedData {
  suppliers: SupplierRow[];
  orders: OrderRow[];
  items: ItemRow[];
  payments: PaymentRow[];
}

export const SEED = 20260101;
export const ORDER_COUNT = 300;

/**
 * Pure, deterministic generator: same (today, currency) -> same rows.
 * IDs are assigned here (not by Postgres) so the output is fully reproducible.
 */
export function generateSeedData(today: string, currency: string): SeedData {
  const f = new Faker({ locale: [en], seed: SEED });
  const int = (min: number, max: number) => f.number.int({ min, max });
  const chance = (p: number) => f.number.float({ min: 0, max: 1 }) < p;
  const pick = <T>(weighted: { weight: number; value: T }[]) => f.helpers.weightedArrayElement(weighted);

  const supplierRows: SupplierRow[] = SUPPLIERS.map((s, i) => ({
    id: i + 1,
    name: s.name,
    code: `SUP-${String(i + 1).padStart(3, "0")}`,
    city: s.city,
    country: s.country,
    category: s.category,
    createdAt: new Date(`${addDays(today, -400 - i * 7)}T09:00:00Z`),
  }));

  const buyers = Array.from({ length: 6 }, () => f.person.fullName());
  const supplierPicker = SUPPLIERS.map((s, i) => ({ weight: s.weight, value: i }));

  // 1. Order dates spread over the last 12 months, then sorted so PO numbers
  //    increase with time and carry the order's year (PO-2025-0007, PO-2026-0042).
  const drafts = Array.from({ length: ORDER_COUNT }, (_, idx) => ({
    idx,
    // ~20% of orders land in the last 30 days so there is plenty of in-flight work.
    orderDate: addDays(today, -(chance(0.2) ? int(0, 29) : int(0, 364))),
    supplierIdx: pick(supplierPicker),
  })).sort((a, b) => (a.orderDate === b.orderDate ? a.idx - b.idx : a.orderDate < b.orderDate ? -1 : 1));

  const orders: OrderRow[] = [];
  const items: ItemRow[] = [];
  const paymentRows: PaymentRow[] = [];
  const perYearCounter = new Map<string, number>();

  for (const draft of drafts) {
    const supplier = SUPPLIERS[draft.supplierIdx]!;
    const orderId = orders.length + 1;
    const year = draft.orderDate.slice(0, 4);
    const seq = (perYearCounter.get(year) ?? 0) + 1;
    perYearCounter.set(year, seq);

    const age = daysBetween(draft.orderDate, today);
    const status = pickStatus(age, pick);
    const expected = addDays(draft.orderDate, int(7, 45));

    let deliveredDate: string | null = null;
    if (status === "delivered") {
      const offset = chance(supplier.lateRate) ? int(1, 20) : int(-7, 0);
      deliveredDate = maxDate(addDays(draft.orderDate, 1), minDate(addDays(expected, offset), today));
    }

    // 2. Line items. Total is derived from items so the numbers are consistent.
    const catalog = CATALOG[supplier.category];
    const chosen = f.helpers.arrayElements(catalog, int(1, 5));
    let totalCents = 0;
    chosen.forEach((c, lineIdx) => {
      const quantity = int(1, 100) * 5;
      const unitPriceCents = int(c.minCents, c.maxCents);
      totalCents += quantity * unitPriceCents;
      items.push({
        id: items.length + 1,
        poId: orderId,
        itemName: c.name,
        sku: c.sku,
        quantity,
        unitPriceCents,
        quantityReceived: receivedQuantity(status, quantity, lineIdx, int, pick),
      });
    });

    orders.push({
      id: orderId,
      poNumber: `PO-${year}-${String(seq).padStart(4, "0")}`,
      supplierId: draft.supplierIdx + 1,
      status,
      orderDate: draft.orderDate,
      expectedDeliveryDate: expected,
      deliveredDate,
      totalAmountCents: totalCents,
      currency,
      createdBy: f.helpers.arrayElement(buyers),
    });

    // 3. Payments exist once an order is approved. Some are split in two.
    if (status === "approved" || status === "partially_delivered" || status === "delivered") {
      const terms = f.helpers.arrayElement([30, 45, 60]);
      const installments = chance(0.25) ? 2 : 1;
      const first = installments === 2 ? Math.floor(totalCents / 2) : totalCents;
      const amounts = installments === 2 ? [first, totalCents - first] : [first];
      amounts.forEach((amountCents, n) => {
        const dueDate = addDays(draft.orderDate, terms + n * 30);
        const payStatus = pickPaymentStatus(dueDate < today, status, pick);
        const amountPaidCents =
          payStatus === "paid" ? amountCents : payStatus === "partially_paid" ? Math.round(amountCents * f.number.float({ min: 0.2, max: 0.8 })) : 0;
        const paidDate =
          payStatus === "paid" ? maxDate(draft.orderDate, minDate(addDays(dueDate, int(-10, 10)), today)) : null;
        paymentRows.push({ id: paymentRows.length + 1, poId: orderId, amountCents, amountPaidCents, dueDate, paidDate, status: payStatus });
      });
    }
  }

  return { suppliers: supplierRows, orders, items, payments: paymentRows };
}

type Pick = <T>(weighted: { weight: number; value: T }[]) => T;

/** Older orders are mostly finished; recent ones are mostly still in progress. */
function pickStatus(ageDays: number, pick: Pick): PoStatus {
  if (ageDays < 14) {
    return pick<PoStatus>([
      { weight: 30, value: "draft" },
      { weight: 35, value: "pending_approval" },
      { weight: 30, value: "approved" },
      { weight: 5, value: "partially_delivered" },
      { weight: 5, value: "cancelled" },
    ]);
  }
  if (ageDays < 60) {
    return pick<PoStatus>([
      { weight: 3, value: "draft" },
      { weight: 10, value: "pending_approval" },
      { weight: 25, value: "approved" },
      { weight: 20, value: "partially_delivered" },
      { weight: 37, value: "delivered" },
      { weight: 5, value: "cancelled" },
    ]);
  }
  return pick<PoStatus>([
    { weight: 2, value: "pending_approval" },
    { weight: 5, value: "approved" },
    { weight: 8, value: "partially_delivered" },
    { weight: 78, value: "delivered" },
    { weight: 7, value: "cancelled" },
  ]);
}

function receivedQuantity(
  status: PoStatus,
  quantity: number,
  lineIdx: number,
  int: (min: number, max: number) => number,
  pick: Pick,
): number {
  if (status === "delivered") return quantity;
  if (status !== "partially_delivered") return 0;
  // First line is always partially received, so the order is genuinely "partial".
  const partial = () => Math.max(1, Math.floor((quantity * int(20, 90)) / 100));
  if (lineIdx === 0) return partial();
  return pick([
    { weight: 1, value: quantity },
    { weight: 1, value: partial() },
    { weight: 1, value: 0 },
  ]);
}

function pickPaymentStatus(isPastDue: boolean, orderStatus: PoStatus, pick: Pick): PaymentStatus {
  if (isPastDue) {
    // Orders still waiting on goods are more likely to have payment held back.
    const unpaidWeight = orderStatus === "delivered" ? 8 : 25;
    return pick<PaymentStatus>([
      { weight: 80, value: "paid" },
      { weight: 8, value: "partially_paid" },
      { weight: unpaidWeight, value: "unpaid" },
    ]);
  }
  return pick<PaymentStatus>([
    { weight: 15, value: "paid" },
    { weight: 10, value: "partially_paid" },
    { weight: 75, value: "unpaid" },
  ]);
}
