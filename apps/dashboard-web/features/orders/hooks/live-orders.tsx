"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Currency, OrderListItem } from "@sufria/shared";
import { ordersApi } from "../api/orders-api.ts";
import { POLL_MS, replaceInActive } from "../lib/board.ts";

export type LiveOrders = {
  /** The restaurant's currency, read once; `null` until then. */
  currency: Currency | null;
  /** «الطلبات» as the last poll returned it; `null` before the first answer. */
  orders: OrderListItem[] | null;
  /** The last read failed: the header shows its strip until one answers. */
  offline: boolean;
  /** When the list was last read — the cards' «منذ…» and pulse count from it. */
  now: number;
  /** A poll now, out of turn: after a 409 `status_conflict`. */
  refresh(): Promise<void>;
  /** A card's button moved an order: in place, or gone once it is history. */
  apply(order: OrderListItem): void;
  /** A page's own read answered (`false`) or did not (`true`). */
  reportOffline(offline: boolean): void;
};

const LiveOrdersContext = createContext<LiveOrders | null>(null);

/** The live list of the dashboard's one poll, from any page under it. */
export function useLiveOrders(): LiveOrders {
  const live = useContext(LiveOrdersContext);
  if (!live) throw new Error("useLiveOrders outside <LiveOrdersProvider>");
  return live;
}

/**
 * The dashboard's one poll of «الطلبات» (brief I §4, I-3): now, then every
 * 10 seconds, on every page under it — it feeds the header's count and the
 * list both — and never while the browser tab is hidden; it catches up the
 * moment the tab is shown again.
 *
 * A 401 the refresh could not cure clears the session, and the session gate
 * takes the page to login: nothing to do here.
 */
export function LiveOrdersProvider({
  children,
}: {
  children: (live: LiveOrders) => ReactNode;
}) {
  const [currency, setCurrency] = useState<Currency | null>(null);
  const [orders, setOrders] = useState<OrderListItem[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  /** The restaurant's currency, read once; `false` when it could not be. */
  const ensureCurrency = useCallback(async (): Promise<boolean> => {
    if (currency) return true;
    const s = await ordersApi.restaurantSettings();
    if (s.ok) {
      setCurrency(s.value.currency);
      return true;
    }
    if (s.error.kind !== "unauthorized") setOffline(true);
    return false;
  }, [currency]);

  const refresh = useCallback(async () => {
    if (!(await ensureCurrency())) return;
    const res = await ordersApi.listOrders("active");
    setNow(Date.now());
    if (res.ok) {
      setOrders(res.value.orders);
      setOffline(false);
    } else if (res.error.kind !== "unauthorized") setOffline(true);
  }, [ensureCurrency]);

  useEffect(() => {
    let timer: number | undefined;
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const start = () => {
      window.clearInterval(timer);
      if (document.visibilityState !== "visible") return;
      tick();
      timer = window.setInterval(tick, POLL_MS);
    };
    start();
    document.addEventListener("visibilitychange", start);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", start);
    };
  }, [refresh]);

  const apply = useCallback((order: OrderListItem) => {
    setNow(Date.now());
    setOrders((list) => list && replaceInActive(list, order));
  }, []);

  const live = useMemo<LiveOrders>(
    () => ({
      currency,
      orders,
      offline,
      now,
      refresh,
      apply,
      reportOffline: setOffline,
    }),
    [currency, orders, offline, now, refresh, apply],
  );

  return <LiveOrdersContext value={live}>{children(live)}</LiveOrdersContext>;
}
