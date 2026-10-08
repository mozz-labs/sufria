/**
 * ja-2 · the one new customer text, and WhatsApp's count — brief ي-أ §3,
 * items 1 and 2. Pure: no database.
 *
 * The menu's text itself — every character of the first message and of
 * «منيو» — is pinned by the engine's `menu-snapshot.test.ts`, which asks
 * `handleInbound` for it on a real database, and only there: a second copy of
 * the expected text here would be a second place to update, not a second
 * guard.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  ORDERS_PAUSED_AR,
  WHATSAPP_TEXT_LIMIT,
  whatsappTextLength,
} from "@sufria/shared";

test("ORDERS_PAUSED_AR is Mohammed's text, verbatim (decision 2)", () => {
  assert.equal(ORDERS_PAUSED_AR, "أوقفنا استقبال الطلبات مؤقتا. راسلنا لاحقا.");
});

test("WhatsApp's limit is 4096, counted in characters — an emoji is one", () => {
  assert.equal(WHATSAPP_TEXT_LIMIT, 4096);
  assert.equal(whatsappTextLength("🌯"), 1);
  assert.equal(whatsappTextLength("شاورما 🌯"), 8);
  assert.equal("🌯".length, 2);
});
