// One card, every list. The feed card, the search result, and the
// notification row all sit on this surface, so moving between tabs never
// changes the shape of the thing you are reading — the jumping the
// separate anatomies used to cause. It is the web's card token, spelled
// natively: paper-white, the shared radius, the shared soft ink shadow.

import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { card, tokens } from '../lib/tokens';

const radiusCard = parseInt(String(tokens['radius-card']), 10) || 18;

export const cardChrome = {
  backgroundColor: card,
  borderRadius: radiusCard,
  borderCurve: 'continuous' as const,
  padding: 12,
  marginBottom: 10,
  // The web's --shadow token, spelled as the modern cross-platform
  // boxShadow (expo-native-ui bans the legacy shadow*/elevation props).
  boxShadow: '0 2px 10px rgba(38, 41, 47, 0.06)',
};

export const CardSurface = ({
  children,
  style,
  onPress,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accessibilityLabel?: string;
}) => {
  if (!onPress) return <View style={[styles.card, style]}>{children}</View>;
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.card, style, pressed && styles.pressed]}
    >
      {children}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: cardChrome,
  pressed: { opacity: 0.92 },
});
