/**
 * و-1 — اختيار رسالة الزبون لحالة الطلب (FR-11، بريف و §1.1 و§3).
 *
 * صف لكل سطر في جدول §1.1، حرفيا. الصمت `null` مقصود ومختبَر مثل النص:
 * المُراقِب يعلّم الطلب عليه بلا إرسال.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  ALL_CUSTOMER_TEXTS_AR,
  ORDER_STATUSES,
  ORDER_STATUS_MESSAGE_AR,
  ORDER_STATUS_TEXTS_AR,
  statusNotificationAr,
  type StatusNotificationInput,
} from "@sufria/shared";

const order = (
  over: Partial<StatusNotificationInput> &
    Pick<StatusNotificationInput, "status">,
): StatusNotificationInput => ({
  fulfillmentType: "pickup",
  cancellationReason: null,
  ...over,
});

// أي خانة قالب — `[السبب]`، `[رقم الطلب]`، … — بقيت بلا تعبئة.
const UNFILLED_SLOT = /\[[^\]]+\]/u;

test("pending_acceptance ← صمت: «استلمنا» يرسلها المحرّك عند الإنشاء", () => {
  assert.equal(
    statusNotificationAr(order({ status: "pending_acceptance" })),
    null,
  );
});

test("accepted ← «أكّدنا طلبك.»", () => {
  assert.equal(
    statusNotificationAr(order({ status: "accepted" })),
    "أكّدنا طلبك.",
  );
});

test("🔴 preparing ← صمت، بالاستلام والتوصيل", () => {
  for (const fulfillmentType of ["pickup", "delivery"] as const)
    assert.equal(
      statusNotificationAr(order({ status: "preparing", fulfillmentType })),
      null,
    );
});

test("ready · استلام ← «طلبك جاهز للاستلام.»", () => {
  assert.equal(
    statusNotificationAr(order({ status: "ready", fulfillmentType: "pickup" })),
    "طلبك جاهز للاستلام.",
  );
});

test("ready · توصيل ← «طلبك خرج للتوصيل.»", () => {
  assert.equal(
    statusNotificationAr(
      order({ status: "ready", fulfillmentType: "delivery" }),
    ),
    "طلبك خرج للتوصيل.",
  );
});

test("cancelled · بسبب ← السبب حرفيا في الخانة", () => {
  assert.equal(
    statusNotificationAr(
      order({ status: "cancelled", cancellationReason: "نفد الخبز" }),
    ),
    "ألغينا طلبك — نفد الخبز.",
  );
});

test("cancelled · السبب يُقصّ من طرفيه", () => {
  assert.equal(
    statusNotificationAr(
      order({ status: "cancelled", cancellationReason: "  نفد الخبز \n" }),
    ),
    "ألغينا طلبك — نفد الخبز.",
  );
});

test("cancelled · بلا سبب (NULL) ← «ألغينا طلبك.»", () => {
  assert.equal(
    statusNotificationAr(
      order({ status: "cancelled", cancellationReason: null }),
    ),
    "ألغينا طلبك.",
  );
});

test("🔴 cancelled · سبب فارغ أو مسافات ← يعامَل كغياب السبب", () => {
  for (const cancellationReason of ["", "   ", "\n\t "])
    assert.equal(
      statusNotificationAr(order({ status: "cancelled", cancellationReason })),
      "ألغينا طلبك.",
      JSON.stringify(cancellationReason),
    );
});

test("🔴 cancelled · سبب فيه $& أو خانة بينطبع حرفيا — لا حقن", () => {
  assert.equal(
    statusNotificationAr(
      order({ status: "cancelled", cancellationReason: "$& [السبب]" }),
    ),
    "ألغينا طلبك — $& [السبب].",
  );
});

test("🔴 completed ← صمت: الزبون ماسك أكله بإيده", () => {
  assert.equal(statusNotificationAr(order({ status: "completed" })), null);
});

test("expired ← صمت: مؤجّلة لـSprint 2", () => {
  assert.equal(statusNotificationAr(order({ status: "expired" })), null);
});

test("🔴 ولا نص صادر فيه خانة غير مملوءة — بكل حالة وكل طريقة استلام", () => {
  let checked = 0;
  for (const status of ORDER_STATUSES)
    for (const fulfillmentType of ["pickup", "delivery"] as const)
      for (const cancellationReason of [null, "", "نفد الخبز"]) {
        const text = statusNotificationAr({
          status,
          fulfillmentType,
          cancellationReason,
        });
        if (text === null) continue;
        checked += 1;
        assert.doesNotMatch(text, UNFILLED_SLOT, `${status}: ${text}`);
      }
  assert.ok(checked > 0, "الحارس لازم يلاقي نصوصا يفحصها");
});

test("🔴 النص الجديد «ألغينا طلبك.» داخل القاموس المحروس", () => {
  // فحوص الصياغة (الأرقام العربية-الهندية، اسم الصنف فاعلا) بتمشي على
  // ALL_CUSTOMER_TEXTS_AR — نص برّاها ما بيفحصه شي.
  const text = ORDER_STATUS_MESSAGE_AR.cancelled.restaurant_no_reason;
  assert.equal(text, "ألغينا طلبك.");
  assert.ok(ORDER_STATUS_TEXTS_AR.includes(text));
  assert.ok(ALL_CUSTOMER_TEXTS_AR.includes(text));
});

test("كل نص تخرجه الدالة مصدره القاموس المحروس", () => {
  // النص الوحيد المعبّأ هو الإلغاء بسبب — وقالبه من القاموس.
  for (const status of ORDER_STATUSES)
    for (const fulfillmentType of ["pickup", "delivery"] as const) {
      const text = statusNotificationAr({
        status,
        fulfillmentType,
        cancellationReason: null,
      });
      if (text !== null)
        assert.ok(
          ORDER_STATUS_TEXTS_AR.includes(text),
          `«${text}» برّا القاموس`,
        );
    }
});
