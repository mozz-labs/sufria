"use client";

import type { ReactNode } from "react";
import { SessionGate } from "../../features/auth/components/session-gate.tsx";
import { LiveOrdersProvider } from "../../features/orders/hooks/live-orders.tsx";
import { DashboardHeader } from "../../shared/layout/dashboard-header.tsx";

/**
 * Every page behind login (brief I §2.1, I-3): the guard, the header, and the
 * one poll of «الطلبات» feeding both the header's count and the list.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <SessionGate>
      {(session, logout) => (
        <LiveOrdersProvider>
          {(live) => (
            <>
              <DashboardHeader
                restaurantName={session.restaurantName}
                activeCount={live.orders ? live.orders.length : null}
                offline={live.offline}
                onLogout={logout}
              />
              {children}
            </>
          )}
        </LiveOrdersProvider>
      )}
    </SessionGate>
  );
}
