import WebScreen from '../../components/WebScreen';
import { ORIGIN } from '../../lib/origin';
import { shellUrl } from '../../lib/shell';

export default function LibraryTab() {
  return <WebScreen uri={shellUrl(ORIGIN, '/library')} />;
}
