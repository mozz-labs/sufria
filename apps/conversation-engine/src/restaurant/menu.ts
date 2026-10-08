import { and, asc, eq } from "drizzle-orm";
import {
  menuCategories,
  menuItems,
  priceToMinor,
  renderMenuText,
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

/**
 * The rows read here, the text built by `renderMenuText` from
 * `packages/shared` (brief ي-أ §3): the dashboard API's 4096 guard measures
 * the very text the engine sends, so the two cannot build it apart.
 */
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
