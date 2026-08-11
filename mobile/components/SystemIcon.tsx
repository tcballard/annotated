// System affordances wear the PLATFORM'S glyph, because that is what the
// user's thumb recognizes: Apple's square-and-arrow means "share" on an
// iPhone in a way no brand drawing can. SF Symbols on iOS (per the
// expo-native-ui skill), the product's platform-appropriate drawing
// everywhere else — SF Symbols are licensed for Apple platforms only, so
// they can never become the product set.
//
// The allowlist is the point: share and forward/back chevrons are system
// vocabulary; everything else is brand vocabulary and belongs to Icon.
// Adding a name here is a design decision, not a convenience.

import type { ColorValue } from 'react-native';
import { Image } from 'expo-image';
import Icon, { type ProductIconName } from './Icon';

const SYSTEM_ICONS = {
  share: { sf: 'square.and.arrow.up', product: 'share-android' },
  back: { sf: 'chevron.backward', product: 'back' },
  forward: { sf: 'chevron.forward', product: 'chevron-right' },
} satisfies Record<string, { sf: string; product: ProductIconName }>;

export type SystemIconName = keyof typeof SYSTEM_ICONS;

export default function SystemIcon({ name, size = 21, color }: { name: SystemIconName; size?: number; color: ColorValue }) {
  const entry = SYSTEM_ICONS[name];
  if (process.env.EXPO_OS === 'ios') {
    // expo-image's tintColor is typed string-only; ColorValue casts through
    // (the expo-native-ui skill's own documented exception).
    return <Image source={`sf:${entry.sf}`} style={{ width: size, height: size }} tintColor={color as string} />;
  }
  return <Icon name={entry.product} size={size} color={color} />;
}
