import { and, asc, eq } from "drizzle-orm";
import {
  menuCategories,
  menuItems,
  menuLineAr,
  priceToMinor,
  MENU_COMMANDS_TAIL_AR,
  MENU_HEADER_AR,
  type Currency,
} from "@sufria/shared";

import type { TenantTx } from "../db/types.js";

/**
 * قراءة القائمة وتحويلها لنص مرقّم.
 *
 * القراءة كلها تحت RLS: المستدعي بيضبط سياق المستأجر قبل ما ينادي، وما في ولا
 * شرط `restaurant_id` مكتوب بالاستعلامات تحت — السياسة بـ0003 هي اللي بتحصر
 * الصفوف. لو انكتب الشرط باليد كمان، أول واحد بينسى يكتبه بيسرّب قائمة مطعم
 * تاني، والاختبار بيمر لأن الشرط المكتوب كان بيغطي على غياب السياسة.
 */

export interface MenuLine {
  /** رقم متسلسل عبر القائمة كلها، مش جوّا كل تصنيف. */
  number: number;
  itemId: string;
  name: string;
  /** بالقروش — نفس مسار التحويل الوحيد اللي بتقرأ فيه السلّة السعر. */
  priceMinor: number;
}

/** سطر قائمة ومعه تصنيفه — الشكل الداخلي اللي العرض بيشتغل عليه. */
export interface MenuRow extends MenuLine {
  categoryId: string;
  categoryName: string;
}

export interface RenderedMenu {
  text: string;
  lines: MenuLine[];
}

/**
 * الأصناف المتاحة مجمّعة بتصنيفاتها الفعّالة.
 *
 * التصنيف الفاضي (كل أصنافه غير متاحة) ما بيطلع عنوانه: عنوان بلا أصناف تحته
 * بيخلّي الزبون يدوّر على إشي مش موجود.
 */
async function readMenu(tx: TenantTx): Promise<MenuRow[]> {
  const rows = await tx
    .select({
      categoryId: menuCategories.id,
      categoryName: menuCategories.name,
      categoryOrder: menuCategories.displayOrder,
      itemId: menuItems.id,
      itemName: menuItems.name,
      itemOrder: menuItems.displayOrder,
      price: menuItems.price,
    })
    .from(menuCategories)
    .innerJoin(menuItems, eq(menuItems.categoryId, menuCategories.id))
    .where(
      and(eq(menuCategories.isActive, true), eq(menuItems.isAvailable, true)),
    )
    // 🔴 الترتيب لازم يكون كليّا (total order)، مش جزئيا. `display_order`
    //    وحده ما بيكفي: تصنيفين بنفس الرقم — والصفر هو الافتراضي، يعني هاي
    //    الحالة الشائعة مش النادرة — بيتركوا الترتيب لـPostgres، فبيتغيّر مع
    //    خطة الاستعلام. الاسم فاصل مفهوم للمطعم، والمعرّف فاصل أخير بيضمن
    //    ثباتا مطلقا لما يتكرّر الاسم كمان.
    //
    //    وهاد مش تجميل: أرقام القائمة بتنبعت للزبون، وترتيب بيتقلّب بين
    //    رسالتين بيخلّي "2" تعني صنفا مختلفا عن اللي شافه.
    .orderBy(
      asc(menuCategories.displayOrder),
      asc(menuCategories.name),
      asc(menuCategories.id),
      asc(menuItems.displayOrder),
      asc(menuItems.name),
      asc(menuItems.id),
    );

  return rows.map((r, i) => ({
    number: i + 1,
    itemId: r.itemId,
    name: r.itemName,
    // 🔴 `priceToMinor` مش `Number(price).toFixed(2)` (بريف د §8.4): الأخيرة
    //    تحويل مال بالـJS. القروش بتمرق بـ`formatMinor` جوّا `menuLineAr`،
    //    نفس المنسّق اللي بيكتب سعر السلّة — فالمنيو والسلّة ما بيفترقوا بقرش.
    priceMinor: priceToMinor(r.price),
    categoryId: r.categoryId,
    categoryName: r.categoryName,
    categoryOrder: r.categoryOrder,
  }));
}

/** بتبني النص النهائي. مفصولة عن القراءة عشان تنفحص بلا قاعدة. */
export function renderMenuText(
  rows: readonly MenuRow[],
  currency: Currency,
): string {
  const parts: string[] = [MENU_HEADER_AR];
  let currentCategory: string | null = null;

  for (const row of rows) {
    if (row.categoryId !== currentCategory) {
      currentCategory = row.categoryId;
      parts.push("", row.categoryName);
    }
    // 🔴 القالب بـ`domain.ts` جوّا القاموس المحروس، مش سطر inline هون —
    //    كان هون بلا عملة، والسلّة بعملة (بريف د §2.3).
    parts.push(menuLineAr(row, currency));
  }

  // 🔴 الذيل بينضاف هون، بمكان واحد، فبيطلع **مرة وحدة** بكل رسالة قائمة.
  //    إضافته بمكان النداء بتخلّيه يتكرّر أو ينُسى حسب مين بيبعت.
  parts.push("", MENU_COMMANDS_TAIL_AR);

  return parts.join("\n");
}

export async function buildMenu(
  tx: TenantTx,
  currency: Currency,
): Promise<RenderedMenu> {
  const rows = await readMenu(tx);
  return {
    text: renderMenuText(rows, currency),
    lines: rows.map(({ number, itemId, name, priceMinor }) => ({
      number,
      itemId,
      name,
      priceMinor,
    })),
  };
}
