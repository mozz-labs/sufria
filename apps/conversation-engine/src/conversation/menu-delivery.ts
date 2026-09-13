import type { TenantTx } from "../db/types.js";
import { buildMenu, type MenuLine } from "../restaurant/menu.js";
import {
  OutboundTextTooLongError,
  assertWithinTextLimit,
  type WhatsAppSender,
} from "../whatsapp/sender.js";
import { mutateSessionData } from "./session-data.js";

/**
 * إرسال القائمة وكتابة `menu_map` — **فعل واحد لا ينفصل.**
 *
 * 🔴 هاد الملف هو **الطريق الوحيد** لإرسال نص قائمة. أي مسار بيحدّث النص بلا
 *    الخريطة هو الخطأ الصامت #2 ببريف السلّة §9: المطعم بيخفي صنفا، فأرقام
 *    الزبون بتشير لأصناف تانية، والطلب بيوصل المطبخ غلط **بلا ولا رسالة خطأ**.
 *
 *    والفصل ممنوع بنيويا مش بالانضباط: ما في طريقة تحصّل `PreparedMenu` غير
 *    `prepareMenu`، وما في مستهلك إلها غير `deliverMenu`. واختبار حراسة
 *    بيتأكد إنه ولا ملف تاني بيستورد من `restaurant/menu.js`.
 */

/**
 * قائمة مبنية وطولها مفحوص، جاهزة للتسليم.
 *
 * الحقول مقروءة فقط ومحدّ‍دة هون بالقصد: اللي بيمسك واحدة من هدول ما بيقدر
 * يبعتها بلا ما يمرق من `deliverMenu`.
 */
export interface PreparedMenu {
  /** النص كما بينبعت: البادئة (الترحيب أول مرة) + القائمة. */
  readonly body: string;
  readonly lines: readonly MenuLine[];
}

export type PrepareMenuResult =
  | { readonly ok: true; readonly menu: PreparedMenu }
  | { readonly ok: false; readonly error: OutboundTextTooLongError };

/**
 * بتقرأ القائمة، بتبني النص، وبتفحص طوله — **قبل ما تنفتح أي جلسة**.
 *
 * 🔴 الترتيب مقصود ومكتوب بـ`session.service.ts`: قائمة أطول من سقف واتساب
 *    مشكلة **دائمة** بتنحل بقائمة أقصر لا بإعادة محاولة. لو انفتحت جلسة،
 *    رسايل الزبون الجاية بتمرق من فرع "جلسة نشطة" وبيضل بلا قائمة للأبد.
 */
export async function prepareMenu(
  tx: TenantTx,
  prefix: string | null,
): Promise<PrepareMenuResult> {
  const menu = await buildMenu(tx);
  const body = prefix === null ? menu.text : `${prefix}\n${menu.text}`;

  try {
    assertWithinTextLimit(body);
  } catch (error) {
    if (!(error instanceof OutboundTextTooLongError)) throw error;
    return { ok: false, error };
  }

  return { ok: true, menu: { body, lines: menu.lines } };
}

/** `{"1": "<uuid>", "2": "<uuid>"}` من سطور القائمة المعروضة. */
function menuMapFrom(lines: readonly MenuLine[]): Record<string, string> {
  return Object.fromEntries(lines.map((l) => [String(l.number), l.itemId]));
}

export interface DeliverMenuArgs {
  readonly sessionId: string;
  readonly restaurantId: string;
  readonly phoneNumberId: string;
  readonly to: string;
  readonly menu: PreparedMenu;
  readonly now: Date;
}

/**
 * بتكتب الخريطة **وبعدين** بتبعت.
 *
 * 🔴 الترتيب هون هو الفرق بين عطل نعرفه وعطل صامت. الإرسال أثر جانبي برّا
 *    القاعدة وما بينسحب: لو بعتنا أولا وفشلت الكتابة، الزبون بيصير ماسك
 *    قائمة مرقّمة **وخريطتها مش مخزّنة** — وهاد الخطأ الصامت #2 بحاله. لو
 *    كتبنا أولا وفشلت الكتابة، ما انبعث ولا إشي وميتا بتعيد.
 *
 * 🔴 **الخريطة بتنستبدل كاملة، ما بتنضاف عليها.** إعادة إرسال القائمة عند
 *    «منيو» بترتّب من جديد — صنف انحذف بيروح رقمه، والأرقام بعده بتزحف.
 *    دمج القديم بالجديد بيخلّي رقما مهجورا يشير لصنف مختلف عن اللي بالشاشة.
 */
export async function deliverMenu(
  tx: TenantTx,
  sender: WhatsAppSender,
  args: DeliverMenuArgs,
): Promise<void> {
  await mutateSessionData(tx, args.sessionId, (current) => ({
    ...current,
    menu_map: menuMapFrom(args.menu.lines), // استبدال كامل — لا دمج
    menu_sent_at: args.now.toISOString(),
    outbound_count: current.outbound_count + 1,
  }));

  await sender.sendText({
    restaurantId: args.restaurantId,
    phoneNumberId: args.phoneNumberId,
    to: args.to,
    body: args.menu.body,
  });
}
