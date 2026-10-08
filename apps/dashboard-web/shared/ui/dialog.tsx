"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "./dialog.module.css";

type Props = {
  open: boolean;
  /** Esc, or a button of the dialog's own: the parent closes it. */
  onClose: () => void;
  /** The id of the dialog's title. */
  labelledBy: string;
  children: ReactNode;
};

/**
 * A modal window (brief I §4, I-6): the browser's own <dialog>, shown modal —
 * everything else is inert, so focus stays inside it; Esc closes it; and
 * focus goes back to what opened it.
 */
export function Dialog({ open, onClose, labelledBy, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      // Esc: the browser would close it behind React's back.
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (opener.current instanceof HTMLElement) opener.current.focus();
      }}
    >
      {open && children}
    </dialog>
  );
}
