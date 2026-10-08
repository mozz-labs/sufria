"use client";

import { useLayoutEffect, type RefObject } from "react";

/**
 * Writes where `ref` starts on the page — its distance from the document's
 * top, whatever the scroll — as the CSS variable `--<name>` on it: before the
 * first paint (a layout effect), and again whenever something above it may
 * have moved (the body's size, the window's). CSS sizes what depends on it,
 * so nothing jumps (brief I-9b #1).
 *
 * The element must not be sticky itself: a stuck element reports where it is
 * stuck, not where it starts.
 */
export function useOffsetTop(
  ref: RefObject<HTMLElement | null>,
  name: string,
): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const write = () =>
      el.style.setProperty(
        `--${name}`,
        `${Math.round(el.getBoundingClientRect().top + window.scrollY)}px`,
      );
    write();
    const observer = new ResizeObserver(write);
    observer.observe(document.body);
    window.addEventListener("resize", write);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", write);
    };
  }, [ref, name]);
}
