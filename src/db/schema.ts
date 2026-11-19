import {
  bigint,
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// ERP tables (read by the agent through the read-only connection)
// All money is stored as integer cents to avoid floating point errors.
// bigint mode "number" is safe here: demo amounts are far below 2^53.
// ---------------------------------------------------------------------------

export const poStatus = pgEnum("po_status", [
  "draft",
  "pending_approval",
  "approved",
  "partially_delivered",
  "delivered",
  "cancelled",
]);

export const paymentStatus = pgEnum("payment_status", ["unpaid", "partially_paid", "paid"]);

export const suppliers = pgTable(
  "suppliers",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
    code: text("code").notNull().unique(),
    city: text("city").notNull(),
    country: text("country").notNull(),
    category: text("category").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Trigram index powers fuzzy supplier search (pg_trgm similarity / ILIKE).
  (t) => [index("suppliers_name_trgm_idx").using("gin", t.name.op("gin_trgm_ops"))],
);

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: serial("id").primaryKey(),
    poNumber: text("po_number").notNull().unique(),
    supplierId: integer("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    status: poStatus("status").notNull(),
    orderDate: date("order_date").notNull(),
    expectedDeliveryDate: date("expected_delivery_date").notNull(),
    deliveredDate: date("delivered_date"),
    totalAmountCents: bigint("total_amount_cents", { mode: "number" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    createdBy: text("created_by").notNull(),
  },
  (t) => [
    index("purchase_orders_supplier_idx").on(t.supplierId),
    index("purchase_orders_status_idx").on(t.status),
    index("purchase_orders_order_date_idx").on(t.orderDate),
  ],
);

export const poItems = pgTable(
  "po_items",
  {
    id: serial("id").primaryKey(),
    poId: integer("po_id")
      .notNull()
      .references(() => purchaseOrders.id),
    itemName: text("item_name").notNull(),
    sku: text("sku").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceCents: bigint("unit_price_cents", { mode: "number" }).notNull(),
    quantityReceived: integer("quantity_received").notNull().default(0),
  },
  (t) => [index("po_items_po_idx").on(t.poId)],
);

export const payments = pgTable(
  "payments",
  {
    id: serial("id").primaryKey(),
    poId: integer("po_id")
      .notNull()
      .references(() => purchaseOrders.id),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    // Needed to represent partially_paid: outstanding = amount - amount_paid.
    amountPaidCents: bigint("amount_paid_cents", { mode: "number" }).notNull().default(0),
    dueDate: date("due_date").notNull(),
    paidDate: date("paid_date"),
    status: paymentStatus("status").notNull(),
  },
  (t) => [index("payments_po_idx").on(t.poId), index("payments_due_date_idx").on(t.dueDate)],
);

// ---------------------------------------------------------------------------
// App tables (written by the app connection; the agent role cannot read them)
// ---------------------------------------------------------------------------

export const userRole = pgEnum("user_role", ["warehouse", "accounts", "admin"]);

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  // The role is fixed when the conversation is created. The API reads it from
  // here, never from the request body, so a client can't escalate mid-chat.
  role: userRole("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    // Full Claude content blocks (text, tool_use, tool_result).
    content: jsonb("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.id)],
);

export const traces = pgTable(
  "traces",
  {
    id: serial("id").primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userQuestion: text("user_question").notNull(),
    toolsCalled: jsonb("tools_called").notNull().default([]),
    finalAnswer: text("final_answer"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    // null = validation not applicable (e.g. no numbers / clarification turn).
    validationPassed: boolean("validation_passed"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("traces_created_idx").on(t.createdAt)],
);
