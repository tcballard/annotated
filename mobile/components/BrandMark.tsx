// The wordmark, as native text: lowercase ink with the terracotta dot —
// the one place the accent belongs in chrome, same as the web logo.

import { Text } from 'react-native';
import { accent, ink } from '../lib/tokens';

export default function BrandMark() {
  return (
    <Text style={{ fontSize: 19, fontWeight: '800', color: ink, letterSpacing: -0.4 }}>
      annotated<Text style={{ color: accent }}>.</Text>
    </Text>
  );
}
