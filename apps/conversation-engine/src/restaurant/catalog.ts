import { and, eq, inArray } from "drizzle-orm";
import { menuCategories, menuItems, priceToMinor } from "@sufria/shared";

import type { TenantTx } from "../db/types.js";

/**
 * بيانات الأصناف لحظة الإضافة — الاسم والسعر والتوفّر.
 *
 * 🔴 **المبدأ (§14.5): السعر snapshot — وعد للزبون. والتوفّر حيّ — واقع المطبخ.**
 *    السعر والاسم بينقروا هون وبينحفظوا بسطر السلّة، وما عاد بيتغيّروا مهما
 *    غيّر المطعم. التوفّر بينقرأ هون **بكل إضافة**، داخل معاملة الرسالة: صنف
 *    انخفى بعد ما انبعث المنيو بيوصل المطبخ لو قرأناه من الخريطة.
 *
 * `menu_map` بتضل الحقيقة **للترقيم**. التوفّر مش ترقيم.
 *
 * "متوفر" = نفس فلتر القائمة المعروضة بالضبط: الصنف متاح **وتصنيفه فعّال**.
 * تصنيف انطفى بيخفي أصنافه من القائمة، فبيخفيها من الإضافة كمان.
 *
 * ما بيستورد من `menu.ts` بالقصد: حارس ب-2 بيسمح لـ`menu-delivery.ts` وحده.
 * هاد مش مسار إرسال قائمة — هاد قراءة أصناف بالمعرّف.
 */
export interface CatalogEntry {
  readonly name: string;
  readonly unitPriceMinor: number;
  readonly available: boolean;
}

export type Catalog = ReadonlyMap<string, CatalogEntry>;

/**
 * صف ممسوح كليا ما بيرجع هون أصلا — والمستدعي بيعامله «مش بالمنيو»: ما في
 * اسم نقول عنه «غير متوفر».
 */
export async function readCatalog(
  tx: TenantTx,
  itemIds: readonly string[],
): Promise<Catalog> {
  if (itemIds.length === 0) return new Map();

  const rows = await tx
    .select({
      id: menuItems.id,
      name: menuItems.name,
      price: menuItems.price,
      itemAvailable: menuItems.isAvailable,
      categoryActive: menuCategories.isActive,
    })
    .from(menuItems)
    .innerJoin(menuCategories, eq(menuCategories.id, menuItems.categoryId))
    .where(and(inArray(menuItems.id, [...itemIds])));

  return new Map(
    rows.map((r) => [
      r.id,
      {
        name: r.name,
        unitPriceMinor: priceToMinor(r.price),
        available: r.itemAvailable && r.categoryActive,
      },
    ]),
  );
}
