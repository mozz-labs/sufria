"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ORDERS, RESTAURANT, STAFF } from "../../lib/mock";
import styles from "./shell.module.css";

type NavItem = {
  href: string;
  icon: string;
  label: string;
  live?: boolean;
};

const NAV: NavItem[] = [
  { href: "/dashboard", icon: "◉", label: "الطلبات الحية", live: true },
  { href: "/dashboard/menu", icon: "☰", label: "القائمة" },
  { href: "/dashboard/customers", icon: "◍", label: "الزبائن" },
  { href: "/dashboard/analytics", icon: "▤", label: "التحليلات" },
  { href: "/dashboard/settings", icon: "⚙", label: "الإعدادات" },
];

const TITLES: Record<string, string> = {
  "/dashboard": "الطلبات الحية",
  "/dashboard/menu": "القائمة",
  "/dashboard/customers": "الزبائن",
  "/dashboard/analytics": "التحليلات",
  "/dashboard/settings": "الإعدادات",
};

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [theme, setTheme] = useState<"light" | "dark">("light");

  // الوضع محفوظ بالذاكرة — ممنوع localStorage (قاعدة S0-04).
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const liveCount = ORDERS.filter(
    (o) => o.status === "pending_acceptance" || o.status === "preparing",
  ).length;

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.mark} aria-hidden="true">
            ش
          </div>
          <div className={styles.brandText}>
            <span className={styles.brandName}>{RESTAURANT.name}</span>
            <span className={styles.brandSub}>{RESTAURANT.branch}</span>
          </div>
        </div>

        <nav className={styles.nav}>
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.navItem} ${active ? styles.navItemActive : ""}`}
                aria-current={active ? "page" : undefined}
              >
                <span className={styles.navIcon} aria-hidden="true">
                  {item.icon}
                </span>
                {item.label}
                {item.live && (
                  <span className={styles.navCount}>{liveCount}</span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className={styles.sidebarFoot}>
          <div className={styles.staff}>
            <div className={styles.avatar} aria-hidden="true">
              {STAFF.name.charAt(0)}
            </div>
            <div className={styles.staffText}>
              <span className={styles.staffName}>{STAFF.name}</span>
              <span className={styles.staffRole}>{STAFF.role}</span>
            </div>
          </div>
          <button className={styles.logout} onClick={() => router.push("/")}>
            <span className={styles.navIcon} aria-hidden="true">
              ⏻
            </span>
            تسجيل خروج
          </button>
        </div>
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar}>
          <h1 className={styles.pageTitle}>{TITLES[pathname] ?? "اللوحة"}</h1>

          <span className={styles.conn}>
            <span className={styles.dot} aria-hidden="true" />
            متصل
          </span>

          <button
            className={styles.themeBtn}
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            aria-label={
              theme === "dark" ? "التبديل للوضع الفاتح" : "التبديل للوضع الغامق"
            }
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
        </header>

        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
