"use client";

import { useState } from "react";
import Link from "next/link";
import type { Currency, OrderListItem, OrderTab } from "@sufria/shared";
import { StatusBadge } from "../../../shared/ui/status-badge.tsx";
import { cardView, type AdvanceOutcome } from "../lib/board.ts";
import { NextStepButton } from "./next-step-button.tsx";
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
 *
 * The whole card opens the order (brief I §4, I-3): a link on the number
 * itself, its ::after stretched over the card. The button is not in the link
 * — a button inside a link is two controls in one — and sits above that
 * layer, so pressing it acts without opening.
 */
export function OrderCard({ order, tab, currency, now, onOutcome }: Props) {
  const view = cardView(order, tab, currency, now);
  const [line, setLine] = useState<string | null>(null);

  function stepped(outcome: AdvanceOutcome) {
    setLine(
      outcome.kind === "refresh" || outcome.kind === "failed"
        ? outcome.line
        : null,
    );
    onOutcome(outcome);
  }

  return (
    <article className={styles.card}>
      <div className={styles.row} data-action={view.action ? "" : undefined}>
        <div className={styles.who}>
          <div className={styles.name}>
            {view.pulse && <span className={styles.pulse} aria-hidden="true" />}
            <Link href={view.href} className={styles.open}>
              <bdi dir="ltr" className={`num ${styles.number}`}>
                {view.number}
              </bdi>
            </Link>
            <bdi
              className={
                view.customerMasked ? `num ${styles.customer}` : styles.customer
              }
            >
              {view.customer}
            </bdi>
          </div>
          <div className={styles.details}>{view.details}</div>
          {view.reason && (
            <div className={styles.details} dir="auto">
              {view.reason}
            </div>
          )}
        </div>

        <StatusBadge status={order.status} className={styles.badge}>
          {view.badge}
        </StatusBadge>

        <div className={styles.figs}>
          <span className={`num ${styles.total}`}>{view.amount}</span>
          {/* «منذ…» reads right to left; a date, «28/9 · 14:30», left to
              right as one group (I-9 #6): auto picks by the text. */}
          <span className={`num ${styles.since}`} dir="auto">
            {view.since}
          </span>
        </div>

        {view.action && (
          // `order` is the card as displayed: its status is the `from`.
          <NextStepButton
            shown={order}
            action={view.action}
            onOutcome={stepped}
            className={styles.action}
          />
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
