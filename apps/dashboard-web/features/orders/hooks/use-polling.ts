"use client";

import { useEffect, useRef } from "react";

/**
 * `tick` now, then every `ms`, while the browser tab is visible — never while
 * it is hidden, and at once when it is shown again (brief G §3, brief I §4).
 * The latest `tick` is the one called: it may change between renders without
 * restarting the clock.
 */
export function usePolling(tick: () => void, ms: number): void {
  const latest = useRef(tick);
  useEffect(() => {
    latest.current = tick;
  });

  useEffect(() => {
    let timer: number | undefined;
    const run = () => {
      if (document.visibilityState === "visible") latest.current();
    };
    const start = () => {
      window.clearInterval(timer);
      if (document.visibilityState !== "visible") return;
      run();
      timer = window.setInterval(run, ms);
    };
    start();
    document.addEventListener("visibilitychange", start);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", start);
    };
  }, [ms]);
}
