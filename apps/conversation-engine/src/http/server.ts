import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import { logger } from "../logger.js";
import { parseWebhookPayload } from "../whatsapp/payload.js";
import { safeTokenEquals, verifySignature } from "../whatsapp/signature.js";
import {
  needsRedelivery,
  type IngestOutcome,
  type WebhookService,
} from "../whatsapp/webhook.service.js";

/**
 * اللي /health بيحتاجه. نوع بنيوي مش TenantDb مباشرة عشان الاعتمادية تضل
 * "إشي بيقدر يلمس القاعدة" مش "المخزن كله".
 */
export interface HealthProbe {
  ping(): Promise<void>;
}

export interface ServerDeps {
  service: WebhookService;
  health: HealthProbe;
  verifyToken: string;
  appSecret: string;
}

/** حمولات ميتا بالكيلوبايتات. السقف عشان طلب مفتوح ما يبلع الذاكرة. */
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * سيرفر HTTP خام عن قصد — بلا إطار وبلا ديكوريتورات.
 *
 * ADR-004 بيقول محرّك المحادثة بيضل على tsx لأنه ما فيه ديكوريتورات، وهاد
 * القرار بينطبق هون: إدخال Nest بيجرّ معه @swc-node/register ومصيدة
 * design:paramtypes كاملة، مقابل توجيه مسارين.
 *
 * وفيه سبب تاني أهم: مصيدة الـraw body. أي إطار بيركّب body parser افتراضي
 * بيسلّمك كائن JSON، والتوقيع محسوب على البايتات — فبتضطر تعطّل الـparser
 * لهذا المسار تحديدا وتتذكر تعطّله كل مرة. هون ما في parser أصلا: الطلب
 * بيوصل Buffer، وJSON.parse ما بينستدعى إلا بعد ما التوقيع يمر.
 */
