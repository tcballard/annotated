// Web preview fallback: react-native-pager-view has no DOM implementation,
// so the browser shows the active feed only — menu taps still switch.

import { View } from 'react-native';

type Props = {
  index: number;
  onSelect: (index: number) => void;
  children: React.ReactNode;
};

export default function FeedPager({ index, children }: Props) {
  const pages = Array.isArray(children) ? children : [children];
  return <View style={{ flex: 1 }}>{pages[index] ?? null}</View>;
}
