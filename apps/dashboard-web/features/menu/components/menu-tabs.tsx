import Link from "next/link";
import { DASHBOARD_UI_AR } from "@sufria/shared";
import styles from "./menu-tabs.module.css";

const T = DASHBOARD_UI_AR;

/**
 * «الأصناف» and «المُزالة» — the menu screen's two views (decision 4):
 * links, the current one marked `aria-current="page"`, in the header's tabs'
 * look.
 */
export function MenuTabs({ current }: { current: "items" | "removed" }) {
  return (
    <nav className={styles.tabs}>
      <Link
        href="/menu"
        className={styles.tab}
        aria-current={current === "items" ? "page" : undefined}
      >
        {T.menu.tabs.items}
      </Link>
      <Link
        href="/menu/removed"
        className={styles.tab}
        aria-current={current === "removed" ? "page" : undefined}
      >
        {T.menu.tabs.removed}
      </Link>
    </nav>
  );
}
