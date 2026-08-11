// The welcome surface: a launch dissolve into a three-page onboarding
// that tells the whole product in three sentences, then offers the door.
//
// Motion is authored to the `speak-language` reference sequence — a
// 5.070s timeline whose stops are documented, measured values:
//
//   0.033–0.200  launch page dissolves into the loading field
//   0.080–0.180  loader fades in …
//   0.290–0.333  … and back out as the content arrives
//   0.333        page one is composed
//   2.833–3.100  page one slides out, page two slides in
//   3.267–3.533  page two slides out, page three slides in
//   3.200–3.400  "tap to continue" retires
//   3.800–4.400  the primary action fades up
//
// Everything reads one clock (see ./timeline), so the sequence can be
// verified against those numbers line by line. Interaction gates keep
// each control inert until its surface has actually arrived, and reduced
// motion composes the final frame instantly rather than animating.
//
// The composition, palette, wordmark, and copy are annotated's own; the
// terracotta full stop is the single sanctioned accent in chrome.

import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, interpolate, useAnimatedStyle } from 'react-native-reanimated';

import { resolveActionPress } from './actions';
import { box, REFERENCE_WIDTH, segment } from './geometry';
import { useInteractionGate } from './interaction-gate';
import { GatedPressable } from './pressable';
import { ReferenceCanvas } from './reference-canvas';
import { useWelcomeTimeline, type WelcomeTimeline } from './timeline';
import type { WelcomeScreenProps } from './types';

// Deliberately the light palette's literal values rather than the shared
// dynamic tokens: this screen hands off from a native splash that is a
// fixed #F5F4F0 image, so it must not flip with the system scheme
// mid-dissolve. The app behind it is fully scheme-aware.
const INK = '#26292F';
const PAPER = '#F5F4F0';
const CARD = '#FFFFFF';
const META = '#666C74';
const HAIR = '#E8E9EC';
const ACCENT = '#B0674D';

export const SPEAK_LANGUAGE_DURATION_MS = 5070;

// The three pages, in the order the product actually happens.
const PAGES = [
  'Keep the moment, not just the link.',
  'Add your context — a note, or ninety seconds of your voice.',
  'Publish a page that keeps the source attached.',
] as const;

// Where each page settles on the clock. Tapping through seeks to the
// next one; past the last, it seeks to the primary action's entrance.
const PAGE_STOPS = [0, 2833, 3267] as const;
const CTA_STOP = 3800;

const lowerWash = require('../../assets/welcome/lower-wash.png');

function Wordmark({ size }: { size: number }) {
  return (
    <Text style={[styles.wordmark, { fontSize: size, lineHeight: size * 1.2, letterSpacing: size * -0.021 }]}>
      annotated<Text style={{ color: ACCENT }}>.</Text>
    </Text>
  );
}

type PageProps = {
  copy: string;
  index: 0 | 1 | 2;
  time: WelcomeTimeline['time'];
};

function OnboardingPage({ copy, index, time }: PageProps) {
  const animatedStyle = useAnimatedStyle(() => {
    let x = 0;
    let opacity = 1;
    if (index === 0) {
      const exit = Easing.inOut(Easing.cubic)(segment(time.value, 2833, 3100));
      x = interpolate(exit, [0, 1], [0, -REFERENCE_WIDTH]);
      opacity = 1 - segment(time.value, 3030, 3100);
    } else if (index === 1) {
      const enter = Easing.inOut(Easing.cubic)(segment(time.value, 2833, 3100));
      const exit = Easing.inOut(Easing.cubic)(segment(time.value, 3267, 3533));
      x = interpolate(enter, [0, 1], [REFERENCE_WIDTH, 0]) + interpolate(exit, [0, 1], [0, -REFERENCE_WIDTH]);
      opacity = Math.min(enter, 1 - segment(time.value, 3460, 3533));
    } else {
      const enter = Easing.inOut(Easing.cubic)(segment(time.value, 3267, 3533));
      x = interpolate(enter, [0, 1], [REFERENCE_WIDTH, 0]);
      opacity = enter;
    }
    return { opacity, transform: [{ translateX: x }] };
  });

  return (
    <Animated.View style={[styles.page, animatedStyle, { pointerEvents: 'none' }]}>
      <View style={styles.lockup}>
        <Wordmark size={40} />
      </View>
      <View style={styles.progressRow}>
        {[0, 1, 2].map((barIndex) => (
          <View
            key={barIndex}
            style={[styles.progressBar, barIndex <= index ? styles.progressBarActive : styles.progressBarInactive]}
          />
        ))}
      </View>
      <Text style={styles.headline}>{copy}</Text>
    </Animated.View>
  );
}

