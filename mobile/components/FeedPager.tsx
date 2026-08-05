// The feed pager: swiping left/right moves between feeds, X-style, with
// the menu pill tracking. Native only — the react-native-web preview uses
// the .web fallback (taps still switch).

import { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import PagerView from 'react-native-pager-view';

type Props = {
  index: number;
  onSelect: (index: number) => void;
  children: React.ReactNode;
};

export default function FeedPager({ index, onSelect, children }: Props) {
  const pagerRef = useRef<PagerView>(null);
  const current = useRef(index);

  // Menu taps drive the pager; swipes drive the menu. The ref comparison
  // keeps the two from echoing each other.
  useEffect(() => {
    if (current.current !== index) pagerRef.current?.setPage(index);
  }, [index]);

  return (
    <PagerView
      ref={pagerRef}
      style={styles.pager}
      initialPage={index}
      offscreenPageLimit={1}
      onPageSelected={(event) => {
        const position = event.nativeEvent.position;
        if (current.current === position) return;
        current.current = position;
        onSelect(position);
      }}
    >
      {children}
    </PagerView>
  );
}

const styles = StyleSheet.create({
  pager: { flex: 1 },
});
