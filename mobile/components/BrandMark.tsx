// The wordmark, as native text: lowercase ink with the terracotta dot —
// the one place the accent belongs in chrome, same as the web logo (the
// brand SVG is itself this exact text; rendering it as text keeps it
// crisp at any size and in both color schemes).

import { Text } from 'react-native';
import { accent, ink } from '../lib/tokens';

export default function BrandMark({ size = 19 }: { size?: number }) {
  return (
    <Text style={{ fontSize: size, fontWeight: '800', color: ink, letterSpacing: size * -0.021 }}>
      annotated<Text style={{ color: accent }}>.</Text>
    </Text>
  );
}
