import type { ReactNode } from "react";
import type { OrderStatus } from "@sufria/shared";
import styles from "./status-badge.module.css";

type Props = {
  status: OrderStatus;
  /** The badge's text — `ORDER_STATUS_LABEL_AR`, through the screen's view. */
  children: ReactNode;
  /** Where the badge sits in its parent's layout. */
  className?: string;
};

/** A status badge (brief G §2): its colours are the status's own tokens. */
export function StatusBadge({ status, children, className }: Props) {
  return (
    <span
      className={className ? `${styles.badge} ${className}` : styles.badge}
      data-status={status}
    >
      {children}
    </span>
  );
}
