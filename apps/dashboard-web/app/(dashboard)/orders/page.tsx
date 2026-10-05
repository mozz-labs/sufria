"use client";

import { SessionGate } from "../../../features/auth/components/session-gate.tsx";
import { OrderBoard } from "../../../features/orders/components/order-board.tsx";

/** «الطلبات» and «السجل» (brief G §3, G-4), behind login. */
export default function OrdersPage() {
  return (
    <SessionGate>
      {(session, logout) => (
        <OrderBoard restaurantName={session.restaurantName} onLogout={logout} />
      )}
    </SessionGate>
  );
}
