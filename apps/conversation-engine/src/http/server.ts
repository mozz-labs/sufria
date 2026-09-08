import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import { logger } from "../logger.js";
import { parseWebhookPayload } from "../whatsapp/payload.js";
import { safeTokenEquals, verifySignature } from "../whatsapp/signature.js";
import type { WebhookService } from "../whatsapp/webhook.service.js";

export interface ServerDeps {
  service: WebhookService;
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

  if (url.pathname === "/health" && req.method === "GET") {
    // ⛔ ممنوع تلمس القاعدة. فايدتها الوحيدة إنك تعرف: ردّت؟ التطبيق عايش
    //    والمشكلة بالقاعدة. ما ردّت؟ التطبيق ميت.
    return send(res, 200, { ok: true });
  }

  if (url.pathname !== "/webhook")
    return send(res, 404, { error: "not_found" });

  if (req.method === "GET") return handleVerification(url, res, deps);
  if (req.method === "POST") return handleInbound(req, res, deps);

  res.setHeader("allow", "GET, POST");
  return send(res, 405, { error: "method_not_allowed" });
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
 * 🔴 قاعدة الردود هون: توقيع فاشل = 401، وكل شي غيره = 200.
 *
 * ميتا بتفسّر أي رد غير 200 كفشل تسليم، بتعيد الإرسال، وبتخفّض تقييم جودة
 * الرقم لو تكرر (NFR-05). يعني حمولة مشوّهة، نوع رسالة ما بنعرفه، حدث مكرر،
 * وحتى خطأ داخلي — كلهم 200 وسطر log. الاستثناء الوحيد هو التوقيع، لأن طلب
 * ما وقّعه صاحب التطبيق مش من ميتا أصلا.
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
    send(res, 413, { error: "payload_too_large" });
    // الطلب ما انقرأ للآخر، فبنسكّر الاتصال بعد ما الرد يطلع.
    req.destroy();
    return;
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

  try {
    await deps.service.ingest(parsed);
  } catch (error) {
    // ingest() ماسكة أخطاء كل رسالة لحالها؛ هاي شبكة أمان لخلل أعم.
    logger.error({ err: error }, "فشل غير متوقع بمعالجة حمولة webhook");
  }

  return send(res, 200, { status: "ok" });
}

/** الجسم كبايتات خام. null لو تجاوز السقف. */
function readRawBody(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;

    req.on("data", (chunk: Buffer) => {
      if (aborted) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // 🔴 pause، مش destroy. تدمير الطلب بيهدّ المقبس، والرد 413 اللي
        //    بعده بينكتب على مقبس ميّت — يعني المرسِل بيشوف اتصال انقطع بدل
        //    رمز حالة. بنوقف التجميع بس، والرد بينكتب عادي.
        aborted = true;
        req.pause();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!aborted) resolve(Buffer.concat(chunks));
    });
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
