/**
 * The dashboard's colours — brief G §2, locked 15 September. The one source:
 * the CSS variables are generated from here (`designTokensCss`), and
 * `pnpm check:contrast` reads its pairs from here, so a colour changed in one
 * place is checked in the same place.
 *
 * 🔴 No hex anywhere else in `dashboard-web`: components read these as CSS
 *    variables, and `check:contrast` fails on a raw hex or on a `color:` that
 *    names a variable it does not check.
 */
import type { OrderStatus } from "./domain.js";

export const COLOR_MODES = ["light", "dark"] as const;
export type ColorMode = (typeof COLOR_MODES)[number];

export type ColorToken =
  | "bg"
  | "surface"
  | "text-primary"
  | "text-secondary"
  | "text-muted"
  | "border"
  | "accent"
  | "on-accent";

/**
 * `on-accent` is not in the brief's table: it is the white of the bench's
 * primary button (`.accept{color:#fff}`), named so that no component writes
 * `#fff` itself.
 */
export const COLOR_TOKENS: Record<ColorMode, Record<ColorToken, string>> = {
  light: {
    bg: "#F7F7F5",
    surface: "#FFFFFF",
    "text-primary": "#161615",
    "text-secondary": "#5A5A57",
    "text-muted": "#8A8A85",
    border: "#E2E2DE",
    accent: "#75284A",
    "on-accent": "#FFFFFF",
  },
  dark: {
    bg: "#171715",
    surface: "#1F1F1C",
    "text-primary": "#F2F1EE",
    "text-secondary": "#B8B6AF",
    "text-muted": "#8F8D86",
    border: "#302F2B",
    accent: "#B54874",
    "on-accent": "#FFFFFF",
  },
};

/**
 * Which text colour falls on which background in the UI. `check:contrast`
 * enumerates its pairs from this, and fails on any CSS `color:` whose variable
 * is not a key here or a badge text — so a text colour cannot reach the screen
 * without being checked.
 *
 * 🔴 Two locked tokens are **not** text colours, because they miss 4.5:1:
 *    - `text-muted` in light: 3.23:1 on `bg`, 3.47:1 on `surface`.
 *    - `accent` in dark: 3.54:1 on `bg`, 3.26:1 on `surface` — so the active
 *      tab is marked by its accent underline, and its text stays primary.
 *    Both are used by the bench as text (`.since`, `.tab[aria-selected]`).
 *    Recorded in the brief-G report; the values themselves are locked.
 */
export const TEXT_ON_BACKGROUND: Readonly<
  Partial<Record<ColorToken, readonly ColorToken[]>>
> = {
  "text-primary": ["bg", "surface"],
  "text-secondary": ["bg", "surface"],
  "on-accent": ["accent"],
};

/** A status badge: its text on its own background, nothing else. */
export type BadgeColors = { bg: string; text: string };

export const STATUS_BADGE_COLORS: Record<
  OrderStatus,
  Record<ColorMode, BadgeColors>
> = {
  pending_acceptance: {
    light: { bg: "#FCE8D6", text: "#8A4A0A" },
    dark: { bg: "#43290F", text: "#F2B577" },
  },
  accepted: {
    light: { bg: "#C9E3EF", text: "#35555F" },
    dark: { bg: "#1F2E34", text: "#9CC2D0" },
  },
  preparing: {
    light: { bg: "#EDE6F7", text: "#5B3A99" },
    dark: { bg: "#2E2440", text: "#C9AEF0" },
  },
  ready: {
    light: { bg: "#FBEAB0", text: "#7A5C06" },
    dark: { bg: "#423A0E", text: "#F0D077" },
  },
  completed: {
    light: { bg: "#DCEEDC", text: "#24632F" },
    dark: { bg: "#1E3423", text: "#9FD3A8" },
  },
  cancelled: {
    light: { bg: "#C0A9A8", text: "#682622" },
    dark: { bg: "#3D2320", text: "#E7A69E" },
  },
  expired: {
    light: { bg: "#87837A", text: "#131108" },
    dark: { bg: "#2B2A26", text: "#ACA99F" },
  },
};

