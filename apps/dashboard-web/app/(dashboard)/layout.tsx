"use client";

import type { ReactNode } from "react";
import { SessionGate } from "../../features/auth/components/session-gate.tsx";
import { LiveOrdersProvider } from "../../features/orders/hooks/live-orders.tsx";
import { DashboardHeader } from "../../shared/layout/dashboard-header.tsx";
import { LiveSettingsProvider } from "../../shared/settings/live-settings.tsx";

/**
 * Every page behind login (brief I §2.1, I-3): the guard, the header, and the
 * one poll of «الطلبات» feeding both the header's count and the list — and,
 * with each tick, the restaurant's settings (brief ي-ب §4).
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <SessionGate>
      {(session, logout) => (
        <LiveSettingsProvider>
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
        </LiveSettingsProvider>
      )}
    </SessionGate>
  );
}
