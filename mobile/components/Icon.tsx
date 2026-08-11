// The product's icon vocabulary, drawn from the same bytes every surface
// uses (packages/core icons). One drawing everywhere — this is brand
// anatomy, exactly like the palette. For the handful of SYSTEM affordances
// where the platform's own glyph is what users parse (the share sheet, a
// back chevron), use SystemIcon instead; its allowlist is deliberate.

import type { ColorValue } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { PRODUCT_ICONS, type ProductIconName } from '../lib/core/icons';

export type { ProductIconName };

// The canon's aria-hidden="true" is right where the web injects these
// strings as markup, but react-native-svg's web renderer re-creates
// parsed attributes as React props — the hyphenated attribute arrives as
// an invalid `ariaHidden` DOM prop and trips React (and its `accessible`
// prop forwards to the DOM the same broken way, so no substitute prop
// either). Strip the attribute here; the glyphs are decorative and every
// icon sits beside its own text label.
const xml: Record<string, string> = {};
const xmlFor = (name: ProductIconName): string => {
  xml[name] ??= PRODUCT_ICONS[name].replace(' aria-hidden="true"', '');
  return xml[name];
};

export default function Icon({ name, size = 21, color }: { name: ProductIconName; size?: number; color: ColorValue }) {
  return <SvgXml xml={xmlFor(name)} width={size} height={size} color={color} />;
}
