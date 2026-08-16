# ADR-001 — الـORM: Drizzle

**الحالة:** مقفول · **التاريخ:** 13 أغسطس 2026 · **البند:** بلوبرينت §5.5 / §5.9 — "قرار Prisma/Drizzle لازم يُقفل بأول يومين من Sprint 0"

---

## القرار

**Drizzle ORM.** الـmigrations تُكتب SQL خام بالإيد وتُراجع كـcode review، والـORM بيقرأ الـschema الناتج فقط — ما بيولّده.

---

## ليش — الحجة الوحيدة يلي بتهم

المشروع فيه أربع عمليات قاعدة بيانات كل صحة النظام معلقة فيها، وكلها مذكورة حرفيا بمخططات §6 وبالـNFRs:

| # | العملية | من وين | لو انكسرت |
|---|---|---|---|
| 1 | `INSERT ... ON CONFLICT DO NOTHING RETURNING id` | بوابة الـdedup، §5.6 طبقة 1، مخطط 6.3 | webhook مكرر من ميتا → طلب مكرر |
| 2 | `UPDATE ... WHERE id=? AND state=?` (CAS) | §5.6 طبقة 2، NFR-04 | ضغطتين على "تأكيد" → طلبين |
| 3 | `SELECT ... FOR UPDATE` | سباق الإلغاء مقابل webhook الدفع، مخطط 6.2/6.4-د، FR-13 | استرجاع مزدوج — المطعم بيدفع للزبون مرتين |
| 4 | `FOR UPDATE SKIP LOCKED` | jobs المهلتين، مخطط 6.4 ب-١/ب-٢ | نسختين من الـscheduler بتعالجوا نفس الطلب |

**بـPrisma، ثلاثة من الأربعة ما إلها دعم أصيل** — لازم `$queryRaw` / `$executeRawUnsafe`:

- `SELECT ... FOR UPDATE`: طلب ميزة **مفتوح من 4 أغسطس 2021 لليوم** ([prisma/prisma#8580](https://github.com/prisma/prisma/issues/8580)). نص الـissue حرفيا: *"There is no concept of `SELECT FOR UPDATE`."*
- `FOR UPDATE SKIP LOCKED`: نفس الشي.
- `ON CONFLICT DO NOTHING ... RETURNING`: `createMany({skipDuplicates})` بترجّع عدد، مش أي صف انكتب فعلا — وهاد بالضبط الشي يلي بوابة الـdedup بتحتاجه (`rowcount = 0` يعني تجاهل).
- الوحيدة المدعومة: الـCAS، عبر `updateMany` يلي بترجّع `{count}`.

يعني لو اخترنا Prisma، **أخطر أربع نقاط بالنظام بتنكتب SQL خام جوا ORM** — بنخسر type safety بالضبط بالمكان يلي فيه الخطأ بيكلّف فلوس، وبندفع تعقيد الـORM بلا ما ناخد فايدته. أسوأ الاحتمالين.

بـDrizzle الأربعة first-class ومكتوبة بالـtypes: `.onConflictDoNothing().returning()` · `.for('update')` · `.for('update', { skipLocked: true })`.

### الحجة الثانية: RLS

NFR-02 بتفرض RLS أصيلة. Drizzle بتعرّف السياسات بالـschema (`pgPolicy`) وبتعطي وصول مباشر للـconnection جوا الـtransaction، فـ`set_config('app.current_restaurant_id', $1, true)` بتنكتب طبيعي كـbind parameter. Prisma بتخبّي إدارة الـconnection، وربط الـcontext بنفس الـconnection تبع الاستعلام بصير شغل ملتوي فوق `$transaction`.

### الحجة المضادة، بصراحة

Prisma أحسن بـDX، وبأدوات الـmigration، وبالتوثيق — والفريق جديد على NestJS (SRS §1.9.1). هاي حجة حقيقية وما بنكابر عليها.

**بس أكبر ميزة لـPrisma — `prisma migrate` — ما إلها قيمة هون أصلا:** سياسات RLS، و`FORCE ROW LEVEL SECURITY`، و`SECURITY DEFINER`، والـpartial indexes، ما بتنعبّر عنها بلغة أي ORM من الاتنين. الـmigrations رح تنكتب SQL خام بأي حال (شوف `db/migrations/`). فالمقارنة الفعلية صارت: DX أحلى مقابل ثلاث ثغرات صحة بأخطر أربع نقاط. القرار واضح.

---

## التحقق — مش من التوثيق، من التشغيل

كل ادعاء فوق مُتحقق منه فعليا على PostgreSQL 16.13 عبر `drizzle-orm@0.45.2`:
`tests/db/critical-primitives.verify.ts` — 12 assertion، كلها خضراء، بتشمل تشغيل عاملين متوازيين لإثبات إن `SKIP LOCKED` بيوزّع صفوف منفصلة فعلا مش بس بيطلع بالـSQL.

```
✓ dedup gate: first delivery claims the event
✓ dedup gate: redelivery is rejected — rows=0
✓ CAS: double-tap produces no second order — rows=0
✓ row lock: FOR UPDATE emitted / executes
✓ scheduler claim: two workers get disjoint rows (no double-processing)
✓ RLS: bind-parameter set_config inside a drizzle tx scopes the query
✓ RLS: context does not survive the transaction (no pool leak)
```

---

## الأثر

- الـmigrations SQL خام بالإيد، مرقّمة، append-only. لا `drizzle-kit generate` على الإنتاج.
- Drizzle تُستخدم للاستعلامات والـtypes فقط.
- الأربع عمليات الحرجة مجمّعة بملف واحد (`critical-primitives.ts`) — تُستورد، ما تتكرر inline.
- تحديث SRS §1.7.2: البند حاليا مكتوب "Prisma or Drizzle... final choice left to the two backend developers' preference". لازم يتثبّت على Drizzle مع سبب مختصر. **(نفس البند فيه `360dialog` لسا مكتوبة كـBSP رغم إنها اتشالت من البلوبرينت — تصحيح لازم يمشي بنفس المراجعة.)**
