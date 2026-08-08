// GENERATED from src/styles.css by scripts/generate-mobile-tokens.mjs — do
// not edit by hand. The web stylesheet is the single source of truth for
// the identity; this file carries the same tokens to the native shell.
// On iOS, tokens the web's dark scheme overrides become DynamicColorIOS
// pairs, so the native chrome follows the system setting by itself.

import { DynamicColorIOS, Platform, type ColorValue } from 'react-native';

const light = {
  "chrome": "#33383F",
  "chrome-dark": "#26292F",
  "paper": "#F5F4F0",
  "card": "#FFFFFF",
  "soft": "#F0F1F3",
  "border": "#DDDEE2",
  "hair": "#E8E9EC",
  "ink": "#26292F",
  "ink-soft": "#3E444E",
  "meta": "#666C74",
  "link": "#52678F",
  "accent": "#B0674D",
  "accent-soft": "rgba(176, 103, 77, .10)",
  "accent-ink": "#8F5039",
  "serif": "Georgia, 'Times New Roman', serif",
  "mono": "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  "hover-row": "#FBFAF8",
  "strip": "#FBFBF9",
  "shadow": "0 2px 10px rgba(38, 41, 47, .06)",
  "shadow-lift": "0 4px 16px rgba(38, 41, 47, .10)",
  "radius-card": "18px",
  "radius-inner": "14px",
} as const;

const dark = {
  "paper": "#26292F",
  "card": "#2C3037",
  "soft": "#33383F",
  "border": "#3E444E",
  "hair": "#383E47",
  "ink": "#E9EAEC",
  "ink-soft": "#C9CDD3",
  "meta": "#9AA0A8",
  "link": "#8FA4C9",
  "accent-soft": "rgba(224, 164, 142, .14)",
  "accent-ink": "#E0A48E",
  "hover-row": "#31363E",
  "strip": "#2A2E35",
} as const;

const dynamic = (name: keyof typeof light): ColorValue | string =>
  Platform.OS === 'ios' && name in dark
    ? DynamicColorIOS({ light: light[name], dark: dark[name as keyof typeof dark] })
    : light[name];

export const tokens = Object.fromEntries(
  (Object.keys(light) as Array<keyof typeof light>).map((name) => [name, dynamic(name)]),
) as Record<keyof typeof light, ColorValue | string>;

export const chrome = tokens['chrome'];
export const paper = tokens['paper'];
export const card = tokens['card'];
export const ink = tokens['ink'];
export const accent = tokens['accent'];
export const meta = tokens['meta'];
