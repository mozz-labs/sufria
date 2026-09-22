import { itemsRemovedUnavailableLineAr, type Currency } from "@sufria/shared";

import type { TenantTx } from "../db/types.js";
import { buildMenu, type MenuLine } from "../restaurant/menu.js";
import { readCatalog, type Catalog } from "../restaurant/catalog.js";
import {
  OutboundTextTooLongError,
  assertWithinTextLimit,
  type WhatsAppSender,
} from "../whatsapp/sender.js";
import {
  readSessionData,
  writeSessionData,
  type CartLine,
} from "./session-data.js";

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
 *
 * 🔴 ولأن الخريطة بتنكتب هون وحدها، **فحص توفّر السلّة ساكن هون كمان**
 *    (§16): كل سطر بالسلّة بينفحص حيّا داخل نفس المعاملة، واللي ما عاد
 *    متوفرا بينحذف وبينقال للزبون. حطّه بمكان تاني بيعني إن مستدعيين
 *    (الترحيب و«منيو») لازم يتذكّروه كل واحد لحاله — وهاي هي الانضباط.
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
  currency: Currency,
): Promise<PrepareMenuResult> {
  const menu = await buildMenu(tx, currency);
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

/** نتيجة فحص التوفّر على سلّة قائمة. */
export interface PrunedCart {
  readonly cart: CartLine[];
  /** أسماء اللي انحذفوا، بترتيب السلّة. فاضية = ما تغيّر إشي. */
  readonly removed: string[];
}

/**
 * بتشيل من السلّة كل سطر صار غير متوفر — **صافية، بلا قاعدة**.
 *
 * 🔴 **المعيار هو التوفّر الحيّ، لا الغياب عن `menu_map`.** الخريطة سلطة على
 *    الترقيم وحده — الرقم 4 بيضل نفس الطبق — لا على التوفّر. اليوم
 *    الغياب عن الخريطة بيساوي عدم التوفّر **بالصدفة**: فلتر القائمة هو
 *    نفسه. لو أخفى المنيو يوما صنفا لسبب تاني — برّا ساعاته، حد أسطر،
 *    فلتر فئة — قاعدة «الغائب يُحذف» بتمسح أصنافا **متوفرة** من سلّة
 *    الزبون بصمت. فالمتوفر الغائب عن الخريطة **بيضل بالسلّة**، بلا رقم.
 *
 * صف انمسح كليا ما بيرجع من `readCatalog` إطلاقا — **بينحذف برضه**: صنف ما
 * عاد موجودا ما بيقدر يوصل المطبخ، والاسم محفوظ بالسطر فالرسالة صادقة.
 * (مسار **الإضافة** بيتصرّف غير هيك — §14.8 — لأنه ما عنده اسم محفوظ.)
 */
export function pruneUnavailable(
  cart: readonly CartLine[],
  catalog: Catalog,
): PrunedCart {
  const kept: CartLine[] = [];
  const removed: string[] = [];
  for (const line of cart) {
    const entry = catalog.get(line.item_id);
    if (entry === undefined || !entry.available) removed.push(line.name);
    else kept.push(line);
  }
  return { cart: kept, removed };
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
  // 🔴 `readSessionData` = `SELECT … FOR UPDATE`. القراءة والفحص والكتابة كلها
  //    **بمعاملة الرسالة نفسها**، فسلّة انقرأت هون ما بتتغيّر تحت إيدينا.
  const current = await readSessionData(tx, args.sessionId);
  const catalog = await readCatalog(
    tx,
    current.cart.map((l) => l.item_id),
  );
  const pruned = pruneUnavailable(current.cart, catalog);
  const notice =
    pruned.removed.length === 0
      ? null
      : itemsRemovedUnavailableLineAr(pruned.removed);

  await writeSessionData(tx, args.sessionId, {
    ...current,
    cart: pruned.cart,
    menu_map: menuMapFrom(args.menu.lines), // استبدال كامل — لا دمج
    menu_sent_at: args.now.toISOString(),
    // الإشعار رسالة صادرة زي غيرها، فبينعدّ. والعدّ بنفس الكتابة، لا بتانية.
    outbound_count: current.outbound_count + (notice === null ? 1 : 2),
  });

  await sender.sendText({
    restaurantId: args.restaurantId,
    phoneNumberId: args.phoneNumberId,
    to: args.to,
    body: args.menu.body,
  });

  // 🔴 **بعد** المنيو، برسالة لحالها. النص انفحص طوله كوحدة بـ`prepareMenu`،
  //    والإضافة عليه بعد الفحص بتكسر الضمانة. والسطر آخر شي بيشوفه الزبون.
  if (notice !== null) {
    await sender.sendText({
      restaurantId: args.restaurantId,
      phoneNumberId: args.phoneNumberId,
      to: args.to,
      body: notice,
    });
  }
}