/** The CSS variable of a badge colour: `--badge-ready-text`. */
export function badgeVar(status: OrderStatus, part: keyof BadgeColors): string {
  return `--badge-${status}-${part}`;
}

/** WCAG 2.x relative luminance of `#RRGGBB`. */
export function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a #RRGGBB colour: ${hex}`);
  const n = parseInt(m[1]!, 16);
  const channel = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
}

/** WCAG 2.x contrast ratio, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** WCAG AA for body text — every text on the screen is under 18.66px bold. */
export const MIN_TEXT_CONTRAST = 4.5;

export type ContrastPair = {
  /** `"light · text-secondary on surface"`, `"dark · badge ready"`. */
  name: string;
  text: string;
  background: string;
  ratio: number;
};

/**
 * Every text-on-background pair of the screen, in both modes, enumerated from
 * the tables above: each declared text colour on each background it falls on,
 * and each badge's text on its own background.
 */
export function contrastPairs(
  colors: Record<ColorMode, Record<ColorToken, string>> = COLOR_TOKENS,
  textOn: Readonly<
    Partial<Record<ColorToken, readonly ColorToken[]>>
  > = TEXT_ON_BACKGROUND,
  badges: Record<
    OrderStatus,
    Record<ColorMode, BadgeColors>
  > = STATUS_BADGE_COLORS,
): ContrastPair[] {
  const pairs: ContrastPair[] = [];
  for (const mode of COLOR_MODES) {
    for (const [text, backgrounds] of Object.entries(textOn) as [
      ColorToken,
      readonly ColorToken[],
    ][]) {
      for (const background of backgrounds) {
        const t = colors[mode][text];
        const b = colors[mode][background];
        pairs.push({
          name: `${mode} · ${text} on ${background}`,
          text: t,
          background: b,
          ratio: contrastRatio(t, b),
        });
      }
    }
    for (const [status, byMode] of Object.entries(badges) as [
      OrderStatus,
      Record<ColorMode, BadgeColors>,
    ][]) {
      const { text, bg } = byMode[mode];
      pairs.push({
        name: `${mode} · badge ${status}`,
        text,
        background: bg,
        ratio: contrastRatio(text, bg),
      });
    }
  }
  return pairs;
}

/**
 * The CSS variables names a `color:` may use in `dashboard-web`: the declared
 * text colours and the badge texts — exactly the ones `contrastPairs` checks.
 */
export function checkedTextVariables(
  textOn: Readonly<
    Partial<Record<ColorToken, readonly ColorToken[]>>
  > = TEXT_ON_BACKGROUND,
): string[] {
  return [
    ...Object.keys(textOn).map((t) => `--${t}`),
    ...(Object.keys(STATUS_BADGE_COLORS) as OrderStatus[]).map((s) =>
      badgeVar(s, "text"),
    ),
  ];
}

function declarations(mode: ColorMode): string {
  const lines = Object.entries(COLOR_TOKENS[mode]).map(
    ([token, value]) => `--${token}:${value};`,
  );
  for (const [status, byMode] of Object.entries(STATUS_BADGE_COLORS) as [
    OrderStatus,
    Record<ColorMode, BadgeColors>,
  ][]) {
    lines.push(`${badgeVar(status, "bg")}:${byMode[mode].bg};`);
    lines.push(`${badgeVar(status, "text")}:${byMode[mode].text};`);
  }
  return lines.join("");
}

/**
 * The stylesheet `dashboard-web` puts in `<head>`: light by default, dark by
 * the device setting — no toggle (brief G §2).
 */
export function designTokensCss(): string {
  return (
    `:root{color-scheme:light dark;${declarations("light")}}` +
    `@media (prefers-color-scheme: dark){:root{${declarations("dark")}}}`
  );
}
