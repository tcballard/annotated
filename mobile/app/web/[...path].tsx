// Any internal web surface, pushed over the tabs under a native header:
// annotation permalinks (/a/…), profiles (/u/…), source hubs (/s/…). The
// native timeline links here; the page itself stays the deployed web app
// in shell mode.

import { Stack, useLocalSearchParams } from 'expo-router';
import WebScreen from '../../components/WebScreen';
import { ORIGIN } from '../../lib/origin';
import { shellUrl } from '../../lib/shell';

const PAGE_TITLES: Record<string, string> = {
  library: 'Library',
  moderation: 'Moderation',
  transparency: 'Transparency',
  about: 'About',
  rights: 'Rights & claims',
  terms: 'Terms',
};

const titleFor = (segments: string[]): string => {
  if (segments[0] === 'a') return 'Annotation';
  if (segments[0] === 'u' && segments[1]) return `@${decodeURIComponent(segments[1])}`;
  if (segments[0] === 's' && segments[1]) return decodeURIComponent(segments[1]);
  return PAGE_TITLES[segments[0]] || 'annotated';
};

export default function WebPage() {
  const { path } = useLocalSearchParams<{ path: string[] | string }>();
  const segments = (Array.isArray(path) ? path : [path || '']).filter(Boolean);
  const target = `/${segments.join('/')}`;
  return (
    <>
      <Stack.Screen options={{ title: titleFor(segments) }} />
      <WebScreen uri={shellUrl(ORIGIN, target)} padTop={false} />
    </>
  );
}
