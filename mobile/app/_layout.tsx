// Root navigation: a stack whose floor is the drawer-wrapped tab bar and
// whose pushed screens are the capture desk and web surfaces (permalinks,
// profiles, hubs) under native headers. Share-sheet arrivals, the session
// epoch, and the signed-in account live here because they concern the
// whole app.

import { useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useShareIntent } from '../lib/share-intent';
import { SessionEpochContext } from '../components/WebScreen';
import { AccountContext, type Me } from '../components/AccountContext';
import { api } from '../lib/api';
import { card, ink, paper } from '../lib/tokens';

export default function RootLayout() {
  const router = useRouter();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({ debug: false, resetOnBackground: true });

  // A share (cold start or while running) lands on the capture desk; the
  // web app extracts and resolves the URL itself. The nonce keeps a repeat
  // share of the same link from being ignored as a no-op.
  useEffect(() => {
    if (!hasShareIntent) return;
    const payload = (shareIntent.webUrl || shareIntent.text || '').trim();
    if (payload) router.navigate({ pathname: '/capture', params: { shared: payload, nonce: String(Date.now()) } });
    resetShareIntent();
  }, [hasShareIntent, shareIntent, resetShareIntent, router]);

  const [epoch, setEpoch] = useState(0);
  const session = useMemo(() => ({ epoch, bump: () => setEpoch((count) => count + 1) }), [epoch]);

  // The signed-in account and its unseen-notifications badge, refreshed on
  // every session change.
  const [me, setMe] = useState<Me>(null);
  const [unseen, setUnseen] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await api.me().catch(() => ({ user: null }));
      if (cancelled) return;
      setMe(result.user || null);
      if (!result.user) { setUnseen(0); return; }
      const inbox = await api.notifications().catch(() => ({ unseenCount: 0 }));
      if (!cancelled) setUnseen(Number(inbox.unseenCount) || 0);
    })();
    return () => { cancelled = true; };
  }, [epoch]);
  const account = useMemo(() => ({ me, unseen, clearUnseen: () => setUnseen(0) }), [me, unseen]);

  const webHeader = {
    headerShown: true,
    headerTintColor: ink,
    headerStyle: { backgroundColor: card },
    headerTitleStyle: { color: ink, fontWeight: '600' as const },
    headerBackButtonDisplayMode: 'minimal' as const,
    animation: Platform.OS === 'ios' ? ('default' as const) : ('slide_from_right' as const),
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SessionEpochContext.Provider value={session}>
        <AccountContext.Provider value={account}>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: paper } }}>
            <Stack.Screen name="(drawer)" />
            <Stack.Screen name="capture" options={{ ...webHeader, title: 'Capture' }} />
            <Stack.Screen name="web/[...path]" options={webHeader} />
          </Stack>
        </AccountContext.Provider>
      </SessionEpochContext.Provider>
    </GestureHandlerRootView>
  );
}
