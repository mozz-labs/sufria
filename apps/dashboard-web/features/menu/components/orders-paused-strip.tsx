"use client";

import { useState } from "react";
import { DASHBOARD_UI_AR, ordersPausedAr } from "@sufria/shared";
import { useLiveSettings } from "../../../shared/settings/live-settings.tsx";
import { ordersPauseApi } from "../api/orders-pause-api.ts";
import styles from "./orders-paused-strip.module.css";

const T = DASHBOARD_UI_AR;

/**
 * While orders are paused (brief ي-ب §5, decision 3): a strip under the
 * header on every page — where «انقطع الاتصال» is, and as it looks: the
 * surface, a line under it, neutral, never the accent — with «استأنف», the
 * one button that resumes. Above «انقطع الاتصال» when both show (the
 * header's `strip` slot). The pause is the poll's, read every tick, and the
 * answer's after «أوقف» or «استأنف» (`useLiveSettings`).
 */
export function OrdersPausedStrip() {
  const { ordersPausedAt, readAt, pauseChanged } = useLiveSettings();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!ordersPausedAt) return null;

  async function resume() {
    setBusy(true);
    setFailed(false);
    const res = await ordersPauseApi.setPaused(false);
    setBusy(false);
    if (res.ok) pauseChanged(res.value.ordersPausedAt);
    // `unauthorized`: the session is gone, and the gate takes the page to login.
    else if (res.error.kind !== "unauthorized") setFailed(true);
  }

  return (
    <div className={styles.strip} role="status">
      <div className={styles.bounds}>
        <span className={styles.label}>
          {ordersPausedAr(ordersPausedAt, readAt)}
        </span>
        <button
          type="button"
          className={styles.resume}
          onClick={resume}
          disabled={busy}
          aria-busy={busy}
        >
          {T.paused.resume}
        </button>
        {failed && <span className={styles.failed}>{T.errors.stepFailed}</span>}
      </div>
    </div>
  );
}
