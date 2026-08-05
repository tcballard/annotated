// Web preview of a hosted surface: react-native-webview has no browser
// implementation, so the preview embeds the shell-mode page in an iframe.
// Native devices use WebScreen.tsx; the exported contract stays identical.

import { createContext } from 'react';
import { StyleSheet, View } from 'react-native';
import { ORIGIN } from '../lib/origin';
import { paper } from '../lib/tokens';

export { ORIGIN };

export const SessionEpochContext = createContext<{ epoch: number; bump: () => void }>({
  epoch: 0,
  bump: () => {},
});

export default function WebScreen({ uri }: { uri: string; padTop?: boolean }) {
  return (
    <View style={styles.frame}>
      <iframe src={uri} style={{ border: 0, width: '100%', height: '100%', backgroundColor: paper }} title="annotated" />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: paper },
});
