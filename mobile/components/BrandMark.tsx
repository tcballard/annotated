// The wordmark, as native text: lowercase ink with the terracotta dot —
// the one place the accent belongs in chrome. The face is named, not
// inherited: without it this drew SF on iOS and Roboto on Android, while
// the web ships the lockup outlined from Inter ExtraBold. One face, one
// tracking, every surface. Inter loads at the root layout before the
// splash lifts, so this never renders in a fallback font.

import { Text } from 'react-native';
import { accent, ink } from '../lib/tokens';

export default function BrandMark({ size = 19 }: { size?: number }) {
  return (
    <Text style={{ fontFamily: 'Inter_800ExtraBold', fontSize: size, color: ink, letterSpacing: size * -0.021 }}>
      annotated<Text style={{ color: accent }}>.</Text>
    </Text>
  );
}
