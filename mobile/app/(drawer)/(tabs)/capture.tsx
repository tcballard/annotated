import { useLocalSearchParams } from 'expo-router';
import WebScreen from '../../../components/WebScreen';
import { ORIGIN } from '../../../lib/origin';
import { captureUrlFromShare, shellUrl } from '../../../lib/shell';

// The capture desk — the pen at the center of the tab bar, and where a
// share-sheet arrival lands. A share arrives as params; the nonce rides
// along in the URL so sharing the same link twice still reloads the desk
// (the web app strips unknown params when it takes over the address).
export default function CaptureTab() {
  const { shared, nonce } = useLocalSearchParams<{ shared?: string; nonce?: string }>();
  const sharedUri = typeof shared === 'string' ? captureUrlFromShare(ORIGIN, { text: shared }) : null;
  const uri = sharedUri ? `${sharedUri}&nonce=${encodeURIComponent(typeof nonce === 'string' ? nonce : '')}` : shellUrl(ORIGIN, '/capture');
  return <WebScreen uri={uri} padTop={false} />;
}
