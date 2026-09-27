"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { DASHBOARD_UI_AR } from "@sufria/shared";
import { api } from "../../lib/client.ts";
import { useSession } from "../../lib/use-session.ts";
import { BrandMark } from "../brand-mark.tsx";
import styles from "./orders.module.css";

const T = DASHBOARD_UI_AR;

/** The orders screen — its header for now; the list is G-4. */
export default function OrdersPage() {
  const router = useRouter();
  const session = useSession();

  useEffect(() => {
    if (session === null) {
      router.replace("/");
      return;
    }
    if (session === undefined) return;
    // Any request that ends in 401 after a refresh sends staff back to login.
    void api.restaurantSettings().then((res) => {
      if (!res.ok && res.error.kind === "unauthorized") router.replace("/");
    });
  }, [router, session]);

  async function logout() {
    await api.logout();
    router.replace("/");
  }

  if (!session) return null;

  return (
    <div className={styles.screen}>
      <header className={styles.top}>
        <div className={styles.topRow}>
          <BrandMark />
          <span className={styles.wordmark}>{T.brand}</span>
          <button type="button" className={styles.logout} onClick={logout}>
            {T.logout}
          </button>
        </div>
        <h1 className={styles.title}>{session.restaurantName}</h1>
      </header>
    </div>
  );
}
