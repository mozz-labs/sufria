/**
 * The restaurant's settings as the dashboard's one poll last read them
 * (brief ي-ب §4): the currency, and whether orders are paused. Pure — the
 * provider (`live-settings.tsx`) holds the state, these decide it.
 */
import type { Currency, RestaurantSettings } from "@sufria/shared";

export type SettingsState = {
  /** `null` until the first read. */
  currency: Currency | null;
  /**
   * `undefined` until the first read · `null` taking orders · ISO 8601: paused
   * since then.
   */
  ordersPausedAt: string | null | undefined;
  /** When last read or changed — the strip's «منذ…» counts to it. */
  readAt: number;
  /** When «أوقف» or «استأنف» last answered. */
  changedAt: number;
};

export function initialSettings(now: number): SettingsState {
  return {
    currency: null,
    ordersPausedAt: undefined,
    readAt: now,
    changedAt: Number.NEGATIVE_INFINITY,
  };
}

/**
 * The poll read `GET /restaurant/settings`, the request sent at `startedAt`.
 * 🔴 A read sent before «أوقف» or «استأنف» answered carries the pause as it
 *    was: the answer stands, and the next tick reads the new one. Without
 *    this the strip would vanish for one tick after «أوقف».
 */
export function settingsRead(
  state: SettingsState,
  settings: Pick<RestaurantSettings, "currency" | "ordersPausedAt">,
  startedAt: number,
  now: number,
): SettingsState {
  const stale = startedAt <= state.changedAt;
  return {
    currency: settings.currency,
    ordersPausedAt: stale ? state.ordersPausedAt : settings.ordersPausedAt,
    readAt: now,
    changedAt: state.changedAt,
  };
}

/** «أوقف» or «استأنف» answered: the pause from the answer, at once. */
export function pauseChanged(
  state: SettingsState,
  ordersPausedAt: string | null,
  now: number,
): SettingsState {
  return { ...state, ordersPausedAt, readAt: now, changedAt: now };
}
