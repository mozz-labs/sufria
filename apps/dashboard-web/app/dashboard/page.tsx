"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  ORDERS,
  STATUS_LABEL,
  money,
  orderTotal,
  type Order,
  type OrderStatus,
} from "../../lib/mock";
import styles from "./orders.module.css";

const ACCENT: Record<OrderStatus, { c: string; t: string }> = {
  pending_acceptance: { c: "var(--warn)", t: "var(--warn-tint)" },
  preparing: { c: "var(--info)", t: "var(--info-tint)" },
  ready: { c: "var(--ok)", t: "var(--ok-tint)" },
  expired: { c: "var(--crit)", t: "var(--crit-tint)" },
};

const FILTERS: { key: OrderStatus | "all"; label: string }[] = [
  { key: "all", label: "الكل" },
  { key: "pending_acceptance", label: "بانتظار القبول" },
  { key: "preparing", label: "قيد التحضير" },
  { key: "ready", label: "جاهز" },
  { key: "expired", label: "منتهي" },
];

function Timer({ minutes }: { minutes: number }) {
  const cls =
    minutes >= 45 ? styles.timerUrgent : minutes >= 15 ? styles.timerWarn : "";
  return (
    <span className={`${styles.timer} ${cls}`}>
      {minutes}
      <span style={{ fontSize: "0.75em" }}>د</span>
    </span>
  );
}

function OrderCard({ order, index }: { order: Order; index: number }) {
  const a = ACCENT[order.status];
  const style = {
    "--accent": a.c,
    "--accentTint": a.t,
    animationDelay: `${index * 55}ms`,
  } as CSSProperties;

  return (
    <article className={styles.card} style={style}>
      <div className={styles.cardHead}>
        <span className={styles.code}>{order.code}</span>
        <div className={styles.customer}>
          <span className={styles.customerName}>
            {order.customer}
            {order.vip && (
              <span className={`${styles.tag} ${styles.tagVip}`}>مميّز</span>
            )}
            {order.repeat && <span className={styles.tag}>زبون متكرر</span>}
          </span>
          <span className={styles.phone}>{order.phone}</span>
        </div>
        <span className={styles.badge}>
          <span className={styles.badgeDot} aria-hidden="true" />
          {STATUS_LABEL[order.status]}
        </span>
      </div>

      <div className={styles.meta}>
        <span className={styles.metaItem}>
          <span className={styles.metaIcon} aria-hidden="true">
            ◷
          </span>
          منذ <Timer minutes={order.minutesAgo} />
        </span>
        <span className={styles.metaItem}>
          <span className={styles.metaIcon} aria-hidden="true">
            ⇲
          </span>
          {order.fulfillment}
        </span>
        <span className={styles.metaItem}>
          <span className={styles.metaIcon} aria-hidden="true">
            ▤
          </span>
          {order.payment}
        </span>
      </div>

      <ul className={styles.items}>
        {order.items.map((it) => (
          <li className={styles.item} key={it.name}>
            <span className={styles.qty}>{it.qty}×</span>
            <span className={styles.itemName}>{it.name}</span>
            <span className={styles.itemPrice}>{money(it.qty * it.price)}</span>
          </li>
        ))}
      </ul>

      <div className={styles.foot}>
        <span className={styles.total}>
          <span className={styles.totalLabel}>الإجمالي</span>
          <span className={styles.totalValue}>
            {money(orderTotal(order))} JD
          </span>
        </span>

        {order.status === "pending_acceptance" && (
          <>
            <button className={styles.action}>رفض</button>
            <button className={`${styles.action} ${styles.actionPrimary}`}>
              قبول
            </button>
          </>
        )}
        {order.status === "preparing" && (
          <button className={`${styles.action} ${styles.actionPrimary}`}>
            جاهز للاستلام
          </button>
        )}
        {order.status === "ready" && (
          <button className={styles.action}>تم التسليم</button>
        )}
        {order.status === "expired" && (
          <button className={styles.action}>عرض التفاصيل</button>
        )}
      </div>
    </article>
  );
}

export default function OrdersPage() {
  const [filter, setFilter] = useState<OrderStatus | "all">("all");
  const [tick, setTick] = useState(0);

  // العدّاد بيتحرك — بيخلي اللوحة تبيّن حيّة وقت العرض.
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 60000);
    return () => window.clearInterval(id);
  }, []);

  const orders = useMemo(
    () =>
      ORDERS.map((o) => ({ ...o, minutesAgo: o.minutesAgo + tick })).filter(
        (o) => filter === "all" || o.status === filter,
      ),
    [filter, tick],
  );

  const live = ORDERS.filter(
    (o) => o.status === "pending_acceptance" || o.status === "preparing",
  );
  const revenue = ORDERS.filter((o) => o.status !== "expired").reduce(
    (s, o) => s + orderTotal(o),
    0,
  );
  const avgWait = Math.round(
    live.reduce((s, o) => s + o.minutesAgo + tick, 0) / (live.length || 1),
  );

  const stats = [
    { label: "طلبات نشطة الآن", value: String(live.length), unit: "" },
    {
      label: "بانتظار القبول",
      value: String(
        ORDERS.filter((o) => o.status === "pending_acceptance").length,
      ),
      unit: "",
    },
    { label: "متوسط الانتظار", value: String(avgWait), unit: "دقيقة" },
    { label: "مبيعات اليوم", value: money(revenue), unit: "JD" },
  ];

  return (
    <>
      <div className={styles.stats}>
        {stats.map((s, i) => (
          <div
            className={styles.stat}
            key={s.label}
            style={{ animationDelay: `${i * 55}ms` }}
          >
            <span className={styles.statLabel}>{s.label}</span>
            <span className={styles.statValue}>
              {s.value}
              {s.unit && <span className={styles.statUnit}>{s.unit}</span>}
            </span>
          </div>
        ))}
      </div>

      <div className={styles.filters}>
        {FILTERS.map((f) => {
          const n =
            f.key === "all"
              ? ORDERS.length
              : ORDERS.filter((o) => o.status === f.key).length;
          return (
            <button
              key={f.key}
              className={`${styles.chip} ${filter === f.key ? styles.chipActive : ""}`}
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
            >
              {f.label}
              <span className={styles.chipCount}>{n}</span>
            </button>
          );
        })}
      </div>

      <div className={styles.grid}>
        {orders.map((o, i) => (
          <OrderCard order={o} index={i} key={o.id} />
        ))}
      </div>
    </>
  );
}
