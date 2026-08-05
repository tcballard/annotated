// The annotated mobile shell: the deployed web app in a WebView, plus the
// two things the web cannot do alone on a phone — receive the native share
// sheet (expo-share-intent: iOS share extension + Android intent filter)
// and run OAuth through the system browser (WebViews are refused by
// Google), returning via annotated://auth with a one-time ticket.

import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Platform, SafeAreaView, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { WebView } from 'react-native-webview';
import { useShareIntent } from 'expo-share-intent';
import {
  captureUrlFromShare,
  isInternalNavigation,
  isOauthStartUrl,
  sessionExchangeUrl,
  ticketFromCallback,
  withMobileReturn,
} from './lib/shell';

const ORIGIN = (Constants.expoConfig?.extra?.origin as string | undefined)
  ?? 'https://annotated-staging.up.railway.app';

export default function App() {
  const webViewRef = useRef<WebView>(null);
  const [source, setSource] = useState({ uri: ORIGIN });
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({ debug: false, resetOnBackground: true });

  // A share (cold start or while running) lands on the capture desk with the
  // shared link resolved by the web app itself.
  useEffect(() => {
    if (!hasShareIntent) return;
    const captureUrl = captureUrlFromShare(ORIGIN, { webUrl: shareIntent.webUrl, text: shareIntent.text });
    if (captureUrl) setSource({ uri: captureUrl });
    resetShareIntent();
  }, [hasShareIntent, shareIntent, resetShareIntent]);

  // Android hardware back walks WebView history before leaving the app.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      webViewRef.current?.goBack();
      return true;
    });
    return () => subscription.remove();
  }, []);

  const signInThroughSystemBrowser = useCallback(async (startUrl: string) => {
    const result = await WebBrowser.openAuthSessionAsync(withMobileReturn(startUrl), 'annotated://auth');
    const ticket = ticketFromCallback(result.type === 'success' ? result.url : null);
    if (ticket) setSource({ uri: sessionExchangeUrl(ORIGIN, ticket) });
  }, []);

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
    <SafeAreaView style={styles.frame}>
      <StatusBar style="light" />
      <WebView
        ref={webViewRef}
        source={source}
        style={styles.web}
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        allowsBackForwardNavigationGestures
        sharedCookiesEnabled
        domStorageEnabled
        mediaPlaybackRequiresUserAction={false}
        pullToRefreshEnabled
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: '#33383F' },
  web: { flex: 1, backgroundColor: '#F5F4F0' },
});
