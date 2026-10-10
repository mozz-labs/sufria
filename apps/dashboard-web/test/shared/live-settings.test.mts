/**
 * The restaurant's settings on the dashboard's one poll (brief ي-ب §4): the
 * pause read with every tick, and changed at once by «أوقف» or «استأنف» —
 * which a read already on its way when they answered does not undo.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  initialSettings,
  pauseChanged,
  settingsRead,
} from "../../shared/settings/live-settings-state.ts";

const PAUSED = "2026-10-10T12:00:00.000Z";
const read = (ordersPausedAt: string | null) => ({
  currency: "ILS" as const,
  ordersPausedAt,
});

test("before the first read nothing is known; a read brings the currency and the pause", () => {
  const start = initialSettings(1_000);
  assert.equal(start.currency, null);
  assert.equal(start.ordersPausedAt, undefined);
  const s = settingsRead(start, read(PAUSED), 1_000, 1_200);
  assert.equal(s.currency, "ILS");
  assert.equal(s.ordersPausedAt, PAUSED);
  assert.equal(s.readAt, 1_200);
});

test("another device paused: the next read shows it — within one tick", () => {
  let s = settingsRead(initialSettings(0), read(null), 0, 10);
  s = settingsRead(s, read(PAUSED), 10_000, 10_050);
  assert.equal(s.ordersPausedAt, PAUSED);
  s = settingsRead(s, read(null), 20_000, 20_050);
  assert.equal(s.ordersPausedAt, null);
});

test("«أوقف» and «استأنف»: the answer at once, before any tick", () => {
  let s = settingsRead(initialSettings(0), read(null), 0, 10);
  s = pauseChanged(s, PAUSED, 5_000);
  assert.equal(s.ordersPausedAt, PAUSED);
  assert.equal(s.readAt, 5_000);
  s = pauseChanged(s, null, 6_000);
  assert.equal(s.ordersPausedAt, null);
});

test("🔴 a read sent before «أوقف» answered does not undo it; the next one counts", () => {
  let s = settingsRead(initialSettings(0), read(null), 0, 10);
  // The tick sent at 4 900, «أوقف» answered at 5 000, the tick back at 5 100
  // with the pause as it was when it was read.
  s = pauseChanged(s, PAUSED, 5_000);
  s = settingsRead(s, read(null), 4_900, 5_100);
  assert.equal(s.ordersPausedAt, PAUSED);
  assert.equal(s.readAt, 5_100, "the clock moves all the same");
  // The next tick, sent after the answer, is the truth again.
  s = settingsRead(s, read(null), 15_000, 15_050);
  assert.equal(s.ordersPausedAt, null);
});
