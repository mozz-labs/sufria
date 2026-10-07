"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DASHBOARD_UI_AR } from "@sufria/shared";
import { BrandMark } from "../ui/brand-mark.tsx";
import styles from "./dashboard-header.module.css";

const T = DASHBOARD_UI_AR;

type Props = {
  restaurantName: string;
  /** The number on «الطلبات»; `null` until the first poll answers. */
  activeCount: number | null;
  /** The last read failed: the strip under the header. */
  offline: boolean;
  onLogout: () => void;
};

/**
 * The dashboard's header on every page behind login (brief G §3 G-4, brief I
 * §4 I-3): the mark and «سُفريا», «مباشر», logout, the restaurant's name, the
 * two tabs — links, the current one marked `aria-current="page"` — and the
 * strip while the connection is down.
 *
 * The restaurant's name keeps its place and size but is not the page's
 * `<h1>`: each page has its own.
 */
export function DashboardHeader({
  restaurantName,
  activeCount,
  offline,
  onLogout,
}: Props) {
  const pathname = usePathname();
  const current = (href: string) => (pathname === href ? "page" : undefined);

  return (
    <>
      <header className={styles.top}>
        {/* The page's width and edges; the background is the screen's. */}
        <div className={`${styles.bounds} ${styles.content}`}>
          <div className={styles.topRow}>
            <BrandMark />
            <span className={styles.wordmark}>{T.brand}</span>
            <span className={styles.live}>
              <span className={styles.liveDot} aria-hidden="true" />
              {T.live}
            </span>
            <button type="button" className={styles.logout} onClick={onLogout}>
              {T.logout}
            </button>
          </div>
          <p className={styles.title}>{restaurantName}</p>
          <nav className={styles.tabs}>
            <Link
              href="/orders"
              className={styles.tab}
              aria-current={current("/orders")}
            >
              {T.tabs.active}
              {activeCount !== null && (
                <span className={`num ${styles.count}`}>{activeCount}</span>
              )}
            </Link>
            <Link
              href="/history"
              className={styles.tab}
              aria-current={current("/history")}
            >
              {T.tabs.history}
            </Link>
          </nav>
        </div>
      </header>

      {offline && (
        <div className={styles.offline} role="status">
          <div className={styles.bounds}>{T.errors.disconnected}</div>
        </div>
      )}
    </>
  );
}
