import { ORDERS_PAUSED_AR } from "@sufria/shared";

import { logger, maskPhone } from "../logger.js";
import type { WhatsAppSender } from "../whatsapp/sender.js";

/**
 * Why a customer got ORDERS_PAUSED_AR instead of what they asked for — brief
 * ي-أ §4: the restaurant paused orders (decision 1), or its menu has no item
 * to show (decision 3).
 */
export type OrdersPausedReason = "paused" | "empty_menu";

/**
 * Sends ORDERS_PAUSED_AR, and logs one `info` line: the restaurant, the
 * reason, the number masked (`logger.ts`: never the whole number, never the
 * text).
 *
 * 🔴 It writes nothing, and its callers return right after it: no session is
 *    opened, and an active one is not touched — not its state, not its cart,
 *    not `last_message_at` (decision 1). Sent inside the message's
 *    transaction, like the closing text: a failed send rolls it back and Meta
 *    delivers the message again.
 */
export async function replyOrdersPaused(
  sender: WhatsAppSender,
  recipient: {
    readonly restaurantId: string;
    readonly phoneNumberId: string;
    readonly to: string;
  },
  reason: OrdersPausedReason,
): Promise<void> {
  await sender.sendText({
    restaurantId: recipient.restaurantId,
    phoneNumberId: recipient.phoneNumberId,
    to: recipient.to,
    body: ORDERS_PAUSED_AR,
  });
  logger.info(
    {
      restaurantId: recipient.restaurantId,
      reason,
      from: maskPhone(recipient.to),
    },
    reason === "paused"
      ? "الطلبات موقفة — رد الإيقاف، وولا جلسة انفتحت أو انلمست"
      : "المنيو بلا أصناف — رد الإيقاف بدل منيو فاضي",
  );
}
