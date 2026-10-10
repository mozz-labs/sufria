"use client";

import { useCallback, useEffect, useState } from "react";
import type { MenuCategory, MenuItemListItem } from "@sufria/shared";
import { menuApi } from "../api/menu-api.ts";
import { replaceItem } from "../lib/menu.ts";

export type MenuState =
  | { kind: "loading" }
  | { kind: "ready"; items: MenuItemListItem[]; categories: MenuCategory[] }
  /** It could not be read, and never was. */
  | { kind: "failed" };

/**
 * The menu and the categories «أضف» can add to (brief ي-ب §6): read when
 * the screen opens, and again after «أضف» and «شغّل الكل» — not polled. A
 * read that fails keeps what was shown; `failed` is for a menu never read.
 * One item's change replaces it in its place: it never moves.
 */
/** The two reads, together. */
const readMenu = () =>
  Promise.all([menuApi.listItems(), menuApi.listCategories()]);

export function useMenu() {
  const [state, setState] = useState<MenuState>({ kind: "loading" });

  /** The two reads answered: the menu, or `failed` if it was never read. */
  const receive = useCallback(
    ([items, categories]: Awaited<ReturnType<typeof readMenu>>) => {
      if (items.ok && categories.ok) {
        setState({
          kind: "ready",
          items: items.value.items,
          categories: categories.value.categories,
        });
        return;
      }
      // 401: the session is gone, and the gate takes the page to login.
      if (
        [items, categories].some(
          (r) => !r.ok && r.error.kind === "unauthorized",
        )
      )
        return;
      setState((prev) => (prev.kind === "ready" ? prev : { kind: "failed" }));
    },
    [],
  );

  useEffect(() => {
    let current = true;
    void readMenu().then((answers) => {
      if (current) receive(answers);
    });
    return () => {
      current = false;
    };
  }, [receive]);

  /** Read again: after «أضف» and «شغّل الكل», and «حاول مجددا». */
  const reload = useCallback(async () => receive(await readMenu()), [receive]);

  const update = useCallback(
    (changed: MenuItemListItem) =>
      setState((s) =>
        s.kind === "ready" ? { ...s, items: replaceItem(s.items, changed) } : s,
      ),
    [],
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

  return { state, reload, update, drop };
}
