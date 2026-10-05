import styles from "./back-arrow.module.css";

/**
 * «Back»: an arrow toward the start of the line — right in Arabic, mirrored
 * by the direction it sits in, never drawn for one (brief I §1.6).
 */
export function BackArrow() {
  return (
    <svg
      className={styles.arrow}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M15 5l-7 7 7 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
