/**
 * ج-3 · «تم» و`fulfillment_choice` وخطوة العنوان — على قاعدة حقيقية.
 *
 * كل اختبار بيمشي المسار الحقيقي عبر `handleInbound`، والتحقق بيقرأ `state`
 * و`context` من القاعدة باتصال تدقيق فوق RLS — مش من نفس الكود اللي كتبهم.
 *
 * المواصفة: بريف ج §3 (آلة الحالات) و§6 (النصوص) و§15.
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
  ADDRESS_ASK_AR,
  ADDRESS_TOO_LONG_AR,
  FULFILLMENT_PROMPT_AR,
  MAX_ADDRESS_LENGTH,
  ORDER_CANCELLED_AR,
  CART_REMOVE_HINT_AR,
  handoffMessageAr,
  fulfillmentAskAr,
} from "@sufria/shared";

import { ConversationService } from "../src/conversation/session.service.js";
import { TenantDb } from "../src/db/tenant-db.js";
import { RecordingWhatsAppSender } from "../src/whatsapp/sender.js";

const RUN = randomUUID();
const phoneId = (label: string): string => `PHONE.FUL.${RUN}.${label}`;

let customerSeq = 0;
const nextCustomer = (): string =>
  `96279${String(++customerSeq).padStart(7, "0")}`;

/**
 * 🔴 `{}` مش `{days:{… 00:00-23:59}}`. الحقل الفاضي = «مفتوح دايما» بقرار
 *    منتج، وهو **المسار الموثّق الوحيد** لمطعم 24 ساعة
 *    (`business-hours.ts`: `alwaysOpen: defined === 0`).
 *    نافذة `00:00-23:59` بتترك دقيقة ميتة كل يوم، والسويت بتسقط كلها لو
 *    اشتغلت فيها — صار فعلا بـ23:59:40 وقت كتابة هالملف.
 */
const ALWAYS_OPEN_HOURS = {};

const PHONE = "0790000123";

let db: TenantDb;
let audit: Pool;
let replies: RecordingWhatsAppSender;
let conversation: ConversationService;
const createdRestaurants: string[] = [];

interface Shop {
  restaurantId: string;
  from: string;
  say: (body: string | null) => Promise<string>;
  last: () => string | undefined;
  context: () => Promise<Record<string, unknown>>;
  state: () => Promise<string>;
  setFee: (fee: string) => Promise<void>;
}

