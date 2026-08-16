# ADR-002 — أربعة فروقات بين الـschema المنفَّذ وبلوبرينت §5.7

**الحالة:** مطبّقة بـ`db/migrations/0001` · **التاريخ:** 13 أغسطس 2026

البلوبرينت §5.7 هو المرجع. الفروقات الأربعة تحت مقصودة، وكل وحدة ظهرت لما صار الـschema يتنفّذ فعلا مقابل الاستعلامات يلي بمخططات §6. مذكورة هون عشان تُقر أو تُرفض، مش عشان تمر بصمت.

---

## 1. `restaurant_id` مضافة على `order_items` و `order_status_history`

**§5.7:** الجدولين بيرجعوا لـ`orders` بس عبر `order_id`.

**المشكلة:** سياسة RLS على جدول ما فيه `restaurant_id` لازم تصير subquery مرتبطة:

```sql
USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id
               AND o.restaurant_id = app.current_restaurant()))
```

بتتقيّم **لكل صف**، على الجدولين الأسرع نموا بالنظام. NFR-06 بتستهدف 10,000 طلب لكل مطعم. هاد بيتحوّل لأبطأ استعلام بالداشبورد بالضبط لما المطعم ينجح.

**الحل:** `restaurant_id` مضافة على الاتنين، فالسياسة بتصير مساواة مدعومة بفهرس. الاتساق **مفروض بنيويا** بـcomposite FK، مش بانضباط الكود:

```sql
ALTER TABLE orders ADD CONSTRAINT orders_tenant_key UNIQUE (id, restaurant_id);
FOREIGN KEY (order_id, restaurant_id) REFERENCES orders (id, restaurant_id)
```

صف يتيم بـ`restaurant_id` غلط **مستحيل يُكتب** — قاعدة البيانات بترفضه. (نفس النمط مطبّق على `menu_items → menu_categories`، لأنه صنف تحت تصنيف مطعم تاني كان ممكن.)

الاختبار A8 بـ`chain-isolation.sql` موجود تحديدا عشان يثبت إن هاي الـdenormalisation ما فتحت ثغرة.

---

## 2. `orders.ready_at`

**§5.7 / §6.4 ب-١:** مهلة الـ24 ساعة تُحسب "من دخول `ready` حسب `order_status_history`".

**المشكلة:** هاد بيخلي job بيدور كل 30 ثانية يعمل scan على جدول append-only بينمو للأبد، عشان يطلّع timestamp موجود أصلا وقت الانتقال.

**الحل:** عمود `ready_at` بيتعبّى بنفس الـtransaction تبع الانتقال لـ`ready`. الـjob بيصير فهرس جزئي بسيط. `order_status_history` بتبقى مصدر الحقيقة للتدقيق (NFR-09) — `ready_at` نسخة مشتقة للأداء، مش بديل.

مضمون بـCHECK: `ready_at IS NULL OR status IN ('ready','completed','cancelled','expired')`.

---

## 3. `orders.outbound_msg_count`

**غير موجود بـ§5.7 إطلاقا.** أُضيف بسبب تغيير تسعير ميتا 1 أكتوبر 2026 (شوف الملاحظة تحت).

من 1 أكتوبر، **كل رسالة صادرة من وفا بتصير مدفوعة** — بما فيها ردود الخدمة داخل نافذة الـ24 ساعة يلي حاليا مجانية. يعني في تكلفة متغيرة لكل طلب، بمنتج تموضعه الكامل "اشتراك ثابت بدون عمولة لكل طلب".

**عدد الرسائل لكل طلب صار متغير هندسي، مش بند محاسبة.** ما بنقدر نسعّر الاشتراك بدون الرقم الحقيقي، وما رح نعرفه إلا لو قسناه من أول يوم بالبايلوت. عمود واحد integer بيزيد مع كل إرسال ناجح.

الاستعلام يلي رح يحدد سعر الاشتراك:

```sql
SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY outbound_msg_count) AS median_msgs,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY outbound_msg_count) AS p90_msgs
FROM orders WHERE status = 'completed';
```

---

## 4. قيود CHECK بتفرض قواعد كانت مكتوبة نصا بس

كل وحدة بتقابل جملة موجودة بالـSRS v1.1، منقولة من "قاعدة النظام لازم يحترمها" لـ"قاعدة قاعدة البيانات بترفض خرقها":

| القيد | المصدر |
|---|---|
| `status='completed'` ⇒ `payment_status IN ('paid','collected')` | NFR-09 |
| `payment_status='collected'` ⇒ `payment_method='cash'` | NFR-09 |
| `cancelled_by` مضبوطة ⟺ `status='cancelled'` | FR-13 |
| `status='expired'` ⇒ `fulfillment_type='pickup'` | §5.6 (انتهاء صلاحية pickup فقط) |
| `actor='staff'` ⟺ `actor_staff_id IS NOT NULL` | NFR-09 مسار التدقيق |

**ملاحظة على الأخير:** §5.7 بتكتب `changed_by (staff_account_id/'customer'/'system')` — عمود واحد بيخزن يا uuid يا نص ثابت. انفصل لعمودين (`actor` enum + `actor_staff_id` FK) لأن العمود المدموج ما بيقبل FK، يعني مسار التدقيق بيصير قابل يشير لموظف غير موجود. مسار تدقيق ما بينفع يكون هو الجدول الوحيد بلا سلامة مرجعية.

---

## بند مفتوح خارج هاد الـADR

`processed_webhook_events` بتنمو بلا حدود. تنظيف الصفوف الأقدم من 30 يوم (أطول بكتير من أي نافذة إعادة إرسال) — Sprint 2، مش Sprint 0.
