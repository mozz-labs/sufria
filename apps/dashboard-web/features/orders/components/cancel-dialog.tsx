"use client";

import { useState, type FormEvent } from "react";
import {
  DASHBOARD_UI_AR,
  MAX_CANCELLATION_REASON_LENGTH,
  cancelTitleAr,
} from "@sufria/shared";
import { Dialog } from "../../../shared/ui/dialog.tsx";
import { reasonCounter } from "../lib/details.ts";
import styles from "./cancel-dialog.module.css";

const T = DASHBOARD_UI_AR;

type Props = {
  open: boolean;
  orderNumber: number;
  /** Sending: the confirm button waits, its text unchanged. */
  busy: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
};

/**
 * «إلغاء الطلب» (brief I §4, I-6): the reason is optional — and 🔴 it reaches
 * the customer word for word («ألغينا طلبك — [السبب].»), which the line under
 * the field says before anything is sent.
 */
export function CancelDialog({
  open,
  orderNumber,
  busy,
  onConfirm,
  onClose,
}: Props) {
  const [reason, setReason] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    onConfirm(reason);
  }

  return (
    <Dialog open={open} onClose={onClose} labelledBy="cancel-title">
      <form className={styles.form} onSubmit={submit}>
        <h2 id="cancel-title" className={styles.title}>
          {cancelTitleAr(orderNumber)}
        </h2>
        <label className={styles.field}>
          <span className={styles.label}>{T.cancel.reason}</span>
          <textarea
            className={styles.input}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={MAX_CANCELLATION_REASON_LENGTH}
            rows={3}
            dir="auto"
            aria-describedby="cancel-hint cancel-count"
          />
        </label>
        <div className={styles.under}>
          <p id="cancel-hint" className={styles.hint}>
            {T.cancel.reasonHint}
          </p>
          {/* One group, left to right: «12 / 300», never «300 / 12». */}
          <span id="cancel-count" dir="ltr" className={`num ${styles.count}`}>
            {reasonCounter(reason.length)}
          </span>
        </div>
        <div className={styles.buttons}>
          {/* The secondary style: the destructive colour is still open (I-6). */}
          <button type="submit" className={styles.button} disabled={busy}>
            {T.cancel.confirm}
          </button>
          <button type="button" className={styles.button} onClick={onClose}>
            {T.cancel.back}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
