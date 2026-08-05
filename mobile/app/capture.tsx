import { useLocalSearchParams } from 'expo-router';
import WebScreen from '../components/WebScreen';
import { ORIGIN } from '../lib/origin';
import { captureUrlFromShare, shellUrl } from '../lib/shell';

// The capture desk, pushed over the tabs from the FAB or a share-sheet
// arrival. A share lands as params; the nonce rides along in the URL so
// sharing the same link twice still reloads the desk (the web app strips
// unknown params when it takes over the address).
export default function CaptureScreen() {
  const { shared, nonce } = useLocalSearchParams<{ shared?: string; nonce?: string }>();
  const sharedUri = typeof shared === 'string' ? captureUrlFromShare(ORIGIN, { text: shared }) : null;
  const uri = sharedUri ? `${sharedUri}&nonce=${encodeURIComponent(typeof nonce === 'string' ? nonce : '')}` : shellUrl(ORIGIN, '/capture');
  return <WebScreen uri={uri} padTop={false} />;
}
