/**
 * ج-4 · ردود `cart_review` — على قاعدة حقيقية.
 *
 * كل اختبار بيمشي المسار الحقيقي عبر `handleInbound`، والتحقق بيقرأ `state`
 * و`context` من القاعدة باتصال تدقيق فوق RLS.
 *
 * المواصفة: بريف ج §3 (صفوف `cart_review`) و§2.3.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "@jest/globals";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  CART_REMOVE_HINT_AR,
  CONFIRM_PROMPT_AR,
  ORDER_CANCELLED_AR,
  fulfillmentAskAr,
  handoffMessageAr,
} from "@sufria/shared";

import { ConversationService } from "../src/conversation/session.service.js";
import { TenantDb } from "../src/db/tenant-db.js";
import { RecordingWhatsAppSender } from "../src/whatsapp/sender.js";

const RUN = randomUUID();
const phoneId = (label: string): string => `PHONE.REV.${RUN}.${label}`;

let customerSeq = 0;
const nextCustomer = (): string =>
  `96277${String(++customerSeq).padStart(7, "0")}`;

/** الحقل الفاضي = «مفتوح دايما» — المسار الموثّق الوحيد، بلا دقيقة ميتة. */
const ALWAYS_OPEN_HOURS = {};
const PHONE = "0790000123";

let db: TenantDb;
let audit: Pool;
let replies: RecordingWhatsAppSender;
let conversation: ConversationService;
const createdRestaurants: string[] = [];

interface Shop {
  restaurantId: string;
  say: (body: string | null) => Promise<string>;
  last: () => string | undefined;
  context: () => Promise<Record<string, unknown>>;
  state: () => Promise<string>;
}

/**
 * مطعم بصنفين وزبون وصل `cart_review` فعلا: منيو ← صنفان ← «تم»
 * (← سؤال الاستلام ← «استلام» لو المطعم بيوصّل).
 */
