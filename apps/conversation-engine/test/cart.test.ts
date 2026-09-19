/**
 * ب-4 · السلّة — اختبارات على قاعدة حقيقية.
 *
 * كل اختبار بيمشي المسار الحقيقي: `handleInbound` (أو الـwebhook كاملا لما
 * الاختبار عن طبقة منع التكرار)، والتحقق بيقرأ `context` من القاعدة فوق RLS
 * باتصال التدقيق — مش من نفس الكود اللي كتبه.
 *
 * المواصفة: بريف السلّة §14 (وما قبله: §5 · §12 · §13).
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "@jest/globals";
import { createHmac, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Pool } from "pg";
import {
  CART_EMPTY_AR,
  CART_EMPTY_ON_FINISH_AR,
  CART_REMOVE_HINT_AR,
  FINISH_HINT_AR,
  MENU_HEADER_AR,
  MENU_COMMANDS_TAIL_AR,
  RESTAURANT_NAME_SLOT,
  WELCOME_AR,
  handoffMessageAr,
  nothingUnderstoodAr,
} from "@sufria/shared";

import { env } from "../src/config/env.js";
import { ConversationService } from "../src/conversation/session.service.js";
import { TenantDb } from "../src/db/tenant-db.js";
import { createWebhookServer, WEBHOOK_PATH } from "../src/http/server.js";
import { RecordingWhatsAppSender } from "../src/whatsapp/sender.js";
import { WebhookService } from "../src/whatsapp/webhook.service.js";

const RUN = randomUUID();
const wamid = (label: string): string => `wamid.CART.${RUN}.${label}`;
const phoneId = (label: string): string => `PHONE.CART.${RUN}.${label}`;

let customerSeq = 0;
const nextCustomer = (): string =>
  `96278${String(++customerSeq).padStart(7, "0")}`;

const ALWAYS_OPEN_HOURS = {
  days: Object.fromEntries(
    ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map((d) => [
      d,
      [{ open: "00:00", close: "23:59" }],
    ]),
  ),
};

const PHONE = "0790000123";

let db: TenantDb;
let audit: Pool;
let replies: RecordingWhatsAppSender;
let conversation: ConversationService;
let server: Server;
let baseUrl: string;
const createdRestaurants: string[] = [];

// --- تجهيز -----------------------------------------------------------------

interface Shop {
  restaurantId: string;
  pid: string;
  from: string;
  /** معرّف الصنف بالاسم. */
  ids: Record<string, string>;
  /** رسالة من الزبون بالمسار الحقيقي. */
  say: (body: string | null) => Promise<string>;
  /** آخر رد انبعث للزبون، أو `undefined`. */
  last: () => string | undefined;
  /** `context` جلسة الزبون، مقروءا فوق RLS. */
  context: () => Promise<Record<string, unknown>>;
}

/**
 * مطعم مفتوح بتصنيف واحد، وزبون فتح جلسته واستلم المنيو. الردود بتتصفّر
 * بعد الترحيب، فالاختبار بيبلّش من «المنيو وصل».
 */
