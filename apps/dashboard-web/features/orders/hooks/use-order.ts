"use client";

import { useCallback, useState } from "react";
import type { OrderDetail } from "@sufria/shared";
import { ordersApi } from "../api/orders-api.ts";
import { DETAIL_POLL_MS } from "../lib/details.ts";
import { usePolling } from "./use-polling.ts";

export type OrderState =
  | { kind: "loading" }
  | { kind: "ready"; order: OrderDetail; readAt: number }
  /** No order with this id under the restaurant — another's included (404). */
  | { kind: "notFound" }
  /** It could not be read, and never was. */
  | { kind: "failed" };

/**
 * One order, read now and every 10 seconds while the tab is visible (brief
 * I §4, I-6). A read that fails keeps the order already shown — the header's
 * strip says the connection is down; `failed` is for an order never read.
 */
export function useOrder(
  id: string,
  reportOffline: (offline: boolean) => void,
): { state: OrderState; reload: () => Promise<void> } {
  const [state, setState] = useState<OrderState>({ kind: "loading" });

  const reload = useCallback(async () => {
    const res = await ordersApi.orderDetail(id);
    if (res.ok) {
      reportOffline(false);
      setState({ kind: "ready", order: res.value, readAt: Date.now() });
      return;
    }
    const { error } = res;
    // 401: the session is gone, and the gate takes the page to login.
    if (error.kind === "unauthorized") return;
    // 400 (not an id) and 404 (not ours, or no such order): no such order.
    if (
      error.kind === "http" &&
      (error.status === 404 || error.status === 400)
    ) {
      setState({ kind: "notFound" });
      return;
    }
    if (error.kind === "network") reportOffline(true);
    setState((prev) => (prev.kind === "ready" ? prev : { kind: "failed" }));
  }, [id, reportOffline]);

  usePolling(() => void reload(), DETAIL_POLL_MS);
  return { state, reload };
}
