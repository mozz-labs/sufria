"use client";

import { useCallback } from "react";
import { DASHBOARD_UI_AR } from "@sufria/shared";
import { useLiveOrders } from "../hooks/live-orders.tsx";
import type { AdvanceOutcome } from "../lib/board.ts";
import { OrderCard } from "./order-card.tsx";
import styles from "./order-list.module.css";

const T = DASHBOARD_UI_AR;

/**
 * «الطلبات» (brief G §3, G-4): the live list of the dashboard's one poll,
 * oldest first, each card with its next step.
 */
export function ActiveOrders() {
  const live = useLiveOrders();
  const { apply, refresh } = live;

  // `unauthorized`: the session is gone, and the gate takes the page to login.
  const onOutcome = useCallback(
    (outcome: AdvanceOutcome) => {
      if (outcome.kind === "changed") apply(outcome.order);
      if (outcome.kind === "refresh") void refresh();
    },
    [apply, refresh],
  );

  const { orders, currency, now } = live;
  return (
    <main className={styles.list}>
      <h1 className="visually-hidden">{T.tabs.active}</h1>
      {orders && currency && orders.length === 0 && (
        <p className={styles.empty}>{T.empty.active}</p>
      )}
      {orders &&
        currency &&
        orders.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            tab="active"
            currency={currency}
            now={now}
            onOutcome={onOutcome}
          />
        ))}
    </main>
  );
}
