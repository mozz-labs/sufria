// Empirical check that the four primitives in critical-primitives.ts actually
// compile and execute against real PostgreSQL through Drizzle — rather than
// being taken on faith from the docs.
//
// Section 6 extends the same discipline to the CHECK constraints added in
// 0010: they are the safety net order creation leans on (task C brief §8), and
// a constraint nobody has watched reject anything is a comment, not a net.
// Section 7 does the same for 0011's order number and currency, and section 8
// for 0014's «an archived item is never available».
// Section 9 checks 0015's partial index for the reorder suggestion.
//
// Every order inserted here carries an explicit order_number (0011: NOT NULL,
// no default), and no two orders of the same restaurant in one section share
// one — so a UNIQUE violation can never stand in for the constraint a case is
// actually about.
import { drizzle } from "drizzle-orm/node-postgres";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigserial,
  numeric,
  boolean,
  integer,
  pgEnum,
} from "drizzle-orm/pg-core";
import { sql, and, eq, inArray, lt, isNotNull } from "drizzle-orm";
import { Pool } from "pg";

const webhookSource = pgEnum("webhook_source", ["whatsapp", "payment_gateway"]);
const orderStatus = pgEnum("order_status", [
  "pending_acceptance",
  "accepted",
  "preparing",
  "ready",
  "completed",
  "cancelled",
  "expired",
]);
const paymentStatus = pgEnum("payment_status", [
  "pending_cash",
  "pending_online",
  "paid",
  "collected",
  "refunded",
]);
const fulfillmentType = pgEnum("fulfillment_type", ["pickup", "delivery"]);
const paymentMethod = pgEnum("payment_method", ["online", "cash"]);
const convState = pgEnum("conversation_state", [
  "new",
  "browsing",
  "cart_review",
  "fulfillment_choice",
  "awaiting_payment",
  "order_placed",
  "abandoned",
]);

const processedWebhookEvents = pgTable("processed_webhook_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  eventId: text("event_id").notNull(),
  source: webhookSource("source").notNull(),
});

