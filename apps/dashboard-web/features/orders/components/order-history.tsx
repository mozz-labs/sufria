"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DASHBOARD_UI_AR,
  type OrderListItem,
  type OrderListResponse,
} from "@sufria/shared";
import type { ApiResult } from "../../../shared/api/http.ts";
import { ordersApi } from "../api/orders-api.ts";
import { useLiveOrders } from "../hooks/live-orders.tsx";
import { OrderCard } from "./order-card.tsx";
import styles from "./order-list.module.css";

const T = DASHBOARD_UI_AR;

type History = { orders: OrderListItem[]; page: number; hasMore: boolean };

/** History has no button, so a card's press never reaches here. */
const noOutcome = () => {};

/**
 * «السجل» (brief G §3, G-4): page 1 each time it is opened — an order
 * completed a moment ago is there — then 20 more at a time. No automatic
 * refresh, and no button on its cards.
 */
export function OrderHistory() {
  const { currency, reportOffline } = useLiveOrders();
  const [history, setHistory] = useState<History | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const loadingMore = useRef(false);

  /** A page of «السجل» answered: appended, or the strip when it failed. */
  const receive = useCallback(
    (page: number, res: ApiResult<OrderListResponse>) => {
      setNow(Date.now());
      if (!res.ok) {
        // `unauthorized`: the gate takes the page to login.
        if (res.error.kind !== "unauthorized") reportOffline(true);
        return;
      }
      reportOffline(false);
      setHistory((prev) => ({
        orders:
          page === 1 || !prev
            ? res.value.orders
            : [...prev.orders, ...res.value.orders],
        page: res.value.page,
        hasMore: res.value.hasMore,
      }));
    },
    [reportOffline],
  );

  useEffect(() => {
    let current = true;
    void ordersApi.listOrders("history", 1).then((res) => {
      if (current) receive(1, res);
    });
    return () => {
      current = false;
    };
  }, [receive]);

  async function loadMore() {
    if (!history || loadingMore.current) return;
    loadingMore.current = true;
    const page = history.page + 1;
    receive(page, await ordersApi.listOrders("history", page));
    loadingMore.current = false;
  }

  const orders = history?.orders ?? null;
  return (
    <main className={styles.list}>
      <h1 className="visually-hidden">{T.tabs.history}</h1>
      {orders && currency && orders.length === 0 && (
        <p className={styles.empty}>{T.empty.history}</p>
      )}
      {orders &&
        currency &&
        orders.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            tab="history"
            currency={currency}
            now={now}
            onOutcome={noOutcome}
          />
        ))}
      {history?.hasMore && (
        <button type="button" className={styles.more} onClick={loadMore}>
          {T.more}
        </button>
      )}
    </main>
  );
}
