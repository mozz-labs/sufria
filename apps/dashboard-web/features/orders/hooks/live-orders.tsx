"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Currency, OrderListItem } from "@sufria/shared";
import { useLiveSettings } from "../../../shared/settings/live-settings.tsx";
import { ordersApi } from "../api/orders-api.ts";
import { POLL_MS, replaceInActive } from "../lib/board.ts";
import { usePolling } from "./use-polling.ts";

export type LiveOrders = {
  /** The restaurant's currency (`useLiveSettings`); `null` until read. */
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
 * Each tick also reads the restaurant's settings, beside the list (brief
 * ي-ب §4): the currency and `ordersPausedAt`, for the pause strip and the
 * menu — another device's «أوقف» shows here within one tick.
 *
 * A 401 the refresh could not cure clears the session, and the session gate
 * takes the page to login: nothing to do here.
 */
export function LiveOrdersProvider({
  children,
}: {
  children: (live: LiveOrders) => ReactNode;
}) {
  const { currency, read } = useLiveSettings();
  const [orders, setOrders] = useState<OrderListItem[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    const startedAt = Date.now();
    const [settings, res] = await Promise.all([
      ordersApi.restaurantSettings(),
      ordersApi.listOrders("active"),
    ]);
    if (settings.ok) read(settings.value, startedAt);
    setNow(Date.now());
    if (res.ok) setOrders(res.value.orders);
    // `unauthorized`: the session is gone, and the gate takes the page to login.
    const failed = [settings, res].some(
      (r) => !r.ok && r.error.kind !== "unauthorized",
    );
    setOffline(failed);
  }, [read]);

  usePolling(() => void refresh(), POLL_MS);

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
