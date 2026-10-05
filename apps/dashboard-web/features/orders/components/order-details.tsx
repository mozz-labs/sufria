"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { orderNumberLabel, type OrderDetail } from "@sufria/shared";
import { BackArrow } from "../../../shared/ui/back-arrow.tsx";
import { ordersApi } from "../api/orders-api.ts";
import { backTo } from "../lib/board.ts";
import styles from "./order-details.module.css";

type Props = {
  id: string;
  /** `?from=` of the page: `history` brings the back link to «السجل». */
  from: string | string[] | undefined;
};

/**
 * One order (brief I §4, I-6): the back link first, then the order number —
 * the page's `<h1>`.
 */
export function OrderDetails({ id, from }: Props) {
  const [order, setOrder] = useState<OrderDetail | null>(null);

  useEffect(() => {
    let current = true;
    void ordersApi.orderDetail(id).then((res) => {
      if (current && res.ok) setOrder(res.value);
    });
    return () => {
      current = false;
    };
  }, [id]);

  const back = backTo(from);
  return (
    <main className={styles.page}>
      <Link href={back.href} className={styles.back}>
        <BackArrow />
        {back.label}
      </Link>
      {order && (
        <h1 className={`num ${styles.number}`}>
          <bdi dir="ltr">{orderNumberLabel(order.orderNumber)}</bdi>
        </h1>
      )}
    </main>
  );
}
