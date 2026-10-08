import { sql } from "drizzle-orm";
import { outboundMessages } from "@sufria/shared";

import type { TenantDb } from "../db/tenant-db.js";
import { logger, maskPhone } from "../logger.js";
import type { OutboundTextMessage, WhatsAppSender } from "./sender.js";

/**
 * The longest the save may wait on a lock or run, in milliseconds. The reply
 * has already gone when the save starts, but the caller — often the inbound
 * message's transaction — waits for it: this is as long as it ever waits.
 */
export const SAVE_TIMEOUT_MS = 2000;

/** What the wrapper uses from pino. Injected so a test can read the line. */
export interface SaveLog {
  error(obj: object, msg: string): void;
}

/**
 * Brief I §4 (I-4): every text that actually went out is kept in
 * `outbound_messages`, so an order's details show the whole conversation.
 * One wrapper around the sender, built in `main.ts`, so none of the call
 * sites changes.
 *
 * 🔴 **After a successful send, never before.** A send that failed, or a
 *    text over WhatsApp's limit, leaves no row: this records what went out.
 *
 * 🔴 **The save never stops the reply.** It fails into an `error` line — the
 *    number masked — and the caller carries on as if nothing happened.
 *
 * 🔴 **Its own connection, and short timeouts.** Most replies are sent inside
 *    the inbound message's transaction, which holds a connection of the
 *    engine's pool — the only one, in the tests. The save is a transaction of
 *    its own, on a `TenantDb` of its own, under the message's restaurant,
 *    with `lock_timeout` and `statement_timeout` at SAVE_TIMEOUT_MS: a row
 *    that open transaction holds can make the save fail, never make the
 *    reply hang.
 */
export class SavingWhatsAppSender implements WhatsAppSender {
  constructor(
    private readonly inner: WhatsAppSender,
    private readonly db: TenantDb,
    private readonly log: SaveLog = logger,
  ) {}

  async sendText(message: OutboundTextMessage): Promise<void> {
    await this.inner.sendText(message);
    try {
      await this.db.runInTenant(message.restaurantId, async (tx) => {
        const limit = `${SAVE_TIMEOUT_MS}ms`;
        await tx.execute(
          sql`SELECT set_config('lock_timeout', ${limit}, true),
                     set_config('statement_timeout', ${limit}, true)`,
        );
        await tx.insert(outboundMessages).values({
          restaurantId: message.restaurantId,
          toPhone: message.to,
          body: message.body,
          orderId: message.orderId ?? null,
        });
      });
    } catch (error) {
      this.log.error(
        {
          restaurantId: message.restaurantId,
          to: maskPhone(message.to),
          orderId: message.orderId ?? null,
          err: withoutRow(error),
        },
        "🔴 رسالة انبعثت وما انحفظت بـoutbound_messages — الرد ما تأثّر",
      );
    }
  }
}

/**
 * The driver's error — name, code, message — and nothing that carries the
 * row: drizzle's `DrizzleQueryError` puts the query and its parameters (the
 * customer's number, the text) in its own message, and Postgres puts the
 * failing row in `detail` (logger.ts: neither is ever logged).
 */
function withoutRow(error: unknown): object {
  const cause =
    error instanceof Error && error.cause instanceof Error ? error.cause : null;
  const e = cause ?? (error instanceof Error ? error : null);
  if (e === null) return { message: "non-Error thrown" };
  return {
    name: e.name,
    code: (e as { code?: unknown }).code ?? null,
    message:
      cause === null && e.message.startsWith("Failed query")
        ? "query failed"
        : e.message,
  };
}