async function atCartReview(opts: {
  label: string;
  offersDelivery?: boolean;
  deliveryFee?: string;
  contactPhone?: string | null;
}): Promise<Shop> {
  const pid = phoneId(opts.label);
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO restaurants (name, whatsapp_phone_id, status, business_hours,
                              contact_phone, offers_delivery, delivery_fee)
     VALUES ($1, $2, 'active'::restaurant_status, $3::jsonb, $4, $5, $6)
     RETURNING id`,
    [
      `مطعم ${RUN}`,
      pid,
      JSON.stringify(ALWAYS_OPEN_HOURS),
      opts.contactPhone === undefined ? PHONE : opts.contactPhone,
      opts.offersDelivery ?? false,
      opts.deliveryFee ?? "0",
    ],
  );
  const restaurantId = rows[0]?.id ?? "";
  createdRestaurants.push(restaurantId);

  const cat = await audit.query<{ id: string }>(
    `INSERT INTO menu_categories (restaurant_id, name) VALUES ($1, 'مقبلات') RETURNING id`,
    [restaurantId],
  );
  const categoryId = cat.rows[0]?.id ?? "";
  for (const [i, item] of [
    { name: "شاورما عربي", price: "6.00" },
    { name: "حمص", price: "2.50" },
  ].entries()) {
    await audit.query(
      `INSERT INTO menu_items (restaurant_id, category_id, name, price, display_order)
       VALUES ($1, $2, $3, $4, $5)`,
      [restaurantId, categoryId, item.name, item.price, i],
    );
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

  const shop: Shop = {
    restaurantId,
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
    state: async () => {
      const { rows: r } = await audit.query<{ state: string }>(
        `SELECT s.state::text AS state FROM conversation_sessions s
           JOIN customers c ON c.id = s.customer_id
          WHERE s.restaurant_id = $1 AND c.phone_number = $2`,
        [restaurantId, from],
      );
      return r[0]?.state ?? "";
    },
  };

  expect(await say("مرحبا")).toBe("greeted");
  await say("1 ×2"); // شاورما ×2 = 12.00
  await say("2"); //    حمص ×1   =  2.50
  await say("تم");
  if (opts.offersDelivery === true) await say("استلام");
  expect(await shop.state()).toBe("cart_review");
  replies.reset();
  return shop;
}

beforeAll(async () => {
  const url = process.env["MIGRATION_DATABASE_URL"];
  if (!url) throw new Error("MIGRATION_DATABASE_URL مفقود — انسخ .env.example");
  audit = new Pool({ connectionString: url, max: 2 });
  db = new TenantDb();
  await db.start();
  replies = new RecordingWhatsAppSender();
  conversation = new ConversationService(replies);
});

afterEach(() => {
  replies.reset();
});

afterAll(async () => {
  await db.stop();
  if (createdRestaurants.length > 0) {
    await audit.query("DELETE FROM restaurants WHERE id = ANY($1::uuid[])", [
      createdRestaurants,
    ]);
  }
  await audit.end();
});

// ---------------------------------------------------------------------------

describe("«عدّل» — انتقال حالة حقيقي، و`fulfillment` بيضل", () => {
  it("🔴 «عدّل» ← browsing بنفس السلّة وبذيل «شيل»", async () => {
    const s = await atCartReview({ label: "modify" });

    expect(await s.say("عدّل")).toBe("cart_review");

    expect(await s.state()).toBe("browsing");
    const reply = s.last() ?? "";
    expect(reply).toContain("سلّتك:");
    expect(reply).toContain("1 · شاورما عربي ×2 — 12.00 د.أ");
    expect(reply).toContain("2 · حمص ×1 — 2.50 د.أ");
    expect(reply).toContain("المجموع 14.50 د.أ");
    // الذيل بيرجع: «شيل» بتشتغل بالتصفّح فعلا، فتعليمها هون صادق.
    expect(reply).toContain(CART_REMOVE_HINT_AR);
    expect((await s.context())["cart"]).toHaveLength(2);
  });

  it("🔴 «تم» بعد «عدّل» ← الملخّص **بلا** سؤال الاستلام", async () => {
    // هاد الفرق المقصود عن «عدّل» بـfulfillment_choice: هناك بتنمسح، وهون
    // بتضل — الزبون شاف الملخّص كامل ووافق ضمنا على طريقة الاستلام.
    const s = await atCartReview({
      label: "modify-keeps",
      offersDelivery: true,
      deliveryFee: "1.50",
    });
    expect((await s.context())["fulfillment"]).toEqual({ type: "pickup" });

    await s.say("عدّل");
    expect((await s.context())["fulfillment"]).toEqual({ type: "pickup" });

    await s.say("تم");

    expect(await s.state()).toBe("cart_review");
    const reply = s.last() ?? "";
    expect(reply).toContain("ملخّص طلبك:");
    expect(reply).not.toContain("أو توصيل؟");
    expect(reply).not.toBe(fulfillmentAskAr(150));
  });

  it("المسار الطبيعي كامل: عدّل ← شيل ← تم ← ملخّص أنقص", async () => {
    // 🔴 مطعم **بيوصّل** بقصد. بمطعم ما بيوصّل هالاختبار ما بيميّز: مسح
    //    `fulfillment` بيرجّعها `pickup` لحاله بالصفّ التالت من §3، فالمخرج
    //    بيطلع نفسه بالضبط وضابط الكسر بيضل أخضر. كشفه ضابط كسر ج-4.
    const s = await atCartReview({
      label: "modify-remove",
      offersDelivery: true,
      deliveryFee: "1.50",
    });

    await s.say("عدّل");
    await s.say("شيل 2"); // حمص برّا
    expect((await s.context())["cart"]).toHaveLength(1);

    await s.say("تم");

    expect(await s.state()).toBe("cart_review");
    const reply = s.last() ?? "";
    expect(reply).toContain("ملخّص طلبك:");
    expect(reply).toContain("المجموع 12.00 د.أ");
    expect(reply).not.toContain("حمص");
  });
});

describe("«ألغِ»", () => {
  it("🔴 «ألغِ» ← سلّة فارغة وbrowsing، ورقم الصنف بيشتغل فورا", async () => {
    const s = await atCartReview({ label: "cancel" });

    expect(await s.say("ألغِ")).toBe("cart_review");

    expect(s.last()).toBe(ORDER_CANCELLED_AR);
    expect(await s.state()).toBe("browsing");
    expect((await s.context())["cart"]).toEqual([]);
    expect((await s.context())["fulfillment"]).toBeUndefined();

    // 🔴 الوعد اللي بنص الإلغاء: `menu_map` بتضل صالحة، فبلا «منيو».
    await s.say("2");
    const cart = (await s.context())["cart"] as { name: string }[];
    expect(cart).toHaveLength(1);
    expect(cart[0]?.name).toBe("حمص");
  });

  it("«ألغِ» بتمسح `fulfillment` كمان — الطلب الجديد بينسأل من جديد", async () => {
    const s = await atCartReview({
      label: "cancel-fulfillment",
      offersDelivery: true,
      deliveryFee: "1.50",
    });

    await s.say("الغاء");
    await s.say("1");
    await s.say("تم");

    expect(await s.state()).toBe("fulfillment_choice");
    expect(s.last()).toBe(fulfillmentAskAr(150));
  });
});

describe("إعادة السؤال — المحلّل صارم، والصرامة معها توجيه", () => {
  it("🔴 «لا» ← إعادة السؤال، والسلّة كما هي", async () => {
    const s = await atCartReview({ label: "no" });

    expect(await s.say("لا")).toBe("cart_review");

    // «لا» المجرّدة ما بتلغي أبدا — بتحتمل «لا، استنّى».
    expect(s.last()).toBe(CONFIRM_PROMPT_AR);
    expect(await s.state()).toBe("cart_review");
    expect((await s.context())["cart"]).toHaveLength(2);
  });

  it("🔴 «تم» بـcart_review مش تأكيد — بيتعاد السؤال", async () => {
    const s = await atCartReview({ label: "finish-word" });

    await s.say("تم");

    expect(s.last()).toBe(CONFIRM_PROMPT_AR);
    expect(await s.state()).toBe("cart_review");
  });

  it("«تمام» و«تمام خلينا نكمل» بيتعاد فيهم السؤال", async () => {
    const s = await atCartReview({ label: "tamam" });

    for (const raw of ["تمام", "تمام خلينا نكمل"]) {
      await s.say(raw);
      expect(s.last()).toBe(CONFIRM_PROMPT_AR);
      expect(await s.state()).toBe("cart_review");
    }
  });

  it("🔴 «ما بدي اكد» ما بتخلق طلبا — ولا بتعدّ كمطابقة", async () => {
    const s = await atCartReview({ label: "negative" });

    await s.say("ما بدي اكد");

    expect(s.last()).toBe(CONFIRM_PROMPT_AR);
    expect(await s.state()).toBe("cart_review");
    expect((await s.context())["unparsed_streak"]).toBe(1);
  });

  it("رسالة بلا نص (صورة) بيتعاد فيها السؤال", async () => {
    const s = await atCartReview({ label: "nontext" });

    await s.say(null);

    expect(s.last()).toBe(CONFIRM_PROMPT_AR);
    expect(await s.state()).toBe("cart_review");
  });

  it("كل رسالة سؤال بتقول حرفيا شو يكتب", () => {
    for (const word of ["أكّد", "عدّل", "ألغِ"]) {
      expect(CONFIRM_PROMPT_AR).toContain(word);
    }
  });
});

describe("العدّاد — نفس قواعد `browsing` حرفيا", () => {
  it("🔴 تلات رسائل مش مطابقة ← رسالة الاستسلام مرة وحدة", async () => {
    const s = await atCartReview({ label: "streak" });

    await s.say("شو يعني؟");
    expect(s.last()).toBe(CONFIRM_PROMPT_AR);
    await s.say("ما فهمت");
    expect(s.last()).toBe(CONFIRM_PROMPT_AR);
    await s.say("مرحبا");
    expect(s.last()).toBe(handoffMessageAr(PHONE));
    expect((await s.context())["handoff_sent"]).toBe(true);

    // بعدها صمت على غير المفهوم وحده.
    replies.reset();
    await s.say("مرحبا كمان");
    expect(s.last()).toBeUndefined();

    // وأمر صحيح بعدها بينخدم عاديا — الاستسلام ما بيغلق المحادثة.
    await s.say("ألغِ");
    expect(await s.state()).toBe("browsing");
  });

  it("🔴 «أكّد» بتصفّر العدّاد — مطابقة، مهما كان فرعها لسا ج-5", async () => {
    const s = await atCartReview({ label: "confirm-resets" });

    await s.say("شو؟");
    await s.say("شو؟");
    expect((await s.context())["unparsed_streak"]).toBe(2);

    await s.say("أكّد");

    // القاعدة: بيصفّر على **أي** مطابقة. زبون بيكتب كلمة صحيحة ما بيصح
    // يتقدّم خطوة نحو الاستسلام لأن الميزة لسا ما انبنت.
    expect((await s.context())["unparsed_streak"]).toBe(0);
  });

  it("«استلام» بعد الملخّص: إعادة السؤال، وبتصفّر العدّاد", async () => {
    // تغيير طريقة الاستلام بعد الملخّص بيصير عبر «ألغِ» وبس (ج §13).
    const s = await atCartReview({ label: "pickup-after" });

    await s.say("شو؟");
    await s.say("استلام");

    expect(s.last()).toBe(CONFIRM_PROMPT_AR);
    expect(await s.state()).toBe("cart_review");
    expect((await s.context())["unparsed_streak"]).toBe(0);
  });

  it("رقم المطعم NULL ← الاستسلام صامت تماما، بلا نص بديل", async () => {
    const s = await atCartReview({ label: "nophone", contactPhone: null });

    await s.say("شو؟");
    await s.say("شو؟");
    replies.reset();
    await s.say("شو؟");

    expect(s.last()).toBeUndefined();
    expect((await s.context())["handoff_sent"]).toBe(true);
  });
});

describe("العدّ الصادر", () => {
  it("ولا عدّ لرسالة ما انبعثت — الصمت ما بينعدّ", async () => {
    const s = await atCartReview({ label: "outbound", contactPhone: null });
    const before = (await s.context())["outbound_count"] as number;

    await s.say("شو؟"); // ← رد
    await s.say("شو؟"); // ← رد
    await s.say("شو؟"); // ← استسلام صامت (الرقم NULL)

    expect((await s.context())["outbound_count"]).toBe(before + 2);
  });
});