export function SpeakLanguageWelcome({
  autoplay = true,
  onActionPress,
  onPrimaryPress,
  onSecondaryPress,
  replayKey = 0,
}: WelcomeScreenProps) {
  const { time, seekTo } = useWelcomeTimeline(SPEAK_LANGUAGE_DURATION_MS, autoplay, replayKey);
  const contentReady = useInteractionGate({ autoplay, delayMs: 333, replayKey });
  const ctaReady = useInteractionGate({ autoplay, delayMs: 4400, replayKey });
  const tapExpired = useInteractionGate({ autoplay, delayMs: 3400, replayKey });

  const contentStyle = useAnimatedStyle(() => ({ opacity: segment(time.value, 300, 333) }));
  const splashStyle = useAnimatedStyle(() => ({
    opacity: 1 - Easing.out(Easing.cubic)(segment(time.value, 33, 200)),
  }));
  const loaderStyle = useAnimatedStyle(() => ({
    opacity: Math.min(segment(time.value, 80, 180), 1 - segment(time.value, 290, 333)),
  }));
  const tapStyle = useAnimatedStyle(() => ({ opacity: 1 - segment(time.value, 3200, 3400) }));
  const specimenStyle = useAnimatedStyle(() => {
    const rise = Easing.out(Easing.cubic)(segment(time.value, 600, 1000));
    return { opacity: rise, transform: [{ translateY: interpolate(rise, [0, 1], [16, 0]) }] };
  });
  const buttonStyle = useAnimatedStyle(() => ({
    opacity: Easing.inOut(Easing.quad)(segment(time.value, 3800, 4400)),
  }));

  // Tapping through advances the authored sequence rather than skipping
  // it: the clock lands on the next page's stop and keeps running.
  const advance = () => {
    const now = time.value;
    const next = PAGE_STOPS.find((stop) => stop > now + 1);
    seekTo(next ?? CTA_STOP);
    onActionPress?.('speak-language.tap-to-continue');
  };

  return (
    <ReferenceCanvas backgroundColor={CARD} testID="welcome-speak-language">
      <StatusBar animated={false} style="dark" />
      <Image contentFit="cover" source={lowerWash} style={styles.lowerWash} />

      <Animated.View style={[StyleSheet.absoluteFill, contentStyle]}>
        <GatedPressable
          accessibilityLabel="Sign in"
          disabled={!contentReady}
          onPress={resolveActionPress('speak-language.sign-in', onActionPress, onSecondaryPress)}
          style={styles.signIn}
        >
          <Text style={styles.signInText}>Sign in</Text>
        </GatedPressable>

        {PAGES.map((copy, index) => (
          <OnboardingPage key={copy} copy={copy} index={index as 0 | 1 | 2} time={time} />
        ))}

        {/* The product itself, in miniature: the thing all three pages are
            describing sits under them the whole time. It arrives once,
            after page one has landed, and stays put while the pages slide
            across above it. */}
        <Animated.View style={[styles.specimen, specimenStyle, { pointerEvents: 'none' }]}>
          <View style={styles.specimenHead}>
            <Text style={styles.specimenChip}>0:14–1:02</Text>
            <Text style={styles.specimenSource} numberOfLines={1}>Deep Dive into LLMs · youtube.com</Text>
          </View>
          <Text style={styles.specimenQuote} numberOfLines={2}>
            &ldquo;The model is not reasoning — it is recalling the shape of reasoning.&rdquo;
          </Text>
          <Text style={styles.specimenOpen}>Open original at 0:14 ↗</Text>
        </Animated.View>

        <Animated.View style={[styles.tap, tapStyle]}>
          <GatedPressable
            accessibilityLabel="Tap to continue"
            disabled={!contentReady || tapExpired}
            onPress={advance}
            style={styles.tapPressable}
          >
            <Text style={styles.tapText}>Tap to continue</Text>
          </GatedPressable>
        </Animated.View>

        <Animated.View style={[styles.ctaWrap, buttonStyle]}>
          <GatedPressable
            accessibilityLabel="Start keeping moments"
            disabled={!ctaReady}
            onPress={resolveActionPress('speak-language.start-speaking-today', onActionPress, onPrimaryPress)}
            style={styles.cta}
          >
            <Text style={styles.ctaText}>Start keeping moments</Text>
          </GatedPressable>
        </Animated.View>
      </Animated.View>

      <Animated.View style={[styles.loader, loaderStyle, { pointerEvents: 'none' }]}>
        <ActivityIndicator color={META} size="small" style={styles.loaderIndicator} />
      </Animated.View>

      {/* The launch page matches the native splash exactly, so the handoff
          from the OS splash into React is a dissolve, not a cut. */}
      <Animated.View style={[styles.splash, splashStyle, { pointerEvents: 'none' }]}>
        <View style={styles.splashWordmark}>
          <Wordmark size={42} />
        </View>
        <View style={styles.splashSpinner}>
          <ActivityIndicator color={META} size="small" />
        </View>
      </Animated.View>
    </ReferenceCanvas>
  );
}

