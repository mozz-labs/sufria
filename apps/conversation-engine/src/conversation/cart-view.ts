import {
  buildOrderSummary,
  cartMessageAr,
  type CartDisplayLine,
  type SummaryFulfillment,
} from "@sufria/shared";

import type { CartLine, SessionData } from "./session-data.js";

/**
 * عرض السلّة — الترقيم والمجموع والرسالتين اللي بتستعملاهم.
 *
 * 🔴 **مكان واحد للترقيم، مش نسخة بكل معالج.** الرقم بعرض السلّة لازم يكون
 *    نفس الرقم اللي بتقبله «شيل» ونفس اللي بالمنيو (§12.1 و§12.3-ب): نسخة
 *    بتتقادم معناها إن «شيل 2» بتحذف صنفا تاني عن اللي شافه الزبون، **بلا
 *    ولا رسالة خطأ**. كانت نسختين بج-3، وج-4 كانت رح تعملها تلاتة.
 */

/** مجموع السلّة **بالقروش** — أعداد صحيحة، بلا float بأي خطوة (ب §11.6-أ). */
export function cartTotalMinor(cart: readonly CartLine[]): number {
  return cart.reduce((sum, l) => sum + l.unit_price_minor * l.qty, 0);
}

/**
 * أسطر العرض **برقم الخريطة الحالية**. صنف ما عاد إله رقم بيرجع `null`،
 * فبينعرض بلا بادئة — ما في رقم صادق نعرضه (ب §14.8#2).
 */
export function displayLines(data: SessionData): CartDisplayLine[] {
  const numberOf = new Map<string, number>(
    Object.entries(data.menu_map).map(([n, id]) => [id, Number(n)]),
  );
  return data.cart.map((l) => ({
    menuNumber: numberOf.get(l.item_id) ?? null,
    name: l.name,
    qty: l.qty,
    lineTotalMinor: l.unit_price_minor * l.qty,
  }));
}

/** عرض السلّة بالتصفّح — بذيل «شيل» إلا لو انطلب غير هيك. */
export function renderCart(data: SessionData, removeHint = true): string {
  return cartMessageAr(displayLines(data), cartTotalMinor(data.cart), {
    removeHint,
  });
}

/** رسالة `cart_review` — بتحلّ محل عرض السلّة اللي كانت ب-5 تبعته (ج §6). */
export function renderSummary(
  data: SessionData,
  fulfillment: SummaryFulfillment,
): string {
  return buildOrderSummary(
    displayLines(data),
    cartTotalMinor(data.cart),
    fulfillment,
  );
}
