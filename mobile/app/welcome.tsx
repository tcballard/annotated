// The welcome route: a full-bleed surface with no header and no
// safe-area padding — the component owns its calibrated canvas and the
// status bar. Every semantic action is wired here, so the composition
// stays ignorant of routing and auth.

import { useContext, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SpeakLanguageWelcome } from '../components/welcome/speak-language';
import type { WelcomeActionId } from '../components/welcome/types';
import { SessionEpochContext } from '../components/WebScreen';
import { AuthProviderContext } from '../components/AuthProviderContext';

export default function WelcomeRoute() {
  const router = useRouter();
  const { bump } = useContext(SessionEpochContext);
  const { signIn: openSignIn } = useContext(AuthProviderContext);
  const [busy, setBusy] = useState(false);

  const enterApp = () => router.replace('/(drawer)/(tabs)');

  const signIn = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (await openSignIn()) bump();
    } finally {
      setBusy(false);
    }
    // Signed in or not, the welcome has done its job: the margin is
    // readable signed out, and the door stays one tap away inside.
    enterApp();
  };

  const onActionPress = (actionId: WelcomeActionId) => {
    if (actionId === 'speak-language.sign-in') { void signIn(); return; }
    if (actionId === 'speak-language.start-speaking-today') { void signIn(); return; }
    // tap-to-continue advances the sequence inside the component; nothing
    // to route, but it stays wired so the host can observe the step.
  };

  return (
    <View style={styles.surface}>
      <SpeakLanguageWelcome onActionPress={onActionPress} />
    </View>
  );
}

const styles = StyleSheet.create({
  surface: { flex: 1 },
});
