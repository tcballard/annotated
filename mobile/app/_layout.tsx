// Native chrome, web surfaces. The tab bar, haptics, safe areas, and
// share-sheet routing are native (expo-router); each tab hosts one deployed
// web surface in shell mode, so navigation is never drawn twice.

import { useEffect, useMemo, useState } from 'react';
import { Tabs, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import Feather from '@expo/vector-icons/Feather';
import { useShareIntent } from 'expo-share-intent';
import { SessionEpochContext } from '../components/WebScreen';
import { card, ink, meta, paper, tokens } from '../lib/tokens';

export default function Layout() {
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
      <Tabs
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: paper },
          tabBarActiveTintColor: ink,
          tabBarInactiveTintColor: meta,
          tabBarStyle: { backgroundColor: card, borderTopColor: tokens.hair },
        }}
        screenListeners={{
          tabPress: () => { void Haptics.selectionAsync(); },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{ title: 'Timeline', tabBarIcon: ({ color, size }) => <Feather name="list" color={color} size={size} /> }}
        />
        <Tabs.Screen
          name="capture"
          options={{ title: 'Capture', tabBarIcon: ({ color, size }) => <Feather name="plus-square" color={color} size={size} /> }}
        />
        <Tabs.Screen
          name="library"
          options={{ title: 'Library', tabBarIcon: ({ color, size }) => <Feather name="bookmark" color={color} size={size} /> }}
        />
      </Tabs>
    </SessionEpochContext.Provider>
  );
}
