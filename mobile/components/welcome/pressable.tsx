// A pressable that disappears from the accessibility tree while it is
// gated. A screen reader must not be able to reach "Start keeping
// moments" three seconds before it fades in — inert has to mean inert to
// every input method, not just to touch.

import type { PropsWithChildren } from 'react';
import { Pressable, type PressableProps, type StyleProp, StyleSheet, type ViewStyle } from 'react-native';

type GatedPressableProps = PropsWithChildren<
  Omit<PressableProps, 'style'> & { style?: StyleProp<ViewStyle> }
>;

export function GatedPressable({
  accessibilityElementsHidden,
  accessibilityState,
  accessible,
  children,
  disabled,
  focusable,
  importantForAccessibility,
  onPress,
  style,
  ...props
}: GatedPressableProps) {
  const inert = disabled || !onPress;

  return (
    <Pressable
      accessibilityElementsHidden={inert || accessibilityElementsHidden}
      accessibilityRole="button"
      accessibilityState={inert ? { ...accessibilityState, disabled: true } : accessibilityState}
      accessible={inert ? false : accessible}
      disabled={inert}
      focusable={inert ? false : focusable}
      hitSlop={4}
      importantForAccessibility={inert ? 'no-hide-descendants' : importantForAccessibility}
      onPress={inert ? undefined : onPress}
      style={({ pressed }) => [style, pressed && styles.pressed]}
      {...props}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.78 },
});
