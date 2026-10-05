"use client";

import { useState } from "react";
import type { Currency, OrderListItem, OrderTab } from "@sufria/shared";
import { ordersApi } from "../api/orders-api.ts";
import { advance, cardView, type AdvanceOutcome } from "../lib/board.ts";
import styles from "./order-card.module.css";

type Props = {
  order: OrderListItem;
  tab: OrderTab;
  currency: Currency;
  now: number;
  /** The board acts on the outcome: update, refresh, or back to login. */
  onOutcome: (outcome: AdvanceOutcome) => void;
};

/**
 * One order, right to left (brief G §3, G-4): number and customer with the
 * grey line under them · badge · total and «منذ…» · the next-step button.
 */
export function OrderCard({ order, tab, currency, now, onOutcome }: Props) {
  const view = cardView(order, tab, currency, now);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);

  async function press() {
    if (!view.action) return;
    setBusy(true);
    setLine(null);
    // `order` is the card as displayed: its status is the request's `from`.
    const outcome = await advance(ordersApi, order, view.action);
    setBusy(false);
    if (outcome.kind === "refresh" || outcome.kind === "failed")
      setLine(outcome.line);
    onOutcome(outcome);
  }

  return (
    <article className={styles.card}>
      <div className={styles.row}>
        <div className={styles.who}>
          <div className={styles.name}>
            {view.pulse && <span className={styles.pulse} aria-hidden="true" />}
            <bdi dir="ltr" className={`num ${styles.number}`}>
              {view.number}
            </bdi>
            <bdi>{view.customer}</bdi>
          </div>
          <div className={styles.details}>{view.details}</div>
          {view.reason && <div className={styles.details}>{view.reason}</div>}
        </div>

        <span className={styles.badge} data-status={order.status}>
          {view.badge}
        </span>

        <div className={styles.figs}>
          <span className={`num ${styles.total}`}>{view.amount}</span>
          <span className={`num ${styles.since}`}>{view.since}</span>
        </div>

        {view.action ? (
          // Disabled while sending, its text unchanged (G-4).
          <button
            type="button"
            className={styles.action}
            onClick={press}
            disabled={busy}
          >
            {view.action.label}
          </button>
        ) : (
          tab === "active" && <span className={styles.actionSpace} />
        )}
      </div>
      {line && (
        <p className={styles.line} role="status">
          {line}
        </p>
      )}
    </article>
  );
}
