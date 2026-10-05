import { DASHBOARD_UI_AR, type OrderTab } from "@sufria/shared";
import { BrandMark } from "../ui/brand-mark.tsx";
import styles from "./dashboard-header.module.css";

const T = DASHBOARD_UI_AR;

type Props = {
  restaurantName: string;
  tab: OrderTab;
  /** The number on «الطلبات»; `null` until the first poll answers. */
  activeCount: number | null;
  onTab: (tab: OrderTab) => void;
  onLogout: () => void;
};

/**
 * The dashboard's header (brief G §3, G-4): the mark and «سُفريا», «مباشر»,
 * logout, the restaurant's name, and the two tabs with the active count.
 */
export function DashboardHeader({
  restaurantName,
  tab,
  activeCount,
  onTab,
  onLogout,
}: Props) {
  return (
    <header className={styles.top}>
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
      <h1 className={styles.title}>{restaurantName}</h1>
      <div className={styles.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          className={styles.tab}
          aria-selected={tab === "active"}
          onClick={() => onTab("active")}
        >
          {T.tabs.active}
          {activeCount !== null && (
            <span className={`num ${styles.count}`}>{activeCount}</span>
          )}
        </button>
        <button
          type="button"
          role="tab"
          className={styles.tab}
          aria-selected={tab === "history"}
          onClick={() => onTab("history")}
        >
          {T.tabs.history}
        </button>
      </div>
    </header>
  );
}
