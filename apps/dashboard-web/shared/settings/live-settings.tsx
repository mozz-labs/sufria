"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Currency, RestaurantSettings } from "@sufria/shared";
import {
  initialSettings,
  pauseChanged,
  settingsRead,
} from "./live-settings-state.ts";

export type LiveSettings = {
  /** The restaurant's currency; `null` until the first read. */
  currency: Currency | null;
  /** `undefined` until the first read · `null` taking orders · paused since. */
  ordersPausedAt: string | null | undefined;
  /** When last read or changed: the strip's «منذ…» counts to it. */
  readAt: number;
  /** The poll's read of `GET /restaurant/settings`, sent at `startedAt`. */
  read(settings: RestaurantSettings, startedAt: number): void;
  /** «أوقف» or «استأنف» answered. */
  pauseChanged(ordersPausedAt: string | null): void;
};

const LiveSettingsContext = createContext<LiveSettings | null>(null);

/** The settings of the dashboard's one poll, from any page or the header. */
export function useLiveSettings(): LiveSettings {
  const settings = useContext(LiveSettingsContext);
  if (!settings) throw new Error("useLiveSettings outside its provider");
  return settings;
}

/**
 * The restaurant's settings for every page behind login (brief ي-ب §4):
 * read by «الطلبات»'s poll with each tick, and read here by the pause strip
 * and the menu — two features, so in shared/ (brief I §2.2, rule 2).
 */
export function LiveSettingsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(() => initialSettings(Date.now()));

  const read = useCallback(
    (settings: RestaurantSettings, startedAt: number) =>
      setState((s) => settingsRead(s, settings, startedAt, Date.now())),
    [],
  );
  const changed = useCallback(
    (ordersPausedAt: string | null) =>
      setState((s) => pauseChanged(s, ordersPausedAt, Date.now())),
    [],
  );

  const value = useMemo<LiveSettings>(
    () => ({
      currency: state.currency,
      ordersPausedAt: state.ordersPausedAt,
      readAt: state.readAt,
      read,
      pauseChanged: changed,
    }),
    [state, read, changed],
  );

  return <LiveSettingsContext value={value}>{children}</LiveSettingsContext>;
}
