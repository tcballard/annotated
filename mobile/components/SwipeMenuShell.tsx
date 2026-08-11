// The ChatGPT-anatomy menu: the panel stays mounted underneath a single
// moving surface — the whole app face slides right to reveal it, keeping
// one continuous corner shape for the entire gesture. Reanimated owns the
// horizontal translation on the UI thread; Gesture Handler feeds it.
// Adapted from Code-with-Beto's swipe-menu-example (MIT), minus its
// screen-corner-surface native module — Expo Go can't load local native
// code, so the surface wears the example's fallback radii instead.

import { createContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BackHandler, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { card, paper, tokens } from '../lib/tokens';

// Tuning lifted from the example: the drag arms on 8pt of horizontal
// intent unless 18pt of vertical travel claims the touch for scrolling;
// release projects velocity into the open/close decision. The edge width
// is ours — see the gesture below.
export const SWIPE_GESTURE = {
  activationDistance: 8,
  directionDistanceThreshold: 12,
  edgeWidth: 90,
  openPositionThreshold: 0.18,
  velocityInfluence: 0.05,
  velocityThreshold: 160,
  verticalTolerance: 18,
} as const;

// Clamped so the surface never overshoots its seat — an overshoot would
// flash the root behind the menu's far edge.
export const SWIPE_SPRING = { damping: 26, mass: 0.8, overshootClamping: true, stiffness: 220 } as const;

// While the surface travels, the menu beneath fades up and settles out of
// a slight lift — the content arrives; the layer itself never moves.
export const SWIPE_MENU_REVEAL = {
  fadeStartProgress: 0.08,
  fadeEndProgress: 0.5,
  startScale: 0.975,
  startVerticalOffset: 8,
} as const;

// The example reads the device's true corner radius from a local native
// module; Expo Go can't, so the surface approximates the screen corner
// with the example's own fallback constants and reads as the screen
// itself sliding aside.
export const SURFACE_CORNER_RADIUS = process.env.EXPO_OS === 'ios' ? 55 : process.env.EXPO_OS === 'android' ? 32 : 28;

export const SWIPE_MENU_WIDTH_RATIO = 0.78;
export const SWIPE_MENU_MAX_WIDTH = 320;
// The surface shades the menu it uncovers — ink-tinted like every shadow
// in the identity, falling left from the travelling edge.
export const SWIPE_MENU_SURFACE_SHADOW = '-8px 0 40px rgba(38, 41, 47, 0.2)';

type SwipeMenuControls = { open(): void; close(): void; isOpen: boolean };

export const SwipeMenuContext = createContext<SwipeMenuControls>({
  open() {},
  close() {},
  isOpen: false,
});

type SwipeEndState = {
  currentPosition: number;
  menuWidth: number;
  translationX: number;
  velocityX: number;
};

function clamp(value: number, minimum: number, maximum: number) {
  'worklet';

  return Math.min(maximum, Math.max(minimum, value));
}

function shouldOpenMenu({ currentPosition, menuWidth, translationX, velocityX }: SwipeEndState) {
  'worklet';

  const hasDirectionalIntent =
    Math.abs(translationX) > SWIPE_GESTURE.directionDistanceThreshold ||
    Math.abs(velocityX) > SWIPE_GESTURE.velocityThreshold;

  if (hasDirectionalIntent) {
    const projectedDirection = translationX + velocityX * SWIPE_GESTURE.velocityInfluence;
    return projectedDirection > 0;
  }

  return currentPosition > menuWidth * SWIPE_GESTURE.openPositionThreshold;
}

export default function SwipeMenuShell({ menu, children }: { menu: ReactNode; children: ReactNode }) {
  const { width: screenWidth } = useWindowDimensions();
  const menuWidth = Math.min(screenWidth * SWIPE_MENU_WIDTH_RATIO, SWIPE_MENU_MAX_WIDTH);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const translateX = useSharedValue(0);
  const gestureStartX = useSharedValue(0);
  const previousMenuWidth = useRef(menuWidth);

  const animateMenu = useCallback(
    (open: boolean) => {
      setIsMenuOpen(open);
      translateX.value = withSpring(open ? menuWidth : 0, SWIPE_SPRING);
    },
    [menuWidth, translateX],
  );

  // A rotation reseats the surface at the new width without animating.
  useEffect(() => {
    if (previousMenuWidth.current === menuWidth) return;
    translateX.value = isMenuOpen ? menuWidth : 0;
    previousMenuWidth.current = menuWidth;
  }, [isMenuOpen, menuWidth, translateX]);

  // Android's back closes the menu before it leaves the screen.
  useEffect(() => {
    if (!isMenuOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      animateMenu(false);
      return true;
    });
    return () => subscription.remove();
  }, [animateMenu, isMenuOpen]);

  const swipeGesture = useMemo(() => {
    const pan = Gesture.Pan()
      .failOffsetY([-SWIPE_GESTURE.verticalTolerance, SWIPE_GESTURE.verticalTolerance])
      .onBegin(() => {
        gestureStartX.value = translateX.value;
      })
      .onUpdate((event) => {
        translateX.value = clamp(gestureStartX.value + event.translationX, 0, menuWidth);
      })
      .onEnd((event) => {
        const shouldOpen = shouldOpenMenu({
          currentPosition: translateX.value,
          menuWidth,
          translationX: event.translationX,
          velocityX: event.velocityX,
        });
        translateX.value = withSpring(shouldOpen ? menuWidth : 0, SWIPE_SPRING);
        runOnJS(setIsMenuOpen)(shouldOpen);
      });
    if (isMenuOpen) {
      // Open, a drag anywhere — either direction — moves the surface.
      pan.activeOffsetX([-SWIPE_GESTURE.activationDistance, SWIPE_GESTURE.activationDistance]);
    } else {
      // Closed, mid-screen horizontal swipes belong to the timeline's
      // feed pager — the surface drag begins only at the left edge,
      // X-style, and only rightward.
      pan.activeOffsetX(SWIPE_GESTURE.activationDistance).hitSlop({ left: 0, width: SWIPE_GESTURE.edgeWidth });
    }
    return pan;
  }, [gestureStartX, isMenuOpen, menuWidth, translateX]);

  const surfaceAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const menuRevealStyle = useAnimatedStyle(() => {
    const progress = translateX.value / menuWidth;
    return {
      opacity: interpolate(
        progress,
        [0, SWIPE_MENU_REVEAL.fadeStartProgress, SWIPE_MENU_REVEAL.fadeEndProgress],
        [0, 0, 1],
        Extrapolation.CLAMP,
      ),
      transform: [
        {
          translateY: interpolate(
            progress,
            [0, 1],
            [SWIPE_MENU_REVEAL.startVerticalOffset, 0],
            Extrapolation.CLAMP,
          ),
        },
        { scale: interpolate(progress, [0, 1], [SWIPE_MENU_REVEAL.startScale, 1], Extrapolation.CLAMP) },
      ],
    };
  });

  const controls = useMemo<SwipeMenuControls>(
    () => ({ open: () => animateMenu(true), close: () => animateMenu(false), isOpen: isMenuOpen }),
    [animateMenu, isMenuOpen],
  );

  return (
    <SwipeMenuContext.Provider value={controls}>
      <GestureDetector gesture={swipeGesture}>
        <View style={styles.root}>
          <View
            // One modern prop hides the closed menu from assistive tech on
            // every platform (accessibilityElementsHidden on iOS,
            // no-hide-descendants on Android, aria-hidden on web) — and
            // pointerEvents lives in style, its modern home, likewise.
            aria-hidden={!isMenuOpen}
            style={[StyleSheet.absoluteFill, { pointerEvents: isMenuOpen ? 'auto' : 'none' }]}
          >
            <Animated.View style={[styles.menu, { width: menuWidth }, menuRevealStyle]}>{menu}</Animated.View>
          </View>

          <Animated.View style={[StyleSheet.absoluteFill, surfaceAnimatedStyle]}>
            <View style={styles.surfaceShadow}>
              <View style={styles.surface}>
                {children}
                <View style={[StyleSheet.absoluteFill, { pointerEvents: isMenuOpen ? 'auto' : 'none' }]}>
                  <Pressable
                    accessibilityLabel="Close menu"
                    accessibilityRole="button"
                    onPress={() => animateMenu(false)}
                    style={StyleSheet.absoluteFill}
                  />
                </View>
              </View>
            </View>
          </Animated.View>
        </View>
      </GestureDetector>
    </SwipeMenuContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden', backgroundColor: card },
  menu: { flex: 1 },
  // The shadow wrapper wears the radius but must not clip — the surface
  // inside clips content to the same shape, or the shadow would be
  // swallowed with the overflow.
  surfaceShadow: {
    flex: 1,
    borderRadius: SURFACE_CORNER_RADIUS,
    borderCurve: 'continuous',
    backgroundColor: paper,
    boxShadow: SWIPE_MENU_SURFACE_SHADOW,
  },
  surface: {
    flex: 1,
    borderRadius: SURFACE_CORNER_RADIUS,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: paper,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: tokens.hair,
  },
});