async function shop(opts: {
  label: string;
  items: { name: string; price: string }[];
  contactPhone?: string | null;
}): Promise<Shop> {
  const pid = phoneId(opts.label);
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO restaurants (name, whatsapp_phone_id, status, business_hours, contact_phone)
     VALUES ($1, $2, 'active'::restaurant_status, $3::jsonb, $4) RETURNING id`,
    [
      `مطعم ${RUN}`,
      pid,
      JSON.stringify(ALWAYS_OPEN_HOURS),
      opts.contactPhone === undefined ? PHONE : opts.contactPhone,
    ],
  );
  const restaurantId = rows[0]?.id ?? "";
  createdRestaurants.push(restaurantId);

  const cat = await audit.query<{ id: string }>(
    `INSERT INTO menu_categories (restaurant_id, name) VALUES ($1, 'مقبلات') RETURNING id`,
    [restaurantId],
  );
  const categoryId = cat.rows[0]?.id ?? "";
  const ids: Record<string, string> = {};
  for (const [i, item] of opts.items.entries()) {
    const r = await audit.query<{ id: string }>(
      `INSERT INTO menu_items (restaurant_id, category_id, name, price, display_order)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [restaurantId, categoryId, item.name, item.price, i],
    );
    ids[item.name] = r.rows[0]?.id ?? "";
  }

  const from = nextCustomer();
  const say = (body: string | null): Promise<string> =>
    db.runInTenant(restaurantId, (tx) =>
      conversation.handleInbound(tx, {
        restaurantId,
        phoneNumberId: pid,
        from,
        body,
      }),
    );

  expect(await say("مرحبا")).toBe("greeted");
  replies.reset();

  return {
    restaurantId,
    pid,
    from,
    ids,
    say,
    last: () => replies.forRestaurant(restaurantId).at(-1)?.body,
    context: async () => {
      const { rows: ctx } = await audit.query<{
        context: Record<string, unknown>;
      }>(
        `SELECT s.context FROM conversation_sessions s
           JOIN customers c ON c.id = s.customer_id
          WHERE s.restaurant_id = $1 AND c.phone_number = $2`,
        [restaurantId, from],
      );
      return ctx[0]?.context ?? {};
    },
  };
}

const stateOf = async (s: Shop): Promise<string> => {
  const { rows } = await audit.query<{ state: string }>(
    `SELECT s.state::text AS state FROM conversation_sessions s
       JOIN customers c ON c.id = s.customer_id
      WHERE s.restaurant_id = $1 AND c.phone_number = $2`,
    [s.restaurantId, s.from],
  );
  return rows[0]?.state ?? "";
};

type CartRow = {
  item_id: string;
  name: string;
  unit_price_minor: number;
  qty: number;
};
const cartOf = async (s: Shop): Promise<CartRow[]> =>
  ((await s.context())["cart"] as CartRow[] | undefined) ?? [];

/** بتسيب حلقة الأحداث تمشي كفاية لمعاملة تانية توصل لمكانها وتنحبس. */
const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 150));

