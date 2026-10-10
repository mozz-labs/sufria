"use client";

import { useCallback, useEffect, useState } from "react";
import type { ArchivedMenuItem } from "@sufria/shared";
import { menuApi } from "../api/menu-api.ts";

export type RemovedState =
  | { kind: "loading" }
  | { kind: "ready"; items: ArchivedMenuItem[] }
  /** It could not be read, and never was. */
  | { kind: "failed" };

/**
 * «المُزالة» (brief ي-ب §7): `GET /menu-items?archived=true`, the most
 * recently removed first — read when the tab opens, not polled. An item
 * brought back leaves the list.
 */
export function useRemovedItems() {
  const [state, setState] = useState<RemovedState>({ kind: "loading" });

  const receive = useCallback(
    (res: Awaited<ReturnType<typeof menuApi.listArchived>>) => {
      if (res.ok) {
        setState({ kind: "ready", items: res.value.items });
        return;
      }
      // 401: the session is gone, and the gate takes the page to login.
      if (res.error.kind === "unauthorized") return;
      setState((prev) => (prev.kind === "ready" ? prev : { kind: "failed" }));
    },
    [],
  );

  useEffect(() => {
    let current = true;
    void menuApi.listArchived().then((res) => {
      if (current) receive(res);
    });
    return () => {
      current = false;
    };
  }, [receive]);

  /** «حاول مجددا». */
  const reload = useCallback(
    async () => receive(await menuApi.listArchived()),
    [receive],
  );
  const drop = useCallback(
    (id: string) =>
      setState((s) =>
        s.kind === "ready"
          ? { ...s, items: s.items.filter((item) => item.id !== id) }
          : s,
      ),
    [],
  );

  return { state, reload, drop };
}