const orders = pgTable("orders", {
  id: uuid("id").primaryKey(),
  restaurantId: uuid("restaurant_id").notNull(),
  fulfillmentType: fulfillmentType("fulfillment_type").notNull(),
  paymentMethod: paymentMethod("payment_method").notNull(),
  status: orderStatus("status").notNull(),
  paymentStatus: paymentStatus("payment_status").notNull(),
  paymentGatewayRef: text("payment_gateway_ref"),
  readyAt: timestamp("ready_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  total: numeric("total").notNull(),
  notified: boolean("notified").notNull(),
  outboundMsgCount: integer("outbound_msg_count").notNull(),
});

const conversationSessions = pgTable("conversation_sessions", {
  id: uuid("id").primaryKey(),
  state: convState("state").notNull(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull(),
});

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

// Every statement against a restaurant-scoped table must carry tenant
// context — exactly as TenantDbService does in production:
// set_config(..., true) is transaction-local. Without it this test only
// passes when the connecting role bypasses RLS (a superuser), which is
// precisely what hid the defect: CI ran as postgres.
const RID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const withTenant = (tx: { execute: (q: unknown) => Promise<unknown> }) =>
  tx.execute(sql`SELECT set_config('app.current_restaurant_id', ${RID}, true)`);

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
};

async function main() {
  console.log(
    "verifying the four critical primitives against PostgreSQL 16 via drizzle-orm\n",
  );

  // --- 1. ON CONFLICT DO NOTHING ... RETURNING (event-level dedup) ---------
  await db.execute(
    sql`DELETE FROM processed_webhook_events WHERE event_id = 'wamid.TEST'`,
  );
  const first = await db
    .insert(processedWebhookEvents)
    .values({ eventId: "wamid.TEST", source: "whatsapp" })
    .onConflictDoNothing({
      target: [processedWebhookEvents.eventId, processedWebhookEvents.source],
    })
    .returning({ id: processedWebhookEvents.id });
  const second = await db
    .insert(processedWebhookEvents)
    .values({ eventId: "wamid.TEST", source: "whatsapp" })
    .onConflictDoNothing({
      target: [processedWebhookEvents.eventId, processedWebhookEvents.source],
    })
    .returning({ id: processedWebhookEvents.id });
  check("1. dedup gate: first delivery claims the event", first.length === 1);
  check(
    "1. dedup gate: redelivery is rejected",
    second.length === 0,
    `rows=${second.length}`,
  );

  // Same event id, different source, must be independent
  const other = await db
    .insert(processedWebhookEvents)
    .values({ eventId: "wamid.TEST", source: "payment_gateway" })
    .onConflictDoNothing({
      target: [processedWebhookEvents.eventId, processedWebhookEvents.source],
    })
    .returning({ id: processedWebhookEvents.id });
  check(
    "1. dedup gate: (event_id, source) is the key, not event_id alone",
    other.length === 1,
  );

  // --- 2. compare-and-swap on state ---------------------------------------
  const sid = "77777777-7777-4777-8777-777777777777";
  const [cas1, cas2] = await db.transaction(async (tx) => {
    await withTenant(tx);
    await tx.execute(sql`DELETE FROM conversation_sessions WHERE id = ${sid}`);
    await tx.execute(sql`
    INSERT INTO conversation_sessions (id, restaurant_id, customer_id, state, last_message_at)
    VALUES (${sid}, ${RID}, 'c0000000-0000-4000-8000-00000000000a', 'fulfillment_choice', now())`);

    const a = await tx
      .update(conversationSessions)
      .set({ state: "order_placed", lastMessageAt: new Date() })
      .where(
        and(
          eq(conversationSessions.id, sid),
          eq(conversationSessions.state, "fulfillment_choice"),
        ),
      )
      .returning({ id: conversationSessions.id });
    const b = await tx
      .update(conversationSessions)
      .set({ state: "order_placed", lastMessageAt: new Date() })
      .where(
        and(
          eq(conversationSessions.id, sid),
          eq(conversationSessions.state, "fulfillment_choice"),
        ),
      )
      .returning({ id: conversationSessions.id });
    return [a, b];
  });
  check("2. CAS: first confirm tap wins", cas1.length === 1);
  check(
    "2. CAS: double-tap produces no second order",
    cas2.length === 0,
    `rows=${cas2.length}`,
  );

  // --- 3. SELECT ... FOR UPDATE -------------------------------------------
  const forUpdateSql = db
    .select()
    .from(orders)
    .where(eq(orders.id, "00000000-0000-4000-8000-000000000000"))
    .for("update")
    .toSQL().sql;
  check(
    "3. row lock: FOR UPDATE emitted",
    /for update/i.test(forUpdateSql),
    forUpdateSql.slice(-24),
  );

  await db.transaction(async (tx) => {
    await withTenant(tx);
    const rows = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.id, "f0000000-0000-4000-8000-00000000000a"))
      .for("update");
    check("3. row lock: executes and returns the row", rows.length === 1);
  });

  // --- 4. FOR UPDATE SKIP LOCKED ------------------------------------------
  const skipSql = db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.status, "ready"),
        isNotNull(orders.readyAt),
        lt(orders.readyAt, sql`now() - interval '24 hours'`),
      ),
    )
    .limit(100)
    .for("update", { skipLocked: true })
    .toSQL().sql;
  check(
    "4. scheduler claim: SKIP LOCKED emitted",
    /skip locked/i.test(skipSql),
    skipSql.slice(-32),
  );

  const stuckSql = db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.paymentStatus, "pending_online"),
        inArray(orders.status, [
          "pending_acceptance",
          "accepted",
          "preparing",
          "ready",
        ]),
        lt(orders.createdAt, sql`now() - interval '2 hours'`),
      ),
    )
    .limit(100)
    .for("update", { skipLocked: true })
    .toSQL().sql;
  check(
    "4. scheduler claim: 2h payment-timeout query builds",
    /skip locked/i.test(stuckSql),
  );

  // Two concurrent workers must claim disjoint sets, not block each other.
  // The fixture holds one order per restaurant, and this check needs two
  // rows visible inside the same tenant boundary — so add a temporary
  // order for the same restaurant and remove it afterwards.
  const TMP = "f0000000-0000-4000-8000-0000000000aa";
  await db.transaction(async (tx) => {
    await withTenant(tx);
    // 9001: the fixture's own order for this restaurant is 101.
    await tx.execute(sql`
      INSERT INTO orders (id, restaurant_id, customer_id, order_number, fulfillment_type,
                          payment_method, status, payment_status, subtotal, total, ready_at)
      VALUES (${TMP}, ${RID}, 'c0000000-0000-4000-8000-00000000000a', 9001, 'pickup',
              'cash', 'ready', 'pending_cash', 5.00, 5.00, now() - interval '30 hours')`);
    await tx.execute(sql`
      UPDATE orders SET status='ready', ready_at = now() - interval '30 hours'
      WHERE id = 'f0000000-0000-4000-8000-00000000000a'`);
  });
  const poolB = new Pool({ connectionString: process.env.DATABASE_URL });
  const dbB = drizzle(poolB);
  let disjoint = false;
  await db.transaction(async (txA) => {
    await withTenant(txA);
    const a = await txA
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.status, "ready"))
      .limit(1)
      .for("update", { skipLocked: true });
    await dbB.transaction(async (txB) => {
      await withTenant(txB);
      const b = await txB
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.status, "ready"))
        .limit(1)
        .for("update", { skipLocked: true });
      disjoint = a.length === 1 && b.length === 1 && a[0].id !== b[0].id;
    });
  });
  check(
    "4. scheduler claim: two workers get disjoint rows (no double-processing)",
    disjoint,
  );
  await poolB.end();

  // Restore: keeps the test re-runnable, and section 5 expects exactly one
  // order visible for this restaurant.
  await db.transaction(async (tx) => {
    await withTenant(tx);
    await tx.execute(sql`DELETE FROM orders WHERE id = ${TMP}`);
    await tx.execute(sql`
      UPDATE orders SET status='pending_acceptance', ready_at = NULL
      WHERE id = 'f0000000-0000-4000-8000-00000000000a'`);
  });

  // --- 5. RLS context through drizzle transaction --------------------------
  await db.execute(sql`SET ROLE sufria_dashboard`);
  const rid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const scoped = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.current_restaurant_id', ${rid}, true)`,
    );
    return tx.select({ id: orders.id }).from(orders);
  });
  check(
    "5. RLS: bind-parameter set_config inside a drizzle tx scopes the query",
    scoped.length === 1,
    `rows=${scoped.length}`,
  );
  const afterTx = await db.select({ id: orders.id }).from(orders);
  check(
    "5. RLS: context does not survive the transaction (no pool leak)",
    afterTx.length === 0,
    `rows=${afterTx.length}`,
  );
  await db.execute(sql`RESET ROLE`);

  // --- 6. 0010 order constraints ------------------------------------------
  // The order-creation transaction (task C brief §8) writes orders,
  // order_items and order_status_history together and leans on these three
  // CHECKs to fail the whole thing rather than let a wrong order reach the
  // kitchen. A constraint nobody has ever seen reject anything is a comment.
  //
  // Each case violates exactly ONE constraint: the other two are satisfied on
  // purpose, so a passing check names the constraint that actually fired
  // rather than whichever one happened to be evaluated first.
  const CID = "c0000000-0000-4000-8000-00000000000a";
  // A fresh number per statement, clear of the fixture's 101: each case below
  // must be rejected by its own constraint, never by the UNIQUE one.
  let orderNumber = 9100;
  const insertOrder = (cols: string, vals: string) =>
    sql.raw(`
    INSERT INTO orders (id, restaurant_id, customer_id, order_number, payment_method,
                        status, payment_status, ${cols})
    VALUES (gen_random_uuid(), '${RID}', '${CID}', ${++orderNumber}, 'cash',
            'pending_acceptance', 'pending_cash', ${vals})`);

  // Asserts on the pg error's own `constraint` field, which drizzle keeps on
  // `cause`. Not a substring search of the message: that text also carries the
  // failed statement, so a query mentioning the name would pass without the
  // constraint ever firing.
  const rejects = async (
    label: string,
    constraint: string,
    stmt: unknown,
    tenant = RID,
  ) => {
    let fired: string | undefined;
    let inserted = false;
    try {
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT set_config('app.current_restaurant_id', ${tenant}, true)`,
        );
        await tx.execute(stmt as never);
      });
      inserted = true;
    } catch (e) {
      fired = (e as { cause?: { constraint?: string } }).cause?.constraint;
    }
    check(
      label,
      fired === constraint,
      inserted
        ? "INSERT SUCCEEDED — the constraint did not fire"
        : fired === constraint
          ? ""
          : `fired ${fired ?? "nothing nameable"} instead`,
    );
  };

  await rejects(
    "6. orders_total_is_subtotal_plus_fee: total that is not subtotal + fee",
    "orders_total_is_subtotal_plus_fee",
    // pickup, fee 0, address NULL — the other two constraints are satisfied.
    insertOrder(
      "fulfillment_type, subtotal, delivery_fee, total",
      "'pickup', 5.00, 0, 6.00",
    ),
  );

  await rejects(
    "6. orders_pickup_has_no_delivery_data: pickup carrying a delivery fee",
    "orders_pickup_has_no_delivery_data",
    // 5.00 + 1.50 = 6.50, so the total constraint holds and only this fires.
    insertOrder(
      "fulfillment_type, subtotal, delivery_fee, total",
      "'pickup', 5.00, 1.50, 6.50",
    ),
  );

  await rejects(
    "6. orders_pickup_has_no_delivery_data: pickup carrying an address",
    "orders_pickup_has_no_delivery_data",
    insertOrder(
      "fulfillment_type, subtotal, delivery_fee, total, delivery_address",
      "'pickup', 5.00, 0, 5.00, 'الشميساني، شارع عبد الحميد شرف، بناية 12'",
    ),
  );

  await rejects(
    "6. orders_delivery_has_address: delivery with no address at all",
    "orders_delivery_has_address",
    insertOrder(
      "fulfillment_type, subtotal, delivery_fee, total, delivery_address",
      "'delivery', 5.00, 1.50, 6.50, NULL",
    ),
  );

  await rejects(
    "6. orders_delivery_has_address: address longer than 300 characters",
    "orders_delivery_has_address",
    // 301 — the bound the engine enforces before it ever gets here (§3).
    insertOrder(
      "fulfillment_type, subtotal, delivery_fee, total, delivery_address",
      "'delivery', 5.00, 1.50, 6.50, repeat('ا', 301)",
    ),
  );

  await rejects(
    "6. orders_delivery_has_address: whitespace-only address",
    "orders_delivery_has_address",
    // btrim is why this fails: char_length alone would call it 5 characters.
    insertOrder(
      "fulfillment_type, subtotal, delivery_fee, total, delivery_address",
      "'delivery', 5.00, 1.50, 6.50, '     '",
    ),
  );

  // 🔴 The control. Without it, CHECK (false) would pass all six above and
  //    no order could ever be created — the constraints must still accept a
  //    correct delivery order, fee and address and arithmetic together.
  let accepted = false;
  await db
    .transaction(async (tx) => {
      await withTenant(tx);
      await tx.execute(
        insertOrder(
          "fulfillment_type, subtotal, delivery_fee, total, delivery_address",
          "'delivery', 5.00, 1.50, 6.50, 'الشميساني، شارع عبد الحميد شرف، بناية 12'",
        ) as never,
      );
      accepted = true;
      // Roll back: this file leaves the fixture exactly as it found it.
      tx.rollback();
    })
    .catch(() => {});
  check(
    "6. control: a correct delivery order is still accepted",
    accepted,
    accepted ? "" : "the three constraints reject everything",
  );

  // --- 7. 0011 order number and currency ----------------------------------
  // The engine allocates order_number under a per-restaurant advisory lock
  // (task D brief §2.1). These are what catch a writer that gets it wrong —
  // and the UNIQUE one is the net under the lock itself: without the lock two
  // concurrent orders read the same MAX, and the second one lands here.
  const numberedOrder = (n: string) =>
    sql.raw(`
    INSERT INTO orders (id, restaurant_id, customer_id, order_number, payment_method,
                        status, payment_status, fulfillment_type, subtotal, total)
    VALUES (gen_random_uuid(), '${RID}', '${CID}', ${n}, 'cash',
            'pending_acceptance', 'pending_cash', 'pickup', 5.00, 5.00)`);

  await rejects(
    "7. orders_order_number_positive: order number 0",
    "orders_order_number_positive",
    numberedOrder("0"),
  );

  await rejects(
    "7. orders_restaurant_order_number_unique: a second 101 in one restaurant",
    "orders_restaurant_order_number_unique",
    // The fixture's own order for this restaurant is 101.
    numberedOrder("101"),
  );

  // A writer that forgets the number. NOT NULL has no constraint name in
  // PostgreSQL 16, so the error's own code and column are what name it.
  let nullFired = false;
  let nullInserted = false;
  try {
    await db.transaction(async (tx) => {
      await withTenant(tx);
      await tx.execute(
        sql.raw(`
        INSERT INTO orders (id, restaurant_id, customer_id, payment_method,
                            status, payment_status, fulfillment_type, subtotal, total)
        VALUES (gen_random_uuid(), '${RID}', '${CID}', 'cash',
                'pending_acceptance', 'pending_cash', 'pickup', 5.00, 5.00)`) as never,
      );
    });
    nullInserted = true;
  } catch (e) {
    const cause = (e as { cause?: { code?: string; column?: string } }).cause;
    nullFired = cause?.code === "23502" && cause.column === "order_number";
  }
  check(
    "7. order_number NOT NULL: an order written without a number",
    nullFired,
    nullInserted
      ? "INSERT SUCCEEDED — something supplied a number nobody asked for"
      : nullFired
        ? ""
        : "rejected for another reason",
  );

  // restaurants' policy is id = current restaurant, so a new restaurant can
  // only be inserted with its own id as the context — which is what lets
  // this INSERT reach the CHECK instead of being stopped by RLS first.
  const NEW_RID = "aaaaaaaa-0011-4aaa-8aaa-aaaaaaaaaaaa";
  const newRestaurant = (currencyCol: string, currencyVal: string) =>
    sql.raw(`
    INSERT INTO restaurants (id, name${currencyCol})
    VALUES ('${NEW_RID}', 'مطعم فحص 0011'${currencyVal})
    RETURNING currency`);

  await rejects(
    "7. restaurants_currency_check: a currency outside JOD/ILS",
    "restaurants_currency_check",
    newRestaurant(", currency", ", 'USD'"),
    NEW_RID,
  );

  await rejects(
    "7. restaurants_currency_check: lower-case 'jod' — the labels are keyed on the exact code",
    "restaurants_currency_check",
    newRestaurant(", currency", ", 'jod'"),
    NEW_RID,
  );

  // 🔴 The controls, rolled back. Without them CHECK (false) and a UNIQUE on
  //    restaurant_id alone would pass every case above.
  const acceptedValue = async (
    stmt: unknown,
    tenant: string,
  ): Promise<string | null> => {
    let value: string | null = null;
    await db
      .transaction(async (tx) => {
        await tx.execute(
          sql`SELECT set_config('app.current_restaurant_id', ${tenant}, true)`,
        );
        const r = (await tx.execute(stmt as never)) as unknown as {
          rows: Record<string, unknown>[];
        };
        value = String(r.rows[0]?.["currency"] ?? "inserted");
        tx.rollback();
      })
      .catch(() => {});
    return value;
  };

  const numbered = await acceptedValue(numberedOrder("9201"), RID);
  check(
    "7. control: a fresh positive number in the same restaurant is accepted",
    numbered !== null,
    numbered === null ? "the order-number constraints reject everything" : "",
  );

  const ils = await acceptedValue(
    newRestaurant(", currency", ", 'ILS'"),
    NEW_RID,
  );
  check("7. control: an ILS restaurant is accepted", ils === "ILS", `${ils}`);

  // DEFAULT 'JOD' is what keeps every restaurant that predates 0011 — and
  // every test that creates one without naming a currency — as it was.
  const defaulted = await acceptedValue(newRestaurant("", ""), NEW_RID);
  check(
    "7. control: a restaurant with no currency named gets JOD",
    defaulted === "JOD",
    `${defaulted}`,
  );

  // --- 8. 0014 an archived item is never available ------------------------
  // The guarantee under the dashboard API (brief ي-أ §2), and the reason the
  // engine needed no change for archiving: it already treats
  // is_available = false as «not on the menu».
  //
  // 🔴 Every statement here is rolled back, rejected or not. A constraint that
  //    stopped firing must not leave an archived, available item in restaurant
  //    A's menu for the next suite to trip over — which `rejects` above would
  //    do, since it commits whatever gets through.
  const ITEM_A = "e0000000-0000-4000-8000-00000000000a";
  const CATEGORY_A = "d0000000-0000-4000-8000-00000000000a";
  const ROLLED_BACK = new Error("rolled back on purpose");
  type Attempt =
    | { accepted: true }
    | { accepted: false; code?: string; constraint?: string };
  const attempt = async (stmt: unknown): Promise<Attempt> => {
    try {
      await db.transaction(async (tx) => {
        await withTenant(tx);
        await tx.execute(stmt as never);
        throw ROLLED_BACK;
      });
    } catch (e) {
      if (e === ROLLED_BACK) return { accepted: true };
      const cause = (e as { cause?: { code?: string; constraint?: string } })
        .cause;
      return {
        accepted: false,
        code: cause?.code,
        constraint: cause?.constraint,
      };
    }
    return { accepted: true };
  };
  const firedArchiveCheck = (a: Attempt): boolean =>
    !a.accepted &&
    a.code === "23514" &&
    a.constraint === "menu_items_archived_not_available";
  const archiveDetail = (a: Attempt): string =>
    a.accepted
      ? "ACCEPTED — the constraint did not fire"
      : firedArchiveCheck(a)
        ? ""
        : `rejected by ${a.constraint ?? "nothing nameable"} (${a.code ?? "?"}) instead`;

  const insertedAvailable = await attempt(
    sql.raw(`
    INSERT INTO menu_items (restaurant_id, category_id, name, price, is_available, archived_at)
    VALUES ('${RID}', '${CATEGORY_A}', 'صنف فحص 0014', 2.50, true, now())`),
  );
  check(
    "8. menu_items_archived_not_available: an archived item written available (23514)",
    firedArchiveCheck(insertedAvailable),
    archiveDetail(insertedAvailable),
  );

  // The very UPDATE a dashboard bug would run: archive and switch on at once.
  const archivedAndOn = await attempt(
    sql.raw(`
    UPDATE menu_items SET archived_at = now(), is_available = true
     WHERE id = '${ITEM_A}'`),
  );
  check(
    "8. menu_items_archived_not_available: an item archived and switched on in one UPDATE (23514)",
    firedArchiveCheck(archivedAndOn),
    archiveDetail(archivedAndOn),
  );

  // 🔴 The control. Without it CHECK (false) would pass both cases above, and
  //    no item could ever be archived.
  const archivedOff = await attempt(
    sql.raw(`
    INSERT INTO menu_items (restaurant_id, category_id, name, price, is_available, archived_at)
    VALUES ('${RID}', '${CATEGORY_A}', 'صنف فحص 0014', 2.50, false, now())`),
  );
  check(
    "8. control: an archived item that is switched off is accepted",
    archivedOff.accepted,
    archivedOff.accepted ? "" : `rejected (${archivedOff.code ?? "?"})`,
  );

  // --- 9. 0015 the customer's recent orders (brief ك §3) ------------------
  // The reorder suggestion asks two questions of one customer's orders: any
  // non-cancelled one in the last N minutes, and the latest accepted one. One
  // partial index serves both — on the very condition the first one asks.
  //
  // 🔴 The whole definition, not "an index of that name exists": an index on
  //    the same columns but WHERE status = 'completed' (0002's) answers the
  //    second question for completed orders alone, and the planner then scans
  //    every order of the customer for the first, with no test failing.
  const recent = await pool.query<{ def: string | null }>(
    `SELECT pg_get_indexdef(i.indexrelid) AS def
       FROM pg_index i
       JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname = 'idx_orders_customer_recent'`,
  );
  const recentDef = recent.rows[0]?.def ?? null;
  check(
    "9. idx_orders_customer_recent exists",
    recentDef !== null,
    recentDef === null ? "missing" : "",
  );
  const expectedRecentDef =
    "CREATE INDEX idx_orders_customer_recent ON public.orders USING btree (customer_id, created_at DESC) " +
    "WHERE (status <> ALL (ARRAY['cancelled'::order_status, 'expired'::order_status]))";
  check(
    "9. idx_orders_customer_recent: (customer_id, created_at DESC), partial on status NOT IN ('cancelled', 'expired')",
    recentDef === expectedRecentDef,
    recentDef === expectedRecentDef ? "" : `${recentDef ?? "—"}`,
  );

  console.log(
    `\n${failures === 0 ? "ALL PRIMITIVES VERIFIED" : failures + " FAILED"}`,
  );
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
