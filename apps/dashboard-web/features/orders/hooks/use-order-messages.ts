"use client";

import { useCallback, useState } from "react";
import type { OrderMessage } from "@sufria/shared";
import { ordersApi } from "../api/orders-api.ts";
import { MESSAGES_POLL_MS } from "../lib/details.ts";
import { usePolling } from "./use-polling.ts";

export type MessagesState =
  | { kind: "loading" }
  | { kind: "ready"; messages: OrderMessage[] }
  | { kind: "failed" };

/**
 * The order's conversation, read now and every 30 seconds while the tab is
 * visible (brief I §4, I-6). A failed read keeps what was shown.
 */
export function useOrderMessages(
  id: string,
  reportOffline: (offline: boolean) => void,
): { state: MessagesState; reload: () => Promise<void> } {
  const [state, setState] = useState<MessagesState>({ kind: "loading" });

  const reload = useCallback(async () => {
    const res = await ordersApi.orderMessages(id);
    if (res.ok) {
      setState({ kind: "ready", messages: res.value.messages });
      return;
    }
    // 401: the gate takes the page to login. 404: the order says so itself.
    if (res.error.kind === "unauthorized") return;
    if (res.error.kind === "network") reportOffline(true);
    setState((prev) => (prev.kind === "ready" ? prev : { kind: "failed" }));
  }, [id, reportOffline]);

  usePolling(() => void reload(), MESSAGES_POLL_MS);
  return { state, reload };
}
