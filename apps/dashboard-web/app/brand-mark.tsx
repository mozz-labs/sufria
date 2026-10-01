import styles from "./brand-mark.module.css";

/**
 * The mark: three accent bars, growing toward the start of the line — the
 * bench's schematic of the approved direction, not the final drawing.
 */
export function BrandMark() {
  return (
    <span className={styles.mark} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}
