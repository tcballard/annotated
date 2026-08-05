import { useLocalSearchParams } from 'expo-router';
import WebScreen, { ORIGIN } from '../components/WebScreen';
import { captureUrlFromShare, shellUrl } from '../lib/shell';

export default function CaptureTab() {
  // A share-sheet launch arrives as params from the layout; the nonce rides
  // along in the URL so sharing the same link twice still reloads the desk
  // (the web app strips unknown params when it takes over the address).
  const { shared, nonce } = useLocalSearchParams<{ shared?: string; nonce?: string }>();
  const sharedUri = typeof shared === 'string' ? captureUrlFromShare(ORIGIN, { text: shared }) : null;
  const uri = sharedUri ? `${sharedUri}&nonce=${encodeURIComponent(typeof nonce === 'string' ? nonce : '')}` : shellUrl(ORIGIN, '/capture');
  return <WebScreen uri={uri} />;
}