async function postSigned(payload: unknown): Promise<Response> {
  const body = JSON.stringify(payload);
  const signature = `sha256=${createHmac("sha256", env().WHATSAPP_APP_SECRET)
    .update(body)
    .digest("hex")}`;
  return fetch(`${baseUrl}${WEBHOOK_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": signature,
    },
    body,
  });
}

function textMessage(pid: string, id: string, from: string, text: string) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_TEST",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "962790000000",
                phone_number_id: pid,
              },
              messages: [
                {
                  from,
                  id,
                  timestamp: "1757000000",
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

beforeAll(async () => {
  const url = process.env["MIGRATION_DATABASE_URL"];
  if (!url) throw new Error("MIGRATION_DATABASE_URL مفقود — انسخ .env.example");
  audit = new Pool({ connectionString: url, max: 2 });
  db = new TenantDb();
  await db.start();
  replies = new RecordingWhatsAppSender();
  conversation = new ConversationService(replies);
  server = createWebhookServer({
    service: new WebhookService(db, conversation),
    health: db,
    verifyToken: env().WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    appSecret: env().WHATSAPP_APP_SECRET,
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  replies.reset();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.stop();
  if (createdRestaurants.length > 0) {
    await audit.query("DELETE FROM restaurants WHERE id = ANY($1::uuid[])", [
      createdRestaurants,
    ]);
  }
  await audit.query(
    "DELETE FROM processed_webhook_events WHERE event_id LIKE $1",
    [`wamid.CART.${RUN}.%`],
  );
  await audit.end();
});

const TWO = [
  { name: "حمص", price: "2.50" },
  { name: "متبل", price: "6.30" },
];

// ===========================================================================
describe("الإضافة والمجموع", () => {
  it("🔴 إضافتان متتاليتان → مجموع السلّة صحيح بالقروش", async () => {
    const s = await shop({ label: "two-adds", items: TWO });

    await s.say("1");
    expect(s.last()).toBe(`أضفت: حمص ×1 — المجموع 2.50 د.أ\n${FINISH_HINT_AR}`);

    // 6.30 ×2 = 12.60 بالضبط — بالـfloat 6.3*2 ممكن تطلع 12.599999999999998.
    await s.say("2 ×2");
    expect(s.last()).toBe("أضفت: متبل ×2 — المجموع 15.10 د.أ");

    const cart = await cartOf(s);
    expect(cart.map((l) => [l.name, l.unit_price_minor, l.qty])).toEqual([
      ["حمص", 250, 1],
      ["متبل", 630, 2],
    ]);
    for (const l of cart)
      expect(Number.isInteger(l.unit_price_minor)).toBe(true);
  });

  it("إضافة أكثر من صنف برسالة: رأس، سطر لكل صنف، ثم مجموع السلّة", async () => {
    const s = await shop({ label: "multi-add", items: TWO });
    await s.say("1 و2");
    expect(s.last()).toBe(
      ["أضفت:", "حمص ×1", "متبل ×1", "المجموع 8.80 د.أ", FINISH_HINT_AR].join(
        "\n",
      ),
    );
  });

  it("الصنف المكرر بيندمج بسطره، والسطر بيعيد كمية الرسالة لا كمية السطر", async () => {
    const s = await shop({ label: "merge", items: TWO });
    await s.say("1");
    await s.say("1 ×2");
    expect(s.last()).toBe("أضفت: حمص ×2 — المجموع 7.50 د.أ");
    expect((await cartOf(s)).map((l) => l.qty)).toEqual([3]);
  });

  it("🔴 تذكير «تم» مرة واحدة بالجلسة — على الصنف الأول وحده", async () => {
    const s = await shop({ label: "hint-once", items: TWO });
    await s.say("1");
    expect(s.last()?.endsWith(FINISH_HINT_AR)).toBe(true);
    await s.say("2");
    expect(s.last()).not.toContain(FINISH_HINT_AR);

    // ولا حتى بعد ما تفضى السلّة وترجع تتعبّى.
    await s.say("شيل 1");
    await s.say("شيل 2");
    await s.say("1");
    expect(s.last()).not.toContain(FINISH_HINT_AR);
  });

  it("السعر snapshot: تغيير السعر بعد الإضافة ما بيغيّر السلّة", async () => {
    const s = await shop({ label: "snapshot", items: TWO });
    await s.say("1");
    await audit.query(`UPDATE menu_items SET price = 9.99 WHERE id = $1`, [
      s.ids["حمص"],
    ]);
    await s.say("سلة");
    expect(s.last()).toContain("1 · حمص ×1 — 2.50 د.أ");
  });
});

// ===========================================================================
describe("ترتيب الأسطر و partial", () => {
  it("🔴 النجاح أولا ثم المشاكل: إضافة · رقم غلط · سقف · جزء غير واضح", async () => {
    const s = await shop({ label: "order", items: TWO });
    await s.say("1 و15 و2 ×60 بدون بصل");
    expect(s.last()?.split("\n")).toEqual([
      "أضفت: حمص ×1 — المجموع 2.50 د.أ",
      "الرقم 15 غير موجود في المنيو. الأرقام من 1 إلى 2.",
      "الكمية 60 أكثر من الحد. الأقصى 50 للصنف الواحد.",
      "الجزء «بدون بصل» غير واضح — الطلب بالأرقام فقط.",
      FINISH_HINT_AR,
    ]);
  });

  it("سطر واحد لكل نوع مشكلة مهما تكرر — بنص الجمع", async () => {
    const s = await shop({ label: "plural", items: TWO });
    await s.say("1 و15 و16");
    expect(s.last()?.split("\n")[1]).toBe(
      "الأرقام 15، 16 غير موجودة في المنيو. الأرقام من 1 إلى 2.",
    );
  });

  it("🔴 partial بلا أصناف مضافة: لا «أضفت:» ولا مجموع — أسطر المشاكل وحدها", async () => {
    const s = await shop({ label: "partial-empty", items: TWO });
    await s.say("1 ×9999");
    expect(s.last()).toBe("الكمية 9999 أكثر من الحد. الأقصى 50 للصنف الواحد.");
    expect(await cartOf(s)).toEqual([]);
    // وما انبعث تذكير «تم» — ما في صنف انضاف.
    expect((await s.context())["finish_hint_sent"]).toBe(false);
  });

  it("🔴 السقف على السلّة عبر الرسائل: «1 ×30» ثم «1 ×30» = 60 مرفوضة", async () => {
    const s = await shop({ label: "cap-cart", items: TWO });
    await s.say("1 ×30");
    await s.say("1 ×30");
    expect(s.last()).toBe("الكمية 60 أكثر من الحد. الأقصى 50 للصنف الواحد.");
    expect((await cartOf(s)).map((l) => l.qty)).toEqual([30]);
  });
});

// ===========================================================================
describe("التوفّر — حيّ لحظة الإضافة", () => {
  it("🔴 صنف صار غير متوفر بعد المنيو: سطر خاص، لا «غير موجود في المنيو»", async () => {
    const s = await shop({ label: "unavailable", items: TWO });
    await audit.query(
      `UPDATE menu_items SET is_available = false WHERE id = $1`,
      [s.ids["حمص"]],
    );
    await s.say("1");
    expect(s.last()).toBe("الصنف حمص غير متوفر الآن.");
    expect(await cartOf(s)).toEqual([]);
  });

  it("🔴 غير المتوفر بيصفّر العدّاد — تعرّفنا على صنف حقيقي", async () => {
    const s = await shop({ label: "unavail-reset", items: TWO });
    await s.say("كلام");
    await s.say("كلام");
    expect((await s.context())["unparsed_streak"]).toBe(2);
    await audit.query(
      `UPDATE menu_items SET is_available = false WHERE id = $1`,
      [s.ids["حمص"]],
    );
    await s.say("1");
    // 🔴 التصفير لازم يكون من **رفض** كغير متوفر، مش من إضافة. بلا السطرين
    //    تحت، هالاختبار كان بيضل أخضر لو التوفّر انقرأ من الخريطة: الصنف
    //    بينضاف وبيصفّر العدّاد برضه — ضابط بينجح للسبب الغلط.
    expect(s.last()).toBe("الصنف حمص غير متوفر الآن.");
    expect(await cartOf(s)).toEqual([]);
    expect((await s.context())["unparsed_streak"]).toBe(0);
  });

  it("تصنيف انطفى = أصنافه غير متوفرة — نفس فلتر القائمة المعروضة", async () => {
    const s = await shop({ label: "cat-off", items: TWO });
    await audit.query(
      `UPDATE menu_categories SET is_active = false WHERE restaurant_id = $1`,
      [s.restaurantId],
    );
    await s.say("2");
    expect(s.last()).toBe("الصنف متبل غير متوفر الآن.");
  });
});

// ===========================================================================
describe("«سلة» و«شيل»", () => {
  it("«سلة» بتعرض الأصناف برقم المنيو، والمجموع، وذيل «شيل»", async () => {
    const s = await shop({ label: "show", items: TWO });
    await s.say("2 ×2 و1");
    await s.say("سلة");
    expect(s.last()).toBe(
      [
        "سلّتك:",
        "2 · متبل ×2 — 12.60 د.أ",
        "1 · حمص ×1 — 2.50 د.أ",
        "المجموع 15.10 د.أ",
        "لحذف صنف: «شيل» ورقمه",
      ].join("\n"),
    );
  });

  it("«سلة» والسلّة فارغة", async () => {
    const s = await shop({ label: "show-empty", items: TWO });
    await s.say("سلة");
    expect(s.last()).toBe(CART_EMPTY_AR);
  });

  it("«شيل» الناجح: السلّة بعد الحذف، والسطر كامل لا وحدة", async () => {
    const s = await shop({ label: "remove", items: TWO });
    await s.say("1 ×3 و2");
    await s.say("شيل 1");
    expect(s.last()).toBe(
      [
        "سلّتك:",
        "2 · متبل ×1 — 6.30 د.أ",
        "المجموع 6.30 د.أ",
        "لحذف صنف: «شيل» ورقمه",
      ].join("\n"),
    );
    expect((await cartOf(s)).map((l) => l.name)).toEqual(["متبل"]);
  });

  it("«شيل» أفرغ السلّة: نص السلّة الفارغة", async () => {
    const s = await shop({ label: "remove-last", items: TWO });
    await s.say("1");
    await s.say("شيل 1");
    expect(s.last()).toBe(CART_EMPTY_AR);
  });

  it("🔴 «شيل» على صنف ليس في السلّة: سطر وحده، بلا إعادة السلّة", async () => {
    const s = await shop({ label: "remove-absent", items: TWO });
    await s.say("1");
    await s.say("شيل 2");
    expect(s.last()).toBe("الصنف متبل غير موجود في سلّتك.");
    expect((await cartOf(s)).map((l) => l.name)).toEqual(["حمص"]);
  });

  it("«شيل» على رقم خارج الخريطة: سطر الرقم غير الموجود", async () => {
    const s = await shop({ label: "remove-unknown", items: TWO });
    await s.say("شيل 99");
    expect(s.last()).toBe("الرقم 99 غير موجود في المنيو. الأرقام من 1 إلى 2.");
  });
});

// ===========================================================================
describe("«منيو» و«تم»", () => {
  it("🔴 «منيو» بيعيد القائمة وبيستبدل الخريطة كاملة", async () => {
    const s = await shop({ label: "resend", items: TWO });
    const before = (await s.context())["menu_map"] as Record<string, string>;
    expect(Object.keys(before)).toHaveLength(2);

    await audit.query(
      `UPDATE menu_items SET is_available = false WHERE id = $1`,
      [s.ids["حمص"]],
    );
    await s.say("منيو");

    const body = s.last() ?? "";
    expect(body.startsWith(MENU_HEADER_AR)).toBe(true);
    expect(
      body.startsWith(
        WELCOME_AR.slice(0, WELCOME_AR.indexOf(RESTAURANT_NAME_SLOT)),
      ),
    ).toBe(false);
    expect(body.endsWith(MENU_COMMANDS_TAIL_AR)).toBe(true);

    // استبدال لا دمج: «1» صارت متبل، وما في «2» قديمة بتشير لحمص.
    const after = (await s.context())["menu_map"] as Record<string, string>;
    expect(after).toEqual({ "1": s.ids["متبل"] });
  });

  it("«تم» بتصفّر العدّاد زي أي أمر معروف", async () => {
    const s = await shop({ label: "finish-resets", items: TWO });
    await s.say("كلام");
    expect(await s.say("تم")).toBe("browsing");
    expect((await s.context())["unparsed_streak"]).toBe(0);
  });

  it("رسالة بلا نص (صورة) = ما انفهم منها شي", async () => {
    const s = await shop({ label: "image", items: TWO });
    await s.say(null);
    expect(s.last()).toBe(nothingUnderstoodAr(2));
    expect((await s.context())["unparsed_streak"]).toBe(1);
  });

  it("outbound_count بيعدّ كل رد، والصمت ما بينعدّ", async () => {
    const s = await shop({ label: "outbound", items: TWO });
    // الترحيب = 1.
    await s.say("1"); // 2
    await s.say("كلام"); // 3 — «الأرقام من 1 إلى N»
    await s.say("سلة"); // 4
    expect((await s.context())["outbound_count"]).toBe(4);
  });
});

// ===========================================================================
describe("العدّاد والاستسلام", () => {
  it("🔴 3 رسائل غير مفهومة → استسلام واحد بالرقم، ثم صمت", async () => {
    const s = await shop({ label: "handoff", items: TWO });
    for (const body of ["أ", "ب", "ج", "د"]) await s.say(body);
    expect(replies.forRestaurant(s.restaurantId).map((m) => m.body)).toEqual([
      nothingUnderstoodAr(2),
      nothingUnderstoodAr(2),
      handoffMessageAr(PHONE),
    ]);
    expect((await s.context())["handoff_sent"]).toBe(true);
  });

  it("🔴 contact_phone = NULL: لا رسالة استسلام إطلاقا، وhandoff_sent بينكتب", async () => {
    const s = await shop({
      label: "handoff-null",
      items: TWO,
      contactPhone: null,
    });
    for (const body of ["أ", "ب", "ج", "د"]) await s.say(body);
    expect(replies.forRestaurant(s.restaurantId).map((m) => m.body)).toEqual([
      nothingUnderstoodAr(2),
      nothingUnderstoodAr(2),
    ]);
    expect((await s.context())["handoff_sent"]).toBe(true);
  });

  it("بعد الاستسلام: رقم صحيح بيتخدم عاديا", async () => {
    const s = await shop({ label: "after-handoff", items: TWO });
    for (const body of ["أ", "ب", "ج"]) await s.say(body);
    await s.say("1");
    expect(s.last()?.startsWith("أضفت: حمص ×1")).toBe(true);
  });

  it("🔴 إضافة ناجحة بعد رسالتين غير مفهومتين بتصفّر العدّاد — قيد 2ج", async () => {
    const s = await shop({ label: "reset-2c", items: TWO });
    await s.say("أ");
    await s.say("ب");
    await s.say("1");
    expect((await s.context())["unparsed_streak"]).toBe(0);
    await s.say("ج");
    await s.say("د");
    expect(
      replies.forRestaurant(s.restaurantId).map((m) => m.body),
    ).not.toContain(handoffMessageAr(PHONE));
  });

  it("🔴 «1 ×9999» بين غير المفهوم بيصفّر العدّاد — لا استسلام", async () => {
    const s = await shop({ label: "overcap-reset", items: TWO });
    for (const body of ["أ", "ب", "1 ×9999", "ج"]) await s.say(body);
    expect((await s.context())["unparsed_streak"]).toBe(1);
    expect(
      replies.forRestaurant(s.restaurantId).map((m) => m.body),
    ).not.toContain(handoffMessageAr(PHONE));
  });

  it("🔴 القفل: رسالتان غير مفهومتين معا عند streak=2 → استسلام واحد، والعدّاد 4", async () => {
    // 🔴 مُرتَّب مش سباق، على نمط اختبار فرع التعارض: الفائز بيمشي المسار
    //    الحقيقي وبيمسك معاملته مفتوحة، فالخاسر بيوصل `FOR UPDATE` وبينحبس.
    //    بلا القفل، الخاسر بيقرأ streak=2 القديمة، وبيحسب 3، وبيبعت استسلاما
    //    تانيا — وقاعدة §14.1-3: القفل هو ما يمنعها، لا الترتيب.
    const s = await shop({ label: "lock", items: TWO });
    await s.say("أ");
    await s.say("ب");
    replies.reset();

    const ctx = {
      restaurantId: s.restaurantId,
      phoneNumberId: s.pid,
      from: s.from,
    };
    const winnerDb = new TenantDb();
    let releaseWinner = (): void => {};
    const winnerHeld = new Promise<void>((resolve) => {
      releaseWinner = resolve;
    });

    try {
      const winner = winnerDb.runInTenant(s.restaurantId, async (tx) => {
        await conversation.handleInbound(tx, { ...ctx, body: "ج" });
        await winnerHeld;
      });
      await settle();

      const loser = db.runInTenant(s.restaurantId, (tx) =>
        conversation.handleInbound(tx, { ...ctx, body: "د" }),
      );
      await settle();
      releaseWinner();
      await winner;
      await loser;
    } finally {
      releaseWinner();
      await winnerDb.stop();
    }

    const handoffs = replies
      .forRestaurant(s.restaurantId)
      .filter((m) => m.body === handoffMessageAr(PHONE));
    expect(handoffs).toHaveLength(1);
    const context = await s.context();
    expect(context["unparsed_streak"]).toBe(4);
    expect(context["handoff_sent"]).toBe(true);
  });
});

// ===========================================================================
describe("🔴 رسالتان متطابقتان ليستا تكرارا — §14.1-4", () => {
  it("«1» مرتين بمعرّفين مختلفين = صنفان. هاد السلوك الصح، لا «تصلحه»", async () => {
    const s = await shop({ label: "twice", items: TWO });
    for (const id of ["a", "b"]) {
      const res = await postSigned(
        textMessage(s.pid, wamid(`twice-${id}`), s.from, "1"),
      );
      expect(res.status).toBe(200);
    }
    expect((await cartOf(s)).map((l) => l.qty)).toEqual([2]);
  });

  it("ونفس المعرّف مرتين = صنف واحد — الطبقة الأولى على event_id وكفى", async () => {
    const s = await shop({ label: "redelivery", items: TWO });
    for (let i = 0; i < 2; i++) {
      const res = await postSigned(
        textMessage(s.pid, wamid("same"), s.from, "1"),
      );
      expect(res.status).toBe(200);
    }
    expect((await cartOf(s)).map((l) => l.qty)).toEqual([1]);
  });
});

// ===========================================================================
describe("ب-5 · «تم» → cart_review", () => {
  it("🔴 محادثة كاملة: منيو → إضافتان → «تم» → cart_review وسلّة كاملة", async () => {
    const s = await shop({ label: "finish-full", items: TWO });
    await s.say("1");
    await s.say("2 ×2");
    expect(await s.say("تم")).toBe("browsing");

    expect(await stateOf(s)).toBe("cart_review");
    expect(s.last()).toBe(
      [
        "سلّتك:",
        "1 · حمص ×1 — 2.50 د.أ",
        "2 · متبل ×2 — 12.60 د.أ",
        "المجموع 15.10 د.أ",
      ].join("\n"),
    );
  });

  it("🔴 رسالة cart_review بلا ذيل «شيل» — الأمر ما بيشتغل بعد الانتقال", async () => {
    const s = await shop({ label: "finish-no-hint", items: TWO });
    await s.say("1");
    await s.say("سلة");
    expect(s.last()).toContain(CART_REMOVE_HINT_AR);
    await s.say("تم");
    expect(s.last()).not.toContain(CART_REMOVE_HINT_AR);
  });

  it("🔴 «تم» على سلّة فارغة: لا انتقال ولا CAS، رسالة وبس", async () => {
    const s = await shop({ label: "finish-empty", items: TWO });
    expect(await s.say("تم")).toBe("browsing");
    expect(s.last()).toBe(CART_EMPTY_ON_FINISH_AR);
    expect(await stateOf(s)).toBe("browsing");
  });

  it("«تم» بعد الانتقال: الرسالة التانية ما بتمرق من معالج التصفّح", async () => {
    const s = await shop({ label: "finish-again", items: TWO });
    await s.say("1");
    await s.say("تم");
    const before = replies.forRestaurant(s.restaurantId).length;

    expect(await s.say("تم")).toBe("active_session");
    expect(replies.forRestaurant(s.restaurantId)).toHaveLength(before);
    expect(await stateOf(s)).toBe("cart_review");
  });

  it("🔴 «تم» مرتين بنفس اللحظة: انتقال واحد ورسالة واحدة — الـCAS", async () => {
    // مُرتَّب مش سباق: الفائز بيمسك معاملته مفتوحة، فالخاسر بينحبس على
    // `FOR UPDATE`، وبعد ما يفوت بيلاقي الحالة صارت cart_review فالـCAS
    // بترجّع صفر — تجاهل صامت، بلا رسالة تانية.
    const s = await shop({ label: "finish-race", items: TWO });
    await s.say("1");
    replies.reset();

    const ctx = {
      restaurantId: s.restaurantId,
      phoneNumberId: s.pid,
      from: s.from,
      body: "تم",
    };
    const winnerDb = new TenantDb();
    let releaseWinner = (): void => {};
    const winnerHeld = new Promise<void>((resolve) => {
      releaseWinner = resolve;
    });

    try {
      const winner = winnerDb.runInTenant(s.restaurantId, async (tx) => {
        await conversation.handleInbound(tx, ctx);
        await winnerHeld;
      });
      await settle();
      const loser = db.runInTenant(s.restaurantId, (tx) =>
        conversation.handleInbound(tx, ctx),
      );
      await settle();
      releaseWinner();
      await winner;
      await loser;
    } finally {
      releaseWinner();
      await winnerDb.stop();
    }

    expect(replies.forRestaurant(s.restaurantId)).toHaveLength(1);
    expect(await stateOf(s)).toBe("cart_review");
    // ولا عدّ رسالة ما انبعثت: الترحيب + سطر الإضافة + عرض السلّة = 3.
    expect((await s.context())["outbound_count"]).toBe(3);
  });
});
