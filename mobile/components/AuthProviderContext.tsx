// The native sign-in door. Provider choice stays inside the app so the
// official marks, button hierarchy, and legal boundary match the web and
// extension before the system browser takes over for OAuth.

import { createContext, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { enabledProviders, providerLabel } from '../lib/core/auth-ui';
import { api } from '../lib/api';
import { signInWithProvider } from '../lib/native-auth';
import { ORIGIN } from '../lib/origin';
import { card, ink, meta, tokens } from '../lib/tokens';

type AuthDoor = { signIn: () => Promise<boolean> };

export const AuthProviderContext = createContext<AuthDoor>({ signIn: async () => false });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [providers, setProviders] = useState<string[]>([]);
  const [busyProvider, setBusyProvider] = useState('');
  const [message, setMessage] = useState('');
  const resolver = useRef<((result: boolean) => void) | null>(null);

  const finish = useCallback((result: boolean) => {
    setVisible(false);
    setBusyProvider('');
    setMessage('');
    resolver.current?.(result);
    resolver.current = null;
  }, []);

  useEffect(() => () => resolver.current?.(false), []);

  const signIn = useCallback(async (): Promise<boolean> => {
    if (resolver.current) return false;
    const result = await api.providers().catch(() => ({ providers: {} }));
    const available = enabledProviders(result.providers);
    setProviders(available);
    setMessage(available.length ? '' : 'Sign-in is not configured on this backend.');
    setVisible(true);
    return new Promise((resolve) => { resolver.current = resolve; });
  }, []);

  const choose = async (provider: string) => {
    if (busyProvider) return;
    setBusyProvider(provider);
    setMessage('');
    try {
      if (await signInWithProvider(provider)) { finish(true); return; }
      setMessage('Sign-in did not complete. You can try again.');
    } catch (error: any) {
      setMessage(error?.message || 'Sign-in failed. Please try again.');
    } finally {
      setBusyProvider('');
    }
  };

  const value = useMemo(() => ({ signIn }), [signIn]);

  return (
    <AuthProviderContext.Provider value={value}>
      {children}
      <Modal transparent visible={visible} animationType="fade" onRequestClose={() => { if (!busyProvider) finish(false); }}>
        <Pressable style={styles.veil} onPress={() => { if (!busyProvider) finish(false); }}>
          <Pressable style={styles.modal} onPress={() => {}} accessibilityViewIsModal>
            <Text style={styles.title}>Add your name to the margin<Text style={styles.dot}>.</Text></Text>
            <Text style={styles.subtitle}>One account across the extension, the web, and the app.</Text>

            {providers.map((provider) => {
              const isX = provider === 'x';
              const busy = busyProvider === provider;
              return (
                <Pressable
                  key={provider}
                  accessibilityRole="button"
                  accessibilityLabel={`Continue with ${providerLabel(provider)}`}
                  disabled={Boolean(busyProvider)}
                  onPress={() => { void choose(provider); }}
                  style={({ pressed }) => [styles.provider, isX ? styles.xProvider : styles.googleProvider, pressed && styles.pressed, Boolean(busyProvider) && !busy && styles.dimmed]}
                >
                  <Image
                    source={isX ? require('../assets/providers/x.png') : require('../assets/providers/google.png')}
                    style={isX ? styles.xMark : styles.googleMark}
                    resizeMode="contain"
                  />
                  <Text style={[styles.providerText, isX && styles.xText]}>Continue with {providerLabel(provider)}</Text>
                  {busy ? <ActivityIndicator style={styles.spinner} color={isX ? '#fff' : '#1f1f1f'} /> : null}
                </Pressable>
              );
            })}

            {message ? <Text style={styles.message} accessibilityRole="alert">{message}</Text> : null}
            {providers.length ? (
              <Text style={styles.legal}>
                By continuing, you agree to the{' '}
                <Text style={styles.legalLink} onPress={() => { void Linking.openURL(`${ORIGIN}/terms`); }}>Terms</Text>
                {' '}and{' '}
                <Text style={styles.legalLink} onPress={() => { void Linking.openURL(`${ORIGIN}/privacy.html`); }}>Privacy Policy</Text>.
              </Text>
            ) : null}
            <Pressable disabled={Boolean(busyProvider)} onPress={() => finish(false)} hitSlop={8} style={styles.cancel}>
              <Text style={styles.cancelText}>Not now</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </AuthProviderContext.Provider>
  );
}

const styles = StyleSheet.create({
  veil: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: 'rgba(38, 41, 47, 0.48)' },
  modal: { width: '100%', maxWidth: 360, gap: 10, paddingHorizontal: 18, paddingTop: 22, paddingBottom: 14, borderRadius: 18, backgroundColor: card },
  title: { color: ink, fontSize: 18, fontWeight: '700' },
  dot: { color: tokens.accent },
  subtitle: { color: meta, fontSize: 13, lineHeight: 18, marginBottom: 4 },
  provider: { position: 'relative', minHeight: 52, borderRadius: 26, borderWidth: 1, paddingHorizontal: 50, alignItems: 'center', justifyContent: 'center' },
  googleProvider: { backgroundColor: '#fff', borderColor: '#747775' },
  xProvider: { backgroundColor: '#0f1419', borderColor: '#0f1419' },
  pressed: { opacity: 0.88, transform: [{ scale: 0.995 }] },
  dimmed: { opacity: 0.5 },
  googleMark: { position: 'absolute', left: 16, width: 26, height: 26 },
  xMark: { position: 'absolute', left: 18, width: 21, height: 21 },
  providerText: { color: '#1f1f1f', fontSize: 15, lineHeight: 20, fontWeight: '600' },
  xText: { color: '#fff' },
  spinner: { position: 'absolute', right: 17 },
  message: { color: tokens['accent-ink'], fontSize: 12.5, lineHeight: 18, textAlign: 'center' },
  legal: { color: meta, fontSize: 11.5, lineHeight: 17, textAlign: 'center', paddingHorizontal: 8, paddingTop: 2 },
  legalLink: { color: ink, textDecorationLine: 'underline', textDecorationColor: ink },
  cancel: { alignSelf: 'center', minHeight: 36, justifyContent: 'center', paddingHorizontal: 10 },
  cancelText: { color: meta, fontSize: 12.5 },
});
