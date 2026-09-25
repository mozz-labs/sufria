import { env } from "../config/env.js";
import { logger, maskPhone } from "../logger.js";

/**
 * الإرسال الصادر خلف واجهة.
 *
 * السبب الوحيد لوجود الواجهة: **الاختبارات ما بتضرب ميتا إطلاقا**. مش تجريدا
 * لأجل التجريد — سويت بتنادي Graph API فعليا بتصير بطيئة وهشّة ومربوطة بتوكن
 * حقيقي، وأسوأ من هيك: بتبعت رسائل واتساب حقيقية لأرقام حقيقية كل مرة تشتغل.
 *
 * التنفيذان الاتنين هون جنب بعض بالقصد، عشان يضلوا متطابقين بالسلوك اللي بيهمّ:
 * سقف الطول بينفحص بالاتنين بنفس الدالة، فاختبار بيمر على المزيّف بيعني إشي
 * عن الحقيقي.
 */

/**
 * رسالة نصية صادرة.
 *
 * `restaurantId` مش لازم لميتا — ميتا بتعرف المرسِل من `phoneNumberId` وبس.
 * موجود لأن الاختبار «ولا رسالة صادرة تُرسَل لمطعم آخر» ما بينسأل بلاه: بلا
 * حقل المطعم، المسجِّل بيشوف أرقام ونصوص وما بيقدر ينسبها لمستأجر.
 */
export interface OutboundTextMessage {
  restaurantId: string;
  /** رقم المطعم عند ميتا — هو المرسِل. */
  phoneNumberId: string;
  /** رقم الزبون بصيغة واتساب الدولية بلا +. */
  to: string;
  body: string;
}

export interface WhatsAppSender {
  sendText(message: OutboundTextMessage): Promise<void>;
}

/**
 * سقف نص رسالة واتساب الواحدة.
 *
 * 🔴 قائمة مطعم بستين صنفا بتتجاوزه. والسلوك الممنوع هنا هو **الاقتطاع
 *    الصامت**: زبون بيشوف قائمة بتقطع بنص اسم صنف وبيطلب رقما مش موجود،
 *    والمطعم ما بيعرف إن نص قائمته ما وصل ولا مرة. الصح إن الحالة تنكشف
 *    وتنسجّل خطأ.
 *
 *    تقسيم القائمة لصفحات أو خطوة اختيار تصنيف = تأجيل مقصود لشريحة جاية.
 */
export const WHATSAPP_TEXT_LIMIT = 4096;

/**
 * نص أطول من سقف واتساب. **دائمة، مش عابرة** — إعادة المحاولة ما بتصلّحها،
 * بتصلّحها قائمة أقصر. المستدعي بيسجّل وبيكمّل، وما بيطلب إعادة إرسال.
 */
export class OutboundTextTooLongError extends Error {
  constructor(
    readonly length: number,
    readonly limit: number = WHATSAPP_TEXT_LIMIT,
  ) {
    super(`نص الرسالة الصادرة ${length} محرفا، والسقف ${limit}`);
    this.name = "OutboundTextTooLongError";
  }
}

/** بترمي بدل ما تقتطع. بتنستدعى من التنفيذين الاتنين. */
export function assertWithinTextLimit(body: string): void {
  // 🔴 [...body].length مش body.length: الأخيرة بتعدّ وحدات UTF-16، فالإيموجي
  //    بينعدّ اتنين. ميتا بتعدّ محارف. الفرق بيرفض قائمة صالحة.
  const length = [...body].length;
  if (length > WHATSAPP_TEXT_LIMIT) {
    throw new OutboundTextTooLongError(length);
  }
}

/**
 * ميتا ردّت بغير 2xx. `metaCode` هو `error.code` من جسم الرد لو انقرأ — هو
 * اللي بيفرّق «خارج نافذة 24 ساعة» (131047) عن توكن منتهي عن رقم غلط، والسجل
 * بيحتاجه بلا ما ينسخ جسم الرد كله.
 */
export class WhatsAppSendError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly metaCode: number | null,
  ) {
    super(message);
    this.name = "WhatsAppSendError";
  }
}

