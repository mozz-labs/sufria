"use client";

import { useCallback, useState } from "react";
import {
  DASHBOARD_UI_AR,
  enableAllBodyAr,
  offCountAr,
  removeTitleAr,
  type MenuItemListItem,
} from "@sufria/shared";
import { useLiveSettings } from "../../../shared/settings/live-settings.tsx";
import { Skeleton } from "../../../shared/ui/skeleton.tsx";
import { menuApi } from "../api/menu-api.ts";
import { ordersPauseApi } from "../api/orders-pause-api.ts";
import { useMenu } from "../hooks/use-menu.ts";
import {
  byCategory,
  itemErrorLine,
  menuErrorLine,
  offCount,
} from "../lib/menu.ts";
import { AddItemForm } from "./add-item-form.tsx";
import { ConfirmDialog } from "./confirm-dialog.tsx";
import { MenuRow } from "./menu-row.tsx";
import { MenuTabs } from "./menu-tabs.tsx";
import styles from "./menu-screen.module.css";

const T = DASHBOARD_UI_AR;

/** One of the screen's two confirmations, open. */
type Asking =
  | { kind: "remove"; item: MenuItemListItem }
  | { kind: "enableAll"; count: number };

/**
 * «المنيو» (brief ي-ب §6): «أضف صنفا», «أوقف الطلبات مؤقتا» with what the
 * customers will get under it — both gone while paused (decision 3: the
 * strip's «استأنف» is then the one button) — «المطفأة» and «شغّل الكل»
 * while any is off, the two tabs, and the menu under its categories in the
 * customer's order, an item switched off keeping its place. No menu
 * numbers: the bot's change with every switch-off.
 */
export function MenuScreen() {
  const { currency, ordersPausedAt, pauseChanged } = useLiveSettings();
  const menu = useMenu();
  const { update, drop, reload } = menu;
  const [adding, setAdding] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [pauseFailed, setPauseFailed] = useState(false);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [askLine, setAskLine] = useState<string | null>(null);

  const askRemove = useCallback((item: MenuItemListItem) => {
    setAskLine(null);
    setAsking({ kind: "remove", item });
  }, []);

  async function pause() {
    setPausing(true);
    setPauseFailed(false);
    const res = await ordersPauseApi.setPaused(true);
    setPausing(false);
    // The strip shows at once, from the answer; this button goes with it.
    if (res.ok) pauseChanged(res.value.ordersPausedAt);
    // `unauthorized`: the gate takes the page to login.
    else if (res.error.kind !== "unauthorized") setPauseFailed(true);
  }

  async function confirm() {
    if (!asking) return;
    setConfirming(true);
    setAskLine(null);
    if (asking.kind === "remove") {
      const res = await menuApi.updateItem(asking.item.id, { archived: true });
      setConfirming(false);
      if (!res.ok) return setAskLine(itemErrorLine(res.error));
      drop(asking.item.id);
    } else {
      const res = await menuApi.enableAll();
      setConfirming(false);
      if (!res.ok) return setAskLine(menuErrorLine(res.error));
      await reload();
    }
    setAsking(null);
  }

  const ready = menu.state.kind === "ready" && currency !== null;
  const items = menu.state.kind === "ready" ? menu.state.items : [];
  const categories = menu.state.kind === "ready" ? menu.state.categories : [];
  const off = offCount(items);

  return (
    <main className={styles.page}>
      <h1 className="visually-hidden">{T.tabs.menu}</h1>
      <MenuTabs current="items" />

      {ready && (
        <div className={styles.toolbar}>
          {!adding && categories.length > 0 && (
            <button
              type="button"
              className={styles.primary}
              onClick={() => setAdding(true)}
            >
              {T.menu.add}
            </button>
          )}
          {ordersPausedAt === null && (
            <div className={styles.pause}>
              <button
                type="button"
                className={styles.secondary}
                onClick={pause}
                disabled={pausing}
                aria-busy={pausing}
              >
                {T.menu.pause}
              </button>
              <p className={styles.hint}>{T.menu.pauseHint}</p>
              {pauseFailed && (
                <p className={styles.line} role="status">
                  {T.errors.stepFailed}
                </p>
              )}
            </div>
          )}
          {off > 0 && (
            <div className={styles.off}>
              <span className={`num ${styles.offCount}`}>
                {offCountAr(off)}
              </span>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => {
                  setAskLine(null);
                  setAsking({ kind: "enableAll", count: off });
                }}
              >
                {T.menu.enableAll}
              </button>
            </div>
          )}
        </div>
      )}

      {ready && adding && (
        <AddItemForm
          categories={categories}
          onAdded={() => {
            setAdding(false);
            void reload();
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {(menu.state.kind === "loading" ||
        (menu.state.kind === "ready" && currency === null)) && (
        <Skeleton lines={5} />
      )}

      {menu.state.kind === "failed" && (
        <div className={styles.failed}>
          <p className={styles.notice}>{T.errors.loadFailed}</p>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => void reload()}
          >
            {T.errors.retry}
          </button>
        </div>
      )}

      {ready && items.length === 0 && (
        <p className={styles.empty}>{T.menu.empty.items}</p>
      )}

      {ready &&
        byCategory(items).map((group) => (
          <section
            key={group.id}
            className={styles.category}
            aria-labelledby={`category-${group.id}`}
          >
            <h2 id={`category-${group.id}`} className={styles.heading}>
              {group.name}
            </h2>
            <ul className={styles.items}>
              {group.items.map((item) => (
                <MenuRow
                  key={item.id}
                  item={item}
                  currency={currency}
                  onChanged={update}
                  onRemove={askRemove}
                />
              ))}
            </ul>
          </section>
        ))}

      <ConfirmDialog
        open={asking !== null}
        title={
          asking?.kind === "remove"
            ? removeTitleAr(asking.item.name)
            : T.menu.enableAllTitle
        }
        body={
          asking?.kind === "enableAll"
            ? enableAllBodyAr(asking.count)
            : T.menu.removeBody
        }
        confirm={
          asking?.kind === "enableAll" ? T.menu.enableAll : T.menu.removeConfirm
        }
        busy={confirming}
        line={askLine}
        onConfirm={() => void confirm()}
        onClose={() => setAsking(null)}
      />
    </main>
  );
}
