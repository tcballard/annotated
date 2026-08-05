import WebScreen, { ORIGIN } from '../components/WebScreen';
import { shellUrl } from '../lib/shell';

export default function LibraryTab() {
  return <WebScreen uri={shellUrl(ORIGIN, '/library')} />;
}