function metaErrorCode(detail: string): number | null {
  try {
    const code = (JSON.parse(detail) as { error?: { code?: unknown } }).error
      ?.code;
    return typeof code === "number" ? code : null;
  } catch {
    return null;
  }
}

/** تنفيذ حقيقي عبر Meta Cloud API. */
export class MetaWhatsAppSender implements WhatsAppSender {
  constructor(
    private readonly accessToken: string = env().WHATSAPP_ACCESS_TOKEN,
    private readonly baseUrl: string = env().WHATSAPP_GRAPH_API_BASE,
    private readonly apiVersion: string = env().WHATSAPP_GRAPH_API_VERSION,
    private readonly timeoutMs: number = env().WHATSAPP_SEND_TIMEOUT_MS,
  ) {}

  async sendText(message: OutboundTextMessage): Promise<void> {
    assertWithinTextLimit(message.body);

    const url = `${this.baseUrl}/${this.apiVersion}/${message.phoneNumberId}/messages`;
    // 🔴 المهلة إلزامية: النداء بيصير جوّا معاملة قاعدة مفتوحة، فطلب معلّق
    //    بيقفل اتصال المخزن معه لحد ما تنتهي مهلة الاستعلام — يعني عطل شبكة
    //    عند ميتا بيصير عطل قاعدة بيانات عندنا.
    const signal = AbortSignal.timeout(this.timeoutMs);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: message.to,
        type: "text",
        // preview_url: false — رابط بالقائمة ما بيفتح بطاقة معاينة بتزحم الرسالة.
        text: { preview_url: false, body: message.body },
      }),
      signal,
    });

    if (!res.ok) {
      // 🔴 نص الخطأ من ميتا بينسجّل، ونص الرسالة لأ: الأول تشخيص، والتاني
      //    محتوى محادثة زبون. شوف logger.ts.
      const detail = await res.text().catch(() => "");
      throw new WhatsAppSendError(
        `ميتا رفضت الإرسال: ${res.status} ${res.statusText} ${detail.slice(0, 500)}`,
        res.status,
        metaErrorCode(detail),
      );
    }

    logger.info(
      {
        restaurantId: message.restaurantId,
        to: maskPhone(message.to),
        chars: [...message.body].length,
      },
      "رسالة صادرة انبعثت",
    );
  }
}

/**
 * تنفيذ مزيّف بيسجّل بدل ما يبعت. للاختبارات.
 *
 * بيعيش بـsrc مش بـtest عن قصد: `pnpm typecheck` بيغطي `src` بس (tsconfig.json
 * `include: ["src/**\/*.ts"]`)، فمزيّف ساكن بـtest بيضل خارج فحص الأنواع الجذري
 * وبينكسر بصمت لما تتغيّر الواجهة. وهو كمان الوضع اللي بيخلّي تشغيلة تطوير
 * محلية ممكنة بلا توكن ميتا.
 *
 * 🔴 ما بينوصل ولا مرة من main.ts. المسار الوحيد للإنتاج هو MetaWhatsAppSender.
 */
export class RecordingWhatsAppSender implements WhatsAppSender {
  readonly sent: OutboundTextMessage[] = [];

  // async رغم إنه ما في await: الواجهة بترجّع Promise، و assertWithinTextLimit
  // بترمي — فلازم الرمية تطلع كـrejection زي الحقيقي بالضبط، مش استثناء متزامن.
  async sendText(message: OutboundTextMessage): Promise<void> {
    // نفس فحص الحقيقي بالضبط، وقبل التسجيل: رسالة أطول من السقف ما بتنعدّ
    // "انبعثت" بالاختبار، زي ما ميتا ما كانت لتقبلها.
    assertWithinTextLimit(message.body);
    this.sent.push(message);
  }

  /** كل اللي انبعث لمطعم معيّن. أساس فحص «ولا رسالة راحت لمطعم تاني». */
  forRestaurant(restaurantId: string): OutboundTextMessage[] {
    return this.sent.filter((m) => m.restaurantId === restaurantId);
  }

  reset(): void {
    this.sent.length = 0;
  }
}
