// Settings: the account and the app's own facts, one screen. Everything
// here is either an action the app can honestly take or a number it can
// honestly report — no toggles that pretend to control the platform.

import { use, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Icon, { type ProductIconName } from '../components/Icon';
import { AccountContext } from '../components/AccountContext';
import { AuthProviderContext } from '../components/AuthProviderContext';
import { SessionEpochContext } from '../components/WebScreen';
import { ExploreSettingsContext } from '../components/ExploreSettings';
import { api } from '../lib/api';
import { ORIGIN } from '../lib/origin';
import { card, ink, meta, paper, tokens } from '../lib/tokens';

export default function SettingsScreen() {
  const router = useRouter();
  const { me } = use(AccountContext);
  const { bump } = use(SessionEpochContext);
  const { signIn } = use(AuthProviderContext);
  const { hideDemo, setHideDemo } = use(ExploreSettingsContext);
  const [busy, setBusy] = useState(false);
  const tick = () => { if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync(); };

  const row = (iconName: ProductIconName, label: string, value: string, onPress?: () => void) => (
    <Pressable
      key={label}
      disabled={!onPress}
      onPress={() => { tick(); onPress?.(); }}
      style={({ pressed }) => [styles.row, pressed && onPress ? styles.rowPressed : null]}
    >
      <Icon name={iconName} size={19} color={meta} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>{value}</Text>
      {onPress ? <Icon name="chevron-right" size={17} color={tokens['ink-soft']} /> : null}
    </Pressable>
  );

  return (
    <ScrollView style={styles.frame} contentContainerStyle={styles.body} contentInsetAdjustmentBehavior="automatic">
      <Text style={styles.section}>Account</Text>
      <View style={styles.group}>
        {me
          ? row('user', 'Signed in as', `@${me.handle}`, () => router.push(`/web/u/${encodeURIComponent(me.handle || '')}` as never))
          : row('user', 'Account', 'Signed out', async () => { if (await signIn()) bump(); })}
        {me ? row('bookmark', 'Your library', 'Open', () => router.push('/web/library' as never)) : null}
      </View>

      <Text style={styles.section}>Reading</Text>
      <View style={styles.group}>
        <View style={styles.row}>
          <Icon name="search" size={19} color={meta} />
          <Text style={styles.rowLabel}>Hide demo accounts</Text>
          <Switch
            value={hideDemo}
            onValueChange={(next) => { tick(); setHideDemo(next); }}
            trackColor={{ true: tokens.chrome, false: tokens.border }}
          />
        </View>
        <Text style={styles.note}>This build ships seeded demo annotations so the feed is never empty. Hiding them shows only real activity. The choice lasts for this session.</Text>
      </View>

      <Text style={styles.section}>Notifications</Text>
      <View style={styles.group}>
        {row('bell', 'System notifications', 'Open settings', () => { void Linking.openSettings().catch(() => {}); })}
      </View>

      <Text style={styles.section}>About this build</Text>
      <View style={styles.group}>
        {row('info', 'Version', String(Constants.expoConfig?.version || '—'))}
        {row('link', 'Backend', ORIGIN.replace(/^https?:\/\//, ''))}
        {row('file-text', 'Terms', 'Read', () => router.push('/web/terms' as never))}
        {row('shield', 'Privacy', 'Read', () => { void Linking.openURL(`${ORIGIN}/privacy.html`).catch(() => {}); })}
        {row('help-circle', 'Help centre', 'Open', () => router.push('/web/help' as never))}
      </View>

      {me ? (
        <Pressable
          style={({ pressed }) => [styles.signOut, pressed && styles.rowPressed]}
          disabled={busy}
          onPress={async () => {
            tick();
            setBusy(true);
            await api.logout().catch(() => {});
            bump();
            setBusy(false);
            router.back();
          }}
        >
          <Icon name="log-out" size={18} color={meta} />
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: paper },
  body: { padding: 14, paddingBottom: 32, gap: 4 },
  section: { color: meta, fontSize: 12, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase', marginTop: 14, marginBottom: 6, marginLeft: 4 },
  group: { backgroundColor: card, borderRadius: 14, borderCurve: 'continuous', overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, minHeight: 52 },
  rowPressed: { backgroundColor: tokens.soft },
  rowLabel: { color: ink, fontSize: 15, fontWeight: '600', flex: 1 },
  rowValue: { color: meta, fontSize: 13.5, maxWidth: 170 },
  note: { color: meta, fontSize: 12.5, lineHeight: 17, paddingHorizontal: 14, paddingBottom: 12 },
  signOut: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 22, minHeight: 48, backgroundColor: card, borderRadius: 14, borderCurve: 'continuous' },
  signOutText: { color: meta, fontSize: 15, fontWeight: '700' },
});
