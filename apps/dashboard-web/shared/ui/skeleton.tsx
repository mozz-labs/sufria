import styles from "./skeleton.module.css";

/**
 * What loads, drawn in the tokens before it arrives — no spinner (brief I §4,
 * I-6). `lines` bars, the first one wider.
 */
export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className={styles.skeleton} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className={styles.bar} />
      ))}
    </div>
  );
}
