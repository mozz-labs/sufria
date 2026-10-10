"use client";

import { useId } from "react";
import { DASHBOARD_UI_AR } from "@sufria/shared";
import { Dialog } from "../../../shared/ui/dialog.tsx";
import styles from "./confirm-dialog.module.css";

const T = DASHBOARD_UI_AR;

type Props = {
  open: boolean;
  title: string;
  body: string;
  /** The confirming button's word: «أزِله», «شغّل الكل». */
  confirm: string;
  /** Sending: the confirming button marked busy, its word unchanged. */
  busy: boolean;
  /** Why it did not go through (texts 17 · 18 · `stepFailed`). */
  line: string | null;
  onConfirm: () => void;
  onClose: () => void;
};

/**
 * The menu's two confirmations (brief ي-ب, decisions 5 and 6): «إزالة» and
 * «شغّل الكل» — a title, what it does, and the two buttons, «رجوع» being
 * `cancel.back`. On the shared modal window (`shared/ui/dialog.tsx`).
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirm,
  busy,
  line,
  onConfirm,
  onClose,
}: Props) {
  const id = useId();
  return (
    <Dialog open={open} onClose={onClose} labelledBy={`${id}-title`}>
      <div className={styles.box}>
        <h2 id={`${id}-title`} className={styles.title}>
          {title}
        </h2>
        <p className={styles.body}>{body}</p>
        {line && (
          <p className={styles.line} role="status">
            {line}
          </p>
        )}
        <div className={styles.buttons}>
          <button
            type="button"
            className={styles.button}
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy}
          >
            {confirm}
          </button>
          <button type="button" className={styles.button} onClick={onClose}>
            {T.cancel.back}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