export const SPEAK_LANGUAGE_METADATA = {
  id: 'speak-language' as const,
  displayName: 'Welcome',
  motionDurationMs: SPEAK_LANGUAGE_DURATION_MS,
};

const styles = StyleSheet.create({
  lowerWash: {
    ...box([0, 120, 640, 1265]),
    opacity: 0.85,
  },
  signIn: {
    ...box([471, 88, 115, 68]),
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  signInText: {
    color: INK,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 27,
    letterSpacing: -0.5,
  },
  page: { ...box([0, 0, 640, 920]) },
  wordmark: {
    color: INK,
    fontFamily: 'Inter_800ExtraBold',
  },
  lockup: {
    alignItems: 'center',
    flexDirection: 'row',
    height: 56,
    left: 53,
    position: 'absolute',
    top: 374,
  },
  progressRow: {
    ...box([54, 504, 162, 8]),
    flexDirection: 'row',
    gap: 15,
  },
  progressBar: { borderRadius: 99, height: 6, width: 44 },
  // Navigation state is ink; terracotta stays reserved for the moment.
  progressBarActive: { backgroundColor: INK },
  progressBarInactive: { backgroundColor: HAIR },
  headline: {
    ...box([48, 590, 520, 260]),
    color: INK,
    fontFamily: 'Inter_700Bold',
    fontSize: 44,
    letterSpacing: -1.6,
    lineHeight: 54,
  },
  specimen: {
    ...box([48, 880, 544, 216]),
    backgroundColor: CARD,
    borderColor: HAIR,
    borderRadius: 18,
    borderWidth: 1,
    padding: 22,
  },
  specimenHead: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  // The chip is a moment, so it wears the accent — the same law the feed
  // card, the permalink, and the panel all follow.
  specimenChip: {
    backgroundColor: 'rgba(176, 103, 77, 0.10)',
    borderRadius: 6,
    color: ACCENT,
    fontFamily: 'Inter_700Bold',
    fontSize: 19,
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  specimenSource: { color: META, flex: 1, fontFamily: 'Inter_400Regular', fontSize: 19 },
  specimenQuote: {
    color: INK,
    fontFamily: 'Georgia',
    fontSize: 23,
    fontStyle: 'italic',
    lineHeight: 32,
    marginTop: 16,
  },
  specimenOpen: { color: ACCENT, fontFamily: 'Inter_600SemiBold', fontSize: 18, marginTop: 14 },
  tap: { ...box([0, 1242, 640, 42]) },
  tapPressable: { height: 42, width: 640 },
  tapText: {
    color: META,
    fontFamily: 'Inter_400Regular',
    fontSize: 20,
    textAlign: 'center',
  },
  ctaWrap: { ...box([27, 1136, 587, 88]) },
  cta: {
    alignItems: 'center',
    backgroundColor: INK,
    borderRadius: 99,
    height: 88,
    justifyContent: 'center',
    width: 587,
  },
  ctaText: {
    color: PAPER,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 27,
    letterSpacing: -0.5,
  },
  loader: {
    ...box([299, 682, 42, 42]),
    alignItems: 'center',
    justifyContent: 'center',
  },
  loaderIndicator: { transform: [{ scale: 1.3 }] },
  splash: {
    ...box([0, 0, 640, 1385]),
    backgroundColor: PAPER,
  },
  splashWordmark: {
    ...box([0, 663, 640, 58]),
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashSpinner: {
    ...box([306, 760, 28, 28]),
    alignItems: 'center',
    justifyContent: 'center',
  },
});
