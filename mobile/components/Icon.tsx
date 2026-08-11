// The product's icon vocabulary, drawn from the same bytes every surface
// uses (packages/core icons). One drawing everywhere — this is brand
// anatomy, exactly like the palette. For the handful of SYSTEM affordances
// where the platform's own glyph is what users parse (the share sheet, a
// back chevron), use SystemIcon instead; its allowlist is deliberate.

import type { ColorValue } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { PRODUCT_ICONS, type ProductIconName } from '../lib/core/icons';

export type { ProductIconName };

export default function Icon({ name, size = 21, color }: { name: ProductIconName; size?: number; color: ColorValue }) {
  return <SvgXml xml={PRODUCT_ICONS[name]} width={size} height={size} color={color} />;
}
