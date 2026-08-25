import styles from "./EmptyState.module.css";

export default function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: string;
  title: string;
  body: string;
  action?: string;
}) {
  return (
    <div className={styles.wrap}>
      <div className={styles.inner}>
        <div className={styles.icon} aria-hidden="true">
          {icon}
        </div>
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.body}>{body}</p>
        {action && <button className={styles.action}>{action}</button>}
      </div>
    </div>
  );
}
