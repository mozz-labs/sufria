"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DASHBOARD_UI_AR,
  type Currency,
  type OrderListItem,
  type OrderTab,
} from "@sufria/shared";
import { api } from "../../lib/client.ts";
import {
  POLL_MS,
  replaceInActive,
  type AdvanceOutcome,
} from "../../lib/board.ts";
import { useSession } from "../../lib/use-session.ts";
import { BrandMark } from "../brand-mark.tsx";
import { OrderCard } from "./order-card.tsx";
import styles from "./orders.module.css";

const T = DASHBOARD_UI_AR;

type History = { orders: OrderListItem[]; page: number; hasMore: boolean };

/**
 * The orders screen — `docs/design/orders-bench.html` at the «متوسطة»
 * density (brief G §3, G-4). «الطلبات» polls every 10 seconds while the tab
 * is visible; «السجل» loads on demand, 20 at a time.
 */
export default function OrdersPage() {
  const router = useRouter();
  const session = useSession();

  const [tab, setTab] = useState<OrderTab>("active");
  const [currency, setCurrency] = useState<Currency | null>(null);
  const [active, setActive] = useState<OrderListItem[] | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [offline, setOffline] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const loadingMore = useRef(false);

  const toLogin = useCallback(() => router.replace("/"), [router]);

  /** The restaurant's currency, read once; `false` when it could not be. */
  const ensureCurrency = useCallback(async (): Promise<boolean> => {
    if (currency) return true;
    const s = await api.restaurantSettings();
    if (s.ok) {
      setCurrency(s.value.currency);
      return true;
    }
    if (s.error.kind === "unauthorized") toLogin();
    else setOffline(true);
    return false;
  }, [currency, toLogin]);

  /** One poll of «الطلبات». */
  const refreshActive = useCallback(async () => {
    if (!(await ensureCurrency())) return;
    const res = await api.listOrders("active");
    setNow(Date.now());
    if (res.ok) {
      setActive(res.value.orders);
      setOffline(false);
    } else if (res.error.kind === "unauthorized") toLogin();
    else setOffline(true);
  }, [ensureCurrency, toLogin]);

  const loadHistory = useCallback(
    async (page: number) => {
      if (!(await ensureCurrency())) return;
      const res = await api.listOrders("history", page);
      setNow(Date.now());
      if (!res.ok) {
        if (res.error.kind === "unauthorized") toLogin();
        else setOffline(true);
        return;
      }
      setOffline(false);
      setHistory((prev) => ({
        orders:
          page === 1 || !prev
            ? res.value.orders
            : [...prev.orders, ...res.value.orders],
        page: res.value.page,
        hasMore: res.value.hasMore,
      }));
    },
    [ensureCurrency, toLogin],
  );

  // No session in this tab: to login.
  useEffect(() => {
    if (session === null) toLogin();
  }, [session, toLogin]);

  // «الطلبات»: now, then every 10 s, and never while the browser tab is
  // hidden — it catches up the moment it is shown again.
  useEffect(() => {
    if (!session || tab !== "active") return;
    let timer: number | undefined;
    const tick = () => {
      if (document.visibilityState === "visible") void refreshActive();
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
  }, [session, tab, refreshActive]);

  const onOutcome = useCallback(
    (outcome: AdvanceOutcome) => {
      if (outcome.kind === "unauthorized") return toLogin();
      if (outcome.kind === "changed") {
        setNow(Date.now());
        setActive((list) => list && replaceInActive(list, outcome.order));
      }
      if (outcome.kind === "refresh") void refreshActive();
    },
    [refreshActive, toLogin],
  );

  /**
   * «السجل» loads page 1 each time it is opened — an order completed a moment
   * ago is there. No automatic refresh after that.
   */
  function openTab(next: OrderTab) {
    setTab(next);
    if (next === "history") void loadHistory(1);
  }

  async function loadMore() {
    if (!history || loadingMore.current) return;
    loadingMore.current = true;
    await loadHistory(history.page + 1);
    loadingMore.current = false;
  }

  async function logout() {
    await api.logout();
    toLogin();
  }

  if (!session) return null;

  const list = tab === "active" ? active : (history?.orders ?? null);

  return (
    <div className={styles.screen}>
      <header className={styles.top}>
        <div className={styles.topRow}>
          <BrandMark />
          <span className={styles.wordmark}>{T.brand}</span>
          <span className={styles.live}>
            <span className={styles.liveDot} aria-hidden="true" />
            {T.live}
          </span>
          <button type="button" className={styles.logout} onClick={logout}>
            {T.logout}
          </button>
        </div>
        <h1 className={styles.title}>{session.restaurantName}</h1>
        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            className={styles.tab}
            aria-selected={tab === "active"}
            onClick={() => openTab("active")}
          >
            {T.tabs.active}
            {active && (
              <span className={`num ${styles.count}`}>{active.length}</span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            className={styles.tab}
            aria-selected={tab === "history"}
            onClick={() => openTab("history")}
          >
            {T.tabs.history}
          </button>
        </div>
      </header>

      {offline && (
        <div className={styles.offline} role="status">
          {T.errors.disconnected}
        </div>
      )}

      <main className={styles.list}>
        {list && currency && list.length === 0 && (
          <p className={styles.empty}>
            {tab === "active" ? T.empty.active : T.empty.history}
          </p>
        )}
        {list &&
          currency &&
          list.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              tab={tab}
              currency={currency}
              now={now}
              onOutcome={onOutcome}
            />
          ))}
        {tab === "history" && history?.hasMore && (
          <button type="button" className={styles.more} onClick={loadMore}>
            {T.more}
          </button>
        )}
      </main>
    </div>
  );
}
