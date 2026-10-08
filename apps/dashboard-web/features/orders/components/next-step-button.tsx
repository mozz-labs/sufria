"use client";

import { useState } from "react";
import type { OrderListItem, StaffAction } from "@sufria/shared";
import { ordersApi } from "../api/orders-api.ts";
import { advance, type AdvanceOutcome } from "../lib/board.ts";

type Props = {
  /** The order as the screen shows it: its status is the request's `from`. */
  shown: Pick<OrderListItem, "id" | "status">;
  action: StaffAction;
  onOutcome: (outcome: AdvanceOutcome) => void;
  className: string;
};

/**
 * The next step — one component on the card and on the details page (brief
 * I §4, I-6). Disabled while sending, its text unchanged (G-4) — and that
 * disabled state is what shows it working, darker with a thin running line
 * (brief I-9b #6: `.action:disabled` and `.step:disabled`, no new attribute
 * and no new code). The order changes on the screen only from the server's
 * answer (`onOutcome`): nothing is shown before it.
 */
export function NextStepButton({ shown, action, onOutcome, className }: Props) {
  const [busy, setBusy] = useState(false);

  async function press() {
    setBusy(true);
    const outcome = await advance(ordersApi, shown, action);
    setBusy(false);
    onOutcome(outcome);
  }

  return (
    <button type="button" className={className} onClick={press} disabled={busy}>
      {action.label}
    </button>
  );
}
