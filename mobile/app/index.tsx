import WebScreen, { ORIGIN } from '../components/WebScreen';
import { shellUrl } from '../lib/shell';

export default function TimelineTab() {
  return <WebScreen uri={shellUrl(ORIGIN, '/')} />;
}
