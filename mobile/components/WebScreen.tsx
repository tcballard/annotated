// One web surface inside the native chrome. Each host screen loads the
// deployed app in shell mode (content only — native chrome does the
// navigation) and keeps the jobs the web cannot do alone on a phone:
// OAuth through the system browser (WebViews are refused by Google),
// returning via annotated://auth with a one-time ticket, and opening
// originals OUT.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Platform, StyleSheet, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import {
  isInternalNavigation,
  isOauthStartUrl,
  sessionExchangeUrl,
  ticketFromCallback,
  withMobileReturn,
} from '../lib/shell';
import { ORIGIN } from '../lib/origin';
import { ink, paper } from '../lib/tokens';

export { ORIGIN };

// Sign-in happens on one surface, but the cookie session belongs to all of
// them: a bump tells every other mounted surface to reload as that user.
export const SessionEpochContext = createContext<{ epoch: number; bump: () => void }>({
  epoch: 0,
  bump: () => {},
});

// padTop is off for screens pushed under a native header, which already
// covers the status-bar inset.
export default function WebScreen({ uri, padTop = true }: { uri: string; padTop?: boolean }) {
  const webViewRef = useRef<WebView>(null);
  const [source, setSource] = useState({ uri });
  useEffect(() => setSource({ uri }), [uri]);

  const { epoch, bump } = useContext(SessionEpochContext);
  const focusedRef = useRef(false);
  const canGoBackRef = useRef(false);

  // Android hardware back walks this surface's history before leaving;
  // only the focused screen listens.
  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    const subscription = Platform.OS === 'android'
      ? BackHandler.addEventListener('hardwareBackPress', () => {
        if (!canGoBackRef.current) return false;
        webViewRef.current?.goBack();
        return true;
      })
      : null;
    return () => {
      focusedRef.current = false;
      subscription?.remove();
    };
  }, []));

  // The surface that ran the ticket exchange is already navigating to the
  // session URL; every other mounted one reloads to pick up the cookie.
  const seenEpoch = useRef(epoch);
  useEffect(() => {
    if (epoch === seenEpoch.current) return;
    seenEpoch.current = epoch;
    if (!focusedRef.current) webViewRef.current?.reload();
  }, [epoch]);

  const signInThroughSystemBrowser = useCallback(async (startUrl: string) => {
    const result = await WebBrowser.openAuthSessionAsync(withMobileReturn(startUrl), 'annotated://auth');
    const ticket = ticketFromCallback(result.type === 'success' ? result.url : null);
    if (!ticket) return;
    const home = new URL(uri);
    setSource({ uri: sessionExchangeUrl(ORIGIN, ticket, `${home.pathname}${home.search}`) });
    bump();
  }, [uri, bump]);

  const onShouldStartLoadWithRequest = useCallback((request: { url: string }) => {
    if (isOauthStartUrl(request.url, ORIGIN)) {
      void signInThroughSystemBrowser(request.url);
      return false;
    }
    if (!isInternalNavigation(request.url, ORIGIN)) {
      // Originals open OUT — that is the product.
      void WebBrowser.openBrowserAsync(request.url);
      return false;
    }
    return true;
  }, [signInThroughSystemBrowser]);

  return (
    <SafeAreaView edges={padTop ? ['top'] : []} style={styles.frame}>
      <WebView
        ref={webViewRef}
        source={source}
        style={styles.web}
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        onNavigationStateChange={(navState) => { canGoBackRef.current = navState.canGoBack; }}
        startInLoadingState
        renderLoading={() => (
          <View style={styles.loading}>
            <ActivityIndicator color={ink} />
          </View>
        )}
        allowsBackForwardNavigationGestures
        allowsInlineMediaPlayback
        sharedCookiesEnabled
        domStorageEnabled
        mediaPlaybackRequiresUserAction={false}
        pullToRefreshEnabled
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: paper },
  web: { flex: 1, backgroundColor: paper },
  loading: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: paper },
});