export function createWebhookServer(deps: ServerDeps): Server {
  return createServer((req, res) => {
    void handle(req, res, deps).catch((error: unknown) => {
      // ما بيوصلها إلا خلل بالسيرفر نفسه — handle() ماسكة أخطاء المعالجة.
      logger.error({ err: error }, "خطأ غير متوقع بمعالج HTTP");
      if (!res.headersSent) send(res, 500, { error: "internal" });
    });
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ServerDeps,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/health" && req.method === "GET")
    return handleHealth(deps, res);

  if (url.pathname !== "/webhook")
    return send(res, 404, { error: "not_found" });

  if (req.method === "GET") return handleVerification(url, res, deps);
  if (req.method === "POST") return handleInbound(req, res, deps);

  res.setHeader("allow", "GET, POST");
  return send(res, 405, { error: "method_not_allowed" });
}

/**
 * GET /health — هل هالعملية قادرة تخدم رسالة فعلا؟
 *
 * 🔴 بتلمس القاعدة، لأن "قادرة تخدم" بلا قاعدة ما إلها معنى هون: كل مسار
 *    بالمستقبِل بينتهي بكتابة. فحص ما بيلمس القاعدة بيرجّع 200 والقاعدة
 *    واقعة، فالمنسّق بيضل يوجّه الطلبات لعملية بتفشل بكل وحدة منهم.
 *
 *    وبما إن الفشل هون بيخلي المنسّق يشيل العملية من الدوران، الرد لازم
 *    يكون غير-200: 503 (خدمة غير متاحة) مش 500 — العطل مؤقت وبالاعتمادية،
 *    مش خلل بالطلب.
 */
async function handleHealth(
  deps: ServerDeps,
  res: ServerResponse,
): Promise<void> {
  try {
    await deps.health.ping();
  } catch (error) {
    logger.error({ err: error }, "🔴 فحص الصحة ما وصل القاعدة");
    return send(res, 503, { ok: false, error: "database_unavailable" });
  }
  return send(res, 200, { ok: true });
}

/**
 * GET /webhook — تحقّق الاشتراك. ميتا بتناديها مرة وحدة وقت ربط الـwebhook.
 *
 * الرد لازم يكون hub.challenge **نص خام**، مش JSON. ميتا بتقارن الجسم حرفيا،
 * فـ`"1158201444"` بعلامات تنصيص بتفشل الربط.
 */
function handleVerification(
  url: URL,
  res: ServerResponse,
  deps: ServerDeps,
): void {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (
    mode !== "subscribe" ||
    token === null ||
    challenge === null ||
    !safeTokenEquals(token, deps.verifyToken)
  ) {
    logger.warn(
      { mode, hasToken: token !== null },
      "تحقق اشتراك webhook مرفوض",
    );
    return send(res, 403, { error: "verification_failed" });
  }

  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end(challenge);
}

/**
 * POST /webhook — الرسائل الواردة.
 *
 * 🔴 قاعدة الردود، حرفيا:
 *
 *      200      = خزّنتها بأمان، أو تجاهلتها بقصد ونهائيا
 *                 (JSON مشوّه، نوع غير مدعوم، حدث مكرر).
 *      غير 200  = ما قدرت — أعِد الإرسال.
 *
 * ميتا بتعيد الإرسال بتردد متناقص لحد ٧ أيام على أي رد غير 200. يعني طابور
 * إعادة الإرسال موجود مجانا، وهو الفرق بين "رسالة اتأخرت دقيقتين" و"رسالة
 * زبون ضاعت نهائيا وبصمت". 200 على فشل تخزين بيرمي الطابور.
 *
 * والاستثناء المعاكس هو التوقيع: 401، لأن طلب ما وقّعه صاحب التطبيق مش من
 * ميتا أصلا وما في إشي يستاهل إعادة إرساله.
 */
async function handleInbound(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ServerDeps,
): Promise<void> {
  const rawBody = await readRawBody(req);
  if (rawBody === null) {
    logger.warn(
      { limit: MAX_BODY_BYTES },
      "حمولة webhook أكبر من السقف — انرفضت",
    );
    return send(res, 413, { error: "payload_too_large" });
  }

  // ١. التوقيع قبل أي شي — قبل JSON.parse، قبل أي استعلام.
  const signature = header(req, "x-hub-signature-256");
  if (!verifySignature(rawBody, signature, deps.appSecret)) {
    logger.warn(
      { hasSignature: signature !== undefined, bytes: rawBody.length },
      "🔴 توقيع webhook غير صالح — الطلب انرمى",
    );
    return send(res, 401, { error: "invalid_signature" });
  }

  // ٢. من هون وطالع: 200 مهما صار.
  let body: unknown;
  try {
    body = JSON.parse(rawBody.toString("utf8"));
  } catch {
    logger.warn({ bytes: rawBody.length }, "JSON مشوّه بحمولة webhook");
    return send(res, 200, { status: "ignored" });
  }

  const parsed = parseWebhookPayload(body);
  if (parsed === null) {
    logger.warn("حمولة webhook مش على شكل ميتا المعروف — انتجاهلت");
    return send(res, 200, { status: "ignored" });
  }

  if (parsed.skipped > 0)
    logger.warn({ skipped: parsed.skipped }, "رسائل ما انقرأ شكلها — انتجاهلت");
  if (parsed.statuses > 0)
    logger.debug(
      { statuses: parsed.statuses },
      "أحداث حالة تسليم — خارج النطاق",
    );
  if (parsed.ignoredChanges > 0)
    logger.debug(
      { ignoredChanges: parsed.ignoredChanges },
      "أحداث webhook مش من نوع messages — انتجاهلت وحدها",
    );

  // 🔴 القيمة المرجَّعة تُفحص، لا تُرمى. هي الرد نفسه: أي رسالة بالدفعة ما
  //    انخزنت لسبب قابل للإصلاح بتخلّي الرد 500، وميتا بتعيد الدفعة كاملة.
  //    إعادة الدفعة آمنة لأن اللي انخزن أصلا بتمسكه بوابة منع التكرار.
  let outcomes: IngestOutcome[];
  try {
    outcomes = await deps.service.ingest(parsed);
  } catch (error) {
    // ingest() ماسكة أخطاء كل رسالة لحالها؛ هاي شبكة أمان لخلل أعم.
    logger.error({ err: error }, "فشل غير متوقع بمعالجة حمولة webhook");
    return send(res, 500, { error: "ingest_failed" });
  }

  if (needsRedelivery(outcomes)) {
    logger.error(
      { outcomes },
      "🔴 رسالة واردة ما انخزنت — 500 عشان ميتا تعيد الإرسال",
    );
    return send(res, 500, { error: "ingest_failed" });
  }

  return send(res, 200, { status: "ok" });
}

/**
 * الجسم كبايتات خام. null لو تجاوز السقف.
 *
 * 🔴 لما يتجاوز، بنضل نقرأ الباقي وبنرميه بدل ما نهدّ الاتصال.
 *
 *    الطريق اللي بيبان أنضف — pause أو destroy وقت التجاوز — بيكسر الرد.
 *    الطلب بيكون لسا عم يرفع، فالمقبس عنده بيانات واردة ما انقرأت؛ إغلاقه
 *    بهالحالة بيبعت RST مش FIN، وRST بيلغي مخزن الإرسال — يعني بايتات الرد
 *    413 بتنرمى وهي طالعة والمرسِل بيشوف ECONNRESET. الفرق ما بيبان بجهاز
 *    واحد فاضي، وبيبان أول ما السويت تشتغل تحت حمل.
 *
 *    الكلفة إننا بنقرأ بايتات رح نرميها. الذاكرة مش مكشوفة — بنفضّي المخزن
 *    أول ما نتجاوز — بس عرض الحزمة مكشوف، فالسقف حماية ذاكرة مش حماية من
 *    إغراق. الإغراق شغل الطبقة اللي قدّام (reverse proxy).
 */
function readRawBody(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    let chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;

    req.on("data", (chunk: Buffer) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks = [];
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(tooLarge ? null : Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
