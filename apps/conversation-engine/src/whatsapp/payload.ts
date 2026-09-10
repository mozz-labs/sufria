import { z } from "zod";

/**
 * شكل حمولة webhook الواردة من Meta Cloud API.
 *
 * 🔴 المبدأ الحاكم هنا: **متساهل عن قصد**.
 *
 * ميتا بتضيف أنواع رسائل وحقول جديدة على جدولها هي، وبتبعت أحداث ما طلبناها
 * (حالات تسليم، تحديثات قوالب). لو المخطط رفض أي شي ما بيعرفه ورجّع 400، أول
 * زبون بيبعت ملصق بيصير "خطأ بالنظام"، وميتا بتعيد الإرسال، وتقييم جودة الرقم
 * بينزل (NFR-05). زبون بعت صورة ≠ عطل.
 *
 * فالمخطط بيتحقق من الحد الأدنى اللي التوجيه بيحتاجه — phone_number_id ومعرّف
 * الرسالة والمُرسِل والنوع — وبيمرّر الباقي كما هو. الحمولة الخام بتنخزّن
 * بعمود jsonb عشان آلة الحالات (شريحة لاحقة) تقدر تعيد قراءتها.
 */

/** الحد الأدنى للرسالة الواردة. أي حقل زيادة بينحفظ بالحمولة الخام، مش هون. */
const MessageSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  // ميتا بتبعتها كنص لثواني epoch. اختيارية: ما بنرفض رسالة بسببها.
  timestamp: z.string().optional(),
  type: z.string().min(1),
  text: z.object({ body: z.string() }).optional(),
});

const ChangeValueSchema = z.object({
  metadata: z.object({ phone_number_id: z.string().min(1) }),
  // z.unknown() مش MessageSchema: كل رسالة بتنفحص لحالها بعدين، عشان رسالة
  // وحدة مشوّهة ما تسقّط الدفعة كلها — ميتا بتجمّع رسائل بطلب واحد.
  messages: z.array(z.unknown()).optional(),
  // أحداث حالة التسليم (sent/delivered/read). بتنتجاهل بهالشريحة، بس وجودها
  // بالمخطط بيخليها "متجاهَلة" مش "مشوّهة".
  statuses: z.array(z.unknown()).optional(),
});

/**
 * change واحد من نوع messages.
 *
 * 🔴 مفصول عن المظروف بالقصد، وبينفحص لحاله لكل عنصر.
 *
 *    ميتا بتوفّر حوالي ١٩ نوع webhook غير messages على نفس الاشتراك —
 *    تحديثات حالة القوالب، جودة الرقم، تنبيهات الحساب — والتوثيق ما بيضمن
 *    إن `metadata.phone_number_id` موجود فيهم كلهم. لو كان الفحص على مستوى
 *    المظروف زي قبل، change واحد بلا metadata بيفشّل الفحص كله، فترجع
 *    parseWebhookPayload بـnull، وكل رسالة زبون بنفس الدفعة بتنتجاهل.
 *
 *    ميتا بتجمّع الأحداث بطلب واحد، يعني هاي مش حالة نظرية: تحديث قالب
 *    بيوصل بنفس الطلب مع رسالة زبون، وبيبلعها.
 */
const ChangeSchema = z.object({
  field: z.string().optional(),
  value: ChangeValueSchema,
});

const EnvelopeSchema = z.object({
  object: z.string().optional(),
  entry: z.array(
    z.object({
      // z.unknown() مش ChangeSchema — لنفس السبب اللي خلّى messages
      // z.unknown() تحت: عنصر ما بنعرفه بينتجاهل لحاله، ما بيسقّط إخوانه.
      changes: z.array(z.unknown()),
    }),
  ),
});

/** رسالة واردة بعد الفحص، ومعها البايتات اللي جت فيها. */
export interface InboundMessage {
  waMessageId: string;
  from: string;
  phoneNumberId: string;
  type: string;
  /** نص الرسالة لما يكون فيه. null لصورة/صوت/موقع/ملصق. */
  body: string | null;
  sentAt: Date | null;
  /** كائن الرسالة كما وصل، بلا تعديل — هو اللي بينخزّن بعمود payload. */
  raw: unknown;
}

export interface ParsedWebhook {
  messages: InboundMessage[];
  /** عناصر انفحصت وما نجحت. عدد بس — بينسجّل، وما بيمنع الباقي. */
  skipped: number;
  /** أحداث حالة تسليم. خارج نطاق هالشريحة، بتنعدّ عشان السجل. */
  statuses: number;
  /** changes مش من نوع messages (بلا metadata.phone_number_id). بتنعدّ وبس. */
  ignoredChanges: number;
}

/**
 * بترجّع null لما تكون الحمولة أصلا مش من شكل webhook واتساب.
 * المستدعي بيسجّل وبيرجّع 200 — مش 400.
 */
export function parseWebhookPayload(input: unknown): ParsedWebhook | null {
  const envelope = EnvelopeSchema.safeParse(input);
  if (!envelope.success) return null;

  const messages: InboundMessage[] = [];
  let skipped = 0;
  let statuses = 0;
  let ignoredChanges = 0;

  for (const entry of envelope.data.entry) {
    for (const rawChange of entry.changes) {
      const change = ChangeSchema.safeParse(rawChange);
      if (!change.success) {
        // 🔴 هالعنصر وبس. الدفعة بتكمّل — رسالة الزبون اللي جنبه لازم تنخزن.
        ignoredChanges++;
        continue;
      }

      const value = change.data.value;
      statuses += value.statuses?.length ?? 0;

      for (const raw of value.messages ?? []) {
        const parsed = MessageSchema.safeParse(raw);
        if (!parsed.success) {
          skipped++;
          continue;
        }
        messages.push({
          waMessageId: parsed.data.id,
          from: parsed.data.from,
          phoneNumberId: value.metadata.phone_number_id,
          type: parsed.data.type,
          body: parsed.data.text?.body ?? null,
          sentAt: toDate(parsed.data.timestamp),
          raw,
        });
      }
    }
  }

  return { messages, skipped, statuses, ignoredChanges };
}

/** ثواني epoch كنص -> Date. أي شي مش رقم بيصير null، مش استثناء. */
function toDate(timestamp: string | undefined): Date | null {
  if (timestamp === undefined) return null;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000);
}
