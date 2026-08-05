// Root navigation: a stack whose floor is the tab bar and whose pushed
// screens are web surfaces (permalinks, profiles, hubs) under a native
// header. Share-sheet arrivals and the cross-surface session epoch live
// here because they concern the whole app.

import { useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useShareIntent } from '../lib/share-intent';
import { SessionEpochContext } from '../components/WebScreen';
import { card, ink, paper } from '../lib/tokens';

export default function RootLayout() {
  const router = useRouter();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({ debug: false, resetOnBackground: true });

  // A share (cold start or while running) lands on the Capture tab; the web
  // capture desk extracts and resolves the URL itself. The nonce keeps a
  // repeat share of the same link from being ignored as a no-op.
  useEffect(() => {
    if (!hasShareIntent) return;
    const payload = (shareIntent.webUrl || shareIntent.text || '').trim();
    if (payload) router.navigate({ pathname: '/capture', params: { shared: payload, nonce: String(Date.now()) } });
    resetShareIntent();
  }, [hasShareIntent, shareIntent, resetShareIntent, router]);

  const [epoch, setEpoch] = useState(0);
  const session = useMemo(() => ({ epoch, bump: () => setEpoch((count) => count + 1) }), [epoch]);

  return (
    <SessionEpochContext.Provider value={session}>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: paper },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="web/[...path]"
          options={{
            headerShown: true,
            headerTintColor: ink,
            headerStyle: { backgroundColor: card },
            headerTitleStyle: { color: ink, fontWeight: '600' },
            headerBackButtonDisplayMode: 'minimal',
            animation: Platform.OS === 'ios' ? 'default' : 'slide_from_right',
          }}
        />
      </Stack>
    </SessionEpochContext.Provider>
  );
}