/** مطعم مفتوح بصنفين، وزبون استلم المنيو وحطّ صنفا بالسلّة. */
async function shop(opts: {
  label: string;
  offersDelivery: boolean;
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
      opts.offersDelivery,
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

  expect(await say("مرحبا")).toBe("greeted");
  // صنف واحد بالسلّة: 1 ×2 = 12.00 د.أ.
  await say("1 ×2");
  replies.reset();

  const context = async (): Promise<Record<string, unknown>> => {
    const { rows: ctx } = await audit.query<{
      context: Record<string, unknown>;
    }>(
      `SELECT s.context FROM conversation_sessions s
         JOIN customers c ON c.id = s.customer_id
        WHERE s.restaurant_id = $1 AND c.phone_number = $2`,
      [restaurantId, from],
    );
    return ctx[0]?.context ?? {};
  };

  return {
    restaurantId,
    from,
    say,
    last: () => replies.forRestaurant(restaurantId).at(-1)?.body,
    context,
    state: async () => {
      const { rows: r } = await audit.query<{ state: string }>(
        `SELECT s.state::text AS state FROM conversation_sessions s
           JOIN customers c ON c.id = s.customer_id
          WHERE s.restaurant_id = $1 AND c.phone_number = $2`,
        [restaurantId, from],
      );
      return r[0]?.state ?? "";
    },
    setFee: async (fee: string) => {
      await audit.query(
        `UPDATE restaurants SET delivery_fee = $1 WHERE id = $2`,
        [fee, restaurantId],
      );
    },
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

describe("«تم» — الصفوف الأربعة الأولى من §3", () => {
  it("مطعم ما بيوصّل: «تم» بتوصّل للملخّص رأسا، بلا سؤال", async () => {
    const s = await shop({ label: "nodelivery", offersDelivery: false });

    expect(await s.say("تم")).toBe("browsing");

    expect(await s.state()).toBe("cart_review");
    const reply = s.last() ?? "";
    expect(reply).toContain("ملخّص طلبك:");
    expect(reply).toContain("الاستلام من المطعم");
    expect(reply).toContain("المجموع 12.00 د.أ");
    // 🔴 ولا سؤال استلام: الاستلام هو الخيار الوحيد، فالسؤال عنه ضجيج.
    expect(reply).not.toContain("أو توصيل؟");
    // وبلا ذيل «شيل» — الأمر ما بيشتغل بـcart_review.
    expect(reply).not.toContain(CART_REMOVE_HINT_AR);
    expect((await s.context())["fulfillment"]).toEqual({ type: "pickup" });
  });

  it("مطعم بيوصّل: «تم» ← سؤال ← «توصيل» ← عنوان ← ملخّص فيه الرسوم والعنوان", async () => {
    const s = await shop({
      label: "full",
      offersDelivery: true,
      deliveryFee: "1.50",
    });

    expect(await s.say("تم")).toBe("browsing");
    expect(await s.state()).toBe("fulfillment_choice");
    expect(s.last()).toBe(fulfillmentAskAr(150));
    expect(s.last()).toContain("رسوم التوصيل 1.50 د.أ");

    expect(await s.say("توصيل")).toBe("fulfillment_choice");
    expect(await s.state()).toBe("fulfillment_choice");
    expect(s.last()).toBe(ADDRESS_ASK_AR);
    expect((await s.context())["fulfillment"]).toEqual({
      type: "delivery",
      fee_minor: 150,
      address: null,
    });

    expect(await s.say("الشميساني، شارع عبد الحميد شرف، بناية 12")).toBe(
      "fulfillment_choice",
    );
    expect(await s.state()).toBe("cart_review");
    const reply = s.last() ?? "";
    expect(reply).toContain("التوصيل — 1.50 د.أ");
    expect(reply).toContain("المجموع 13.50 د.أ");
    expect(reply).toContain(
      "التوصيل إلى: الشميساني، شارع عبد الحميد شرف، بناية 12",
    );
  });
});

describe("خطوة العنوان", () => {
  /** يوصل لخطوة العنوان: «تم» ثم «توصيل». */
  async function atAddressStep(label: string, fee = "1.50"): Promise<Shop> {
    const s = await shop({ label, offersDelivery: true, deliveryFee: fee });
    await s.say("تم");
    await s.say("توصيل");
    replies.reset();
    return s;
  }

  it("«استلام» بخطوة العنوان ← ملخّص استلام بلا رسوم", async () => {
    const s = await atAddressStep("switchback");

    expect(await s.say("استلام")).toBe("fulfillment_choice");

    expect(await s.state()).toBe("cart_review");
    const reply = s.last() ?? "";
    expect(reply).toContain("الاستلام من المطعم");
    // 🔴 الرسوم بتختفي مع التبديل — ما عاد إلها معنى، والمجموع بيرجع 12.00.
    expect(reply).not.toContain("التوصيل —");
    expect(reply).toContain("المجموع 12.00 د.أ");
    expect((await s.context())["fulfillment"]).toEqual({ type: "pickup" });
  });

  it("🔴 «تم» و«منيو» و«سلة» و«أكّد» و«توصيل» ما بيصيروا عنوانا", async () => {
    const s = await atAddressStep("notaddress");

    for (const word of ["تم", "منيو", "سلة", "أكّد", "توصيل"]) {
      expect(await s.say(word)).toBe("fulfillment_choice");
      expect(s.last()).toBe(ADDRESS_ASK_AR);
      expect(await s.state()).toBe("fulfillment_choice");
      const f = (await s.context())["fulfillment"] as { address: unknown };
      // واحدة من هدول بسلّة السائق بتخلّي الطلب ما يوصل، بلا رسالة خطأ.
      expect(f.address).toBeNull();
    }
  });

  it("🔴 العنوان بينخزَّن حرفيا — «ة» و«أ» بيرجعوا زي ما هم", async () => {
    const s = await atAddressStep("verbatim");
    // التطبيع بيحوّل «ة»→«ه» و«أ»→«ا». سائق بيقرأ هاد النص.
    const address = "أم أذينة، عمارة رقم 3، بجانب مطعم الأصيل";

    await s.say(address);

    const f = (await s.context())["fulfillment"] as { address: string };
    expect(f.address).toBe(address);
    expect(s.last()).toContain(`التوصيل إلى: ${address}`);
  });

  it("العنوان بينقصّ من الأطراف وبس — المسافات الداخلية بتضل", async () => {
    const s = await atAddressStep("trim");

    await s.say("  الجاردنز، شارع  وصفي التل  ");

    const f = (await s.context())["fulfillment"] as { address: string };
    expect(f.address).toBe("الجاردنز، شارع  وصفي التل");
  });

  it("301 حرف ← نص «العنوان طويل»، والخطوة ما تغيّرت", async () => {
    const s = await atAddressStep("toolong");

    expect(await s.say("ا".repeat(MAX_ADDRESS_LENGTH + 1))).toBe(
      "fulfillment_choice",
    );

    expect(s.last()).toBe(ADDRESS_TOO_LONG_AR);
    expect(await s.state()).toBe("fulfillment_choice");
    const f = (await s.context())["fulfillment"] as { address: unknown };
    expect(f.address).toBeNull();

    // و300 بالضبط بتمر — السقف هو اللي بالنص، لا أقل.
    await s.say("ا".repeat(MAX_ADDRESS_LENGTH));
    expect(await s.state()).toBe("cart_review");
  });

  it("رسالة بلا نص (موقع · صورة) ← إعادة طلب العنوان", async () => {
    const s = await atAddressStep("nontext");

    expect(await s.say(null)).toBe("fulfillment_choice");

    expect(s.last()).toBe(ADDRESS_ASK_AR);
    expect(await s.state()).toBe("fulfillment_choice");
  });

  it("🔴 خطوة العنوان بلا عدّاد — ولا رسالة استسلام مهما تكررت", async () => {
    const s = await atAddressStep("nostreak");

    for (let i = 0; i < 4; i++) await s.say("منيو");

    expect((await s.context())["unparsed_streak"]).toBe(0);
    expect((await s.context())["handoff_sent"]).toBe(false);
    expect(s.last()).toBe(ADDRESS_ASK_AR);
  });
});

describe("snapshot الرسوم — وعد، لا قراءة حيّة", () => {
  it("🔴 المطعم رفع الرسوم بعد «توصيل»: الملخّص بالرسوم القديمة", async () => {
    const s = await shop({
      label: "snapshot",
      offersDelivery: true,
      deliveryFee: "1.50",
    });
    await s.say("تم");
    await s.say("توصيل"); // ← هون بينعمل الـsnapshot: 150 قرشا

    await s.setFee("9.99");
    await s.say("الشميساني");

    const reply = s.last() ?? "";
    // الزبون شاف 1.50 بالسؤال قبل ما يقرر. اللي بيدفعه لازم يكون اللي شافه.
    expect(reply).toContain("التوصيل — 1.50 د.أ");
    expect(reply).toContain("المجموع 13.50 د.أ");
    expect(reply).not.toContain("9.99");
    expect((await s.context())["fulfillment"]).toEqual({
      type: "delivery",
      fee_minor: 150,
      address: "الشميساني",
    });
  });

  it("رسوم صفر: السؤال والملخّص بلا سطر رسوم", async () => {
    const s = await shop({
      label: "zerofee",
      offersDelivery: true,
      deliveryFee: "0",
    });

    await s.say("تم");
    expect(s.last()).toBe(fulfillmentAskAr(0));
    expect(s.last()).not.toContain("رسوم التوصيل");

    await s.say("توصيل");
    await s.say("عمان");

    const reply = s.last() ?? "";
    expect(reply).not.toContain("التوصيل —");
    expect(reply).toContain("المجموع 12.00 د.أ");
  });
});

describe("«عدّل» و«ألغِ» — بالخطوتين", () => {
  it("«ألغِ» بخطوة النوع ← سلّة فارغة و`browsing`، والمنيو لسا صالح", async () => {
    const s = await shop({
      label: "cancel",
      offersDelivery: true,
      deliveryFee: "1.50",
    });
    await s.say("تم");
    replies.reset();

    expect(await s.say("ألغِ")).toBe("fulfillment_choice");

    expect(s.last()).toBe(ORDER_CANCELLED_AR);
    expect(await s.state()).toBe("browsing");
    expect((await s.context())["cart"]).toEqual([]);
    expect((await s.context())["fulfillment"]).toBeUndefined();

    // 🔴 الوعد اللي بنص الإلغاء: رقم الصنف بيشتغل فورا بلا «منيو».
    await s.say("2");
    const cart = (await s.context())["cart"] as { name: string }[];
    expect(cart).toHaveLength(1);
    expect(cart[0]?.name).toBe("حمص");
  });

  it("«ألغِ» بخطوة العنوان كمان", async () => {
    const s = await shop({
      label: "cancel2",
      offersDelivery: true,
      deliveryFee: "1.50",
    });
    await s.say("تم");
    await s.say("توصيل");
    replies.reset();

    await s.say("الغاء");

    expect(s.last()).toBe(ORDER_CANCELLED_AR);
    expect(await s.state()).toBe("browsing");
    expect((await s.context())["cart"]).toEqual([]);
  });

  it("«عدّل» ← `browsing` بنفس السلّة، و`fulfillment` بتنمسح", async () => {
    const s = await shop({
      label: "modify",
      offersDelivery: true,
      deliveryFee: "1.50",
    });
    await s.say("تم");
    await s.say("توصيل");
    replies.reset();

    await s.say("عدّل");

    expect(await s.state()).toBe("browsing");
    // السلّة زي ما هي، والعرض بذيل «شيل» — الأمر بيشتغل بالتصفّح.
    expect((await s.context())["cart"]).toHaveLength(1);
    expect(s.last()).toContain(CART_REMOVE_HINT_AR);
    // 🔴 بتنمسح: الزبون ما شاف الملخّص ولا وافق على طريقة الاستلام بعد.
    expect((await s.context())["fulfillment"]).toBeUndefined();

    // و«تم» تانية بتسأل من جديد.
    await s.say("تم");
    expect(await s.state()).toBe("fulfillment_choice");
    expect(s.last()).toBe(fulfillmentAskAr(150));
  });
});

describe("العدّاد بخطوة النوع — نفس قواعد `browsing` حرفيا", () => {
  it("ثلاث رسائل مش مطابقة ← رسالة الاستسلام مرة وحدة", async () => {
    const s = await shop({
      label: "streak",
      offersDelivery: true,
      deliveryFee: "1.50",
    });
    await s.say("تم");
    replies.reset();

    await s.say("شو يعني؟");
    expect(s.last()).toBe(FULFILLMENT_PROMPT_AR);
    await s.say("ما فهمت");
    expect(s.last()).toBe(FULFILLMENT_PROMPT_AR);
    await s.say("مرحبا");
    expect(s.last()).toBe(handoffMessageAr(PHONE));
    expect((await s.context())["handoff_sent"]).toBe(true);

    // بعدها صمت على غير المفهوم وحده.
    replies.reset();
    await s.say("مرحبا كمان");
    expect(s.last()).toBeUndefined();

    // وأمر صحيح بعد الاستسلام بينخدم عاديا — الاستسلام ما بيغلق المحادثة.
    await s.say("استلام");
    expect(await s.state()).toBe("cart_review");
  });

  it("مطابقة بتصفّر العدّاد", async () => {
    const s = await shop({
      label: "reset",
      offersDelivery: true,
      deliveryFee: "1.50",
    });
    await s.say("تم");
    await s.say("شو؟");
    await s.say("شو؟");
    expect((await s.context())["unparsed_streak"]).toBe(2);

    await s.say("توصيل");
    expect((await s.context())["unparsed_streak"]).toBe(0);
  });
});
