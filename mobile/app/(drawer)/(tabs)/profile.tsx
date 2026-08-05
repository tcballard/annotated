import { useContext } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import WebScreen, { SessionEpochContext } from '../../../components/WebScreen';
import { AccountContext } from '../../../components/AccountContext';
import { ORIGIN } from '../../../lib/origin';
import { shellUrl } from '../../../lib/shell';
import { signInNatively } from '../../../lib/native-auth';
import { card, ink, meta, tokens } from '../../../lib/tokens';

// Your public profile — the same shell-mode web surface readers see.
// Signed out, this tab is the app's front door to sign-in.
export default function ProfileTab() {
  const { me } = useContext(AccountContext);
  const { bump } = useContext(SessionEpochContext);
  if (me?.handle) return <WebScreen uri={shellUrl(ORIGIN, `/u/${encodeURIComponent(me.handle)}`)} padTop={false} />;
  return (
    <View style={styles.frame}>
      <View style={styles.cardBox}>
        <Text style={styles.title}>Your profile is waiting.</Text>
        <Text style={styles.body}>Sign in to publish, follow, and keep your library.</Text>
        <Pressable style={styles.signIn} onPress={async () => { if (await signInNatively()) bump(); }}>
          <Text style={styles.signInText}>Sign in</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, padding: 14 },
  cardBox: { backgroundColor: card, borderRadius: 18, padding: 22, alignItems: 'center' },
  title: { color: ink, fontWeight: '700', fontSize: 16 },
  body: { color: meta, fontSize: 13.5, marginTop: 6, textAlign: 'center', lineHeight: 19 },
  signIn: { marginTop: 14, backgroundColor: tokens.chrome, borderRadius: 99, paddingVertical: 10, paddingHorizontal: 26 },
  signInText: { color: '#fff', fontWeight: '700', fontSize: 14.5 },
});
