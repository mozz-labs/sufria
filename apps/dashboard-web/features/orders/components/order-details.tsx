"use client";

import { useCallback, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  DASHBOARD_UI_AR,
  type Currency,
  type OrderDetail,
} from "@sufria/shared";
import { BackArrow } from "../../../shared/ui/back-arrow.tsx";
import { Skeleton } from "../../../shared/ui/skeleton.tsx";
import { StatusBadge } from "../../../shared/ui/status-badge.tsx";
import { ordersApi } from "../api/orders-api.ts";
import { useLiveOrders } from "../hooks/live-orders.tsx";
import { useOrder } from "../hooks/use-order.ts";
import { useOrderMessages } from "../hooks/use-order-messages.ts";
import { backTo, cancelOrder, type AdvanceOutcome } from "../lib/board.ts";
import { detailView } from "../lib/details.ts";
import { CancelDialog } from "./cancel-dialog.tsx";
import { Conversation } from "./conversation.tsx";
import { NextStepButton } from "./next-step-button.tsx";
import styles from "./order-details.module.css";

const T = DASHBOARD_UI_AR;

type Props = {
  id: string;
  /** `?from=` of the page: `history` brings the back link to «السجل». */
  from: string | string[] | undefined;
};

/**
 * One order (brief I §4, I-6), in the order it is read — and, on a phone,
 * the order of the column: the back link, the order's header (its number is
 * the page's <h1>), then the order and its conversation — side by side from
 * 1024px up, one after the other below.
 */
export function OrderDetails({ id, from }: Props) {
  const { currency, reportOffline, apply } = useLiveOrders();
  const order = useOrder(id, reportOffline);
  const messages = useOrderMessages(id, reportOffline);
  const back = backTo(from);

  return (
    <main className={styles.page}>
      <Link href={back.href} className={styles.back}>
        <BackArrow />
        {back.label}
      </Link>

      {(order.state.kind === "loading" ||
        (order.state.kind === "ready" && currency === null)) && (
        <Skeleton lines={5} />
      )}

      {order.state.kind === "notFound" && (
        <p className={styles.notice}>{T.details.notFound}</p>
      )}

      {order.state.kind === "failed" && (
        <div className={styles.failed}>
          <p className={styles.notice}>{T.errors.loadFailed}</p>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => void order.reload()}
          >
            {T.errors.retry}
          </button>
        </div>
      )}

      {order.state.kind === "ready" && currency !== null && (
        <Ready
          order={order.state.order}
          readAt={order.state.readAt}
          currency={currency}
          reload={order.reload}
          apply={apply}
          conversation={
            <Conversation state={messages.state} retry={messages.reload} />
          }
        />
      )}
    </main>
  );
}

function Ready({
  order,
  readAt,
  currency,
  reload,
  apply,
  conversation,
}: {
  order: OrderDetail;
  readAt: number;
  currency: Currency;
  reload: () => Promise<void>;
  apply: ReturnType<typeof useLiveOrders>["apply"];
  conversation: ReactNode;
}) {
  const view = detailView(order, currency, readAt);
  const [line, setLine] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState(false);

  // `unauthorized`: the session is gone, and the gate takes the page to login.
  const onOutcome = useCallback(
    (outcome: AdvanceOutcome) => {
      setLine(
        outcome.kind === "refresh" || outcome.kind === "failed"
          ? outcome.line
          : null,
      );
      if (outcome.kind === "changed") apply(outcome.order);
      if (outcome.kind === "changed" || outcome.kind === "refresh")
        void reload();
    },
    [apply, reload],
  );

  async function confirmCancel(reason: string) {
    setBusy(true);
    // `order` is the page as displayed: its status is the request's `from`.
    const outcome = await cancelOrder(ordersApi, order, reason);
    setBusy(false);
    setCancelling(false);
    onOutcome(outcome);
  }

  return (
    <>
      <header className={styles.head}>
        <h1 className={`num ${styles.number}`}>
          <bdi dir="ltr">{view.number}</bdi>
        </h1>
        <div className={styles.meta}>
          <StatusBadge status={view.status} className={styles.metaBadge}>
            {view.badge}
          </StatusBadge>
          <span className={styles.kind}>{view.kind}</span>
          <bdi
            className={
              view.customerMasked ? `num ${styles.customer}` : styles.customer
            }
          >
            {view.customer}
          </bdi>
          {/* «منذ…» right to left, a date left to right (I-9 #6). */}
          <span className={`num ${styles.since}`} dir="auto">
            {view.since}
          </span>
        </div>
      </header>

      <div className={styles.columns}>
        <div className={styles.order}>
          <div className={styles.summary}>
            <ul className={styles.lines}>
              {view.lines.map((l, i) => (
                <li key={i} className={styles.lineItem}>
                  <span className={styles.lineLabel}>{l.label}</span>
                  <span className={`num ${styles.amount}`}>{l.amount}</span>
                </li>
              ))}
            </ul>
            {view.deliveryFee !== null && (
              <div className={styles.lineItem}>
                <span>{T.details.deliveryFee}</span>
                <span className={`num ${styles.amount}`}>
                  {view.deliveryFee}
                </span>
              </div>
            )}
            <div className={`${styles.lineItem} ${styles.total}`}>
              <span>{T.details.total}</span>
              <span className="num">{view.total}</span>
            </div>
            {view.payment !== null && (
              <span className={styles.payment}>{view.payment}</span>
            )}
          </div>

          {view.address !== null && (
            <div className={styles.address}>
              <span className={styles.label}>{T.details.address}</span>
              <p className={styles.addressText} dir="auto">
                {view.address}
              </p>
            </div>
          )}

          <ol className={styles.history}>
            {view.history.map((h) => (
              <li key={h.key} className={styles.historyItem}>
                <StatusBadge status={h.status} className={styles.historyBadge}>
                  {h.badge}
                </StatusBadge>
                {/* Numbers alone — «14:30», «28/9 · 14:30»: one group, left
                    to right (I-9 #6). */}
                <span className={`num ${styles.time}`} dir="ltr">
                  {h.time}
                </span>
                {/* Right under «ملغى»: why — staff's words, as the customer
                    received them. */}
                {h.reason !== null && (
                  <div className={styles.reason}>
                    <span className={styles.label}>
                      {T.details.cancellationReason}
                    </span>
                    <p className={styles.reasonText} dir="auto">
                      {h.reason}
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ol>

          <div className={styles.actions}>
            {view.action !== null && (
              <NextStepButton
                shown={order}
                action={view.action}
                onOutcome={onOutcome}
                className={styles.step}
              />
            )}
            {line !== null && (
              <p className={styles.line} role="status">
                {line}
              </p>
            )}
            {/* The full number lives in this link alone: the counter's
                screen may be seen by the next customer. */}
            <a
              className={styles.secondary}
              href={view.chat}
              target="_blank"
              rel="noopener"
            >
              {T.details.messageCustomer}
            </a>
            {/* On a line of its own, 24px below the step: a wrong press at a
                busy counter costs an order. */}
            {view.canCancel && (
              <button
                type="button"
                className={`${styles.secondary} ${styles.cancel}`}
                onClick={() => setCancelling(true)}
              >
                {T.details.cancelOrder}
              </button>
            )}
          </div>
        </div>

        <div className={styles.conversation}>{conversation}</div>
      </div>

      <CancelDialog
        open={cancelling}
        orderNumber={order.orderNumber}
        busy={busy}
        onConfirm={confirmCancel}
        onClose={() => setCancelling(false)}
      />
    </>
  );
}
