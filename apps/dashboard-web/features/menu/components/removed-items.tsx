"use client";

import { memo, useCallback, useState } from "react";
import {
  DASHBOARD_UI_AR,
  restoredLineAr,
  type ArchivedMenuItem,
  type Currency,
} from "@sufria/shared";
import { useLiveSettings } from "../../../shared/settings/live-settings.tsx";
import { Skeleton } from "../../../shared/ui/skeleton.tsx";
import { menuApi } from "../api/menu-api.ts";
import { useRemovedItems } from "../hooks/use-removed.ts";
import { itemErrorLine, removedRowView } from "../lib/menu.ts";
import { MenuTabs } from "./menu-tabs.tsx";
import screen from "./menu-screen.module.css";
import styles from "./removed-items.module.css";

const T = DASHBOARD_UI_AR;

/**
 * «المُزالة» (brief ي-ب §7, decision 4): what was removed from the menu,
 * the most recent first — its name, price and category, and «إرجاع». An
 * item brought back leaves this list, switched off (decision 6), and the
 * line under the tabs says where it went and what is left to do.
 */
export function RemovedItems() {
  const { currency } = useLiveSettings();
  const removed = useRemovedItems();
  const { drop } = removed;
  const [restored, setRestored] = useState<string | null>(null);

  const onRestored = useCallback(
    (item: ArchivedMenuItem) => {
      drop(item.id);
      setRestored(restoredLineAr(item.name));
    },
    [drop],
  );

  const ready = removed.state.kind === "ready" && currency !== null;
  const items = removed.state.kind === "ready" ? removed.state.items : [];

  return (
    <main className={screen.page}>
      <h1 className="visually-hidden">{T.tabs.menu}</h1>
      <MenuTabs current="removed" />

      {restored && (
        <p className={styles.restored} role="status" aria-live="polite">
          {restored}
        </p>
      )}

      {(removed.state.kind === "loading" ||
        (removed.state.kind === "ready" && currency === null)) && (
        <Skeleton lines={5} />
      )}

      {removed.state.kind === "failed" && (
        <div className={screen.failed}>
          <p className={screen.notice}>{T.errors.loadFailed}</p>
          <button
            type="button"
            className={screen.secondary}
            onClick={() => void removed.reload()}
          >
            {T.errors.retry}
          </button>
        </div>
      )}

      {ready && items.length === 0 && (
        <p className={screen.empty}>{T.menu.empty.removed}</p>
      )}

      {ready && items.length > 0 && (
        <ul className={screen.items}>
          {items.map((item) => (
            <RemovedRow
              key={item.id}
              item={item}
              currency={currency}
              onRestored={onRestored}
            />
          ))}
        </ul>
      )}
    </main>
  );
}

const RemovedRow = memo(function RemovedRow({
  item,
  currency,
  onRestored,
}: {
  item: ArchivedMenuItem;
  currency: Currency;
  onRestored: (item: ArchivedMenuItem) => void;
}) {
  const view = removedRowView(item, currency);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);

  async function restore() {
    setBusy(true);
    setLine(null);
    const res = await menuApi.updateItem(item.id, { archived: false });
    setBusy(false);
    if (res.ok) onRestored(item);
    else setLine(itemErrorLine(res.error));
  }

  return (
    <li className={styles.row}>
      <div className={styles.view}>
        <span className={styles.name} dir="auto">
          {view.name}
        </span>
        <span className={`num ${styles.price}`}>{view.amount}</span>
        <span className={styles.category}>{view.category}</span>
        <button
          type="button"
          className={styles.button}
          onClick={restore}
          disabled={busy}
          aria-busy={busy}
        >
          {T.menu.restore}
        </button>
      </div>
      {line && (
        <p className={styles.line} role="status">
          {line}
        </p>
      )}
    </li>
  );
});
