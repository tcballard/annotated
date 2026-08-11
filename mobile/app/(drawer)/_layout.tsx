// The drawer wraps the tab bar, X-style: swipe right from the left edge —
// or tap your avatar in the header — for account, library, and the
// product's public pages.

import { Drawer } from 'expo-router/drawer';
import DrawerPanel from '../../components/DrawerPanel';
import { card, paper } from '../../lib/tokens';

export default function DrawerLayout() {
  return (
    <Drawer
      drawerContent={(props) => <DrawerPanel {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: 'front',
        swipeEdgeWidth: 90,
        // The panel is a card over the timeline, not a full-bleed sheet:
        // rounded on its open edge with Apple's continuous curve, lifted by
        // a soft ink boxShadow (the modern cross-platform shadow — never the
        // legacy shadow*/elevation props), over the same ink scrim the web's
        // modals use. The shadow lives here on the container — the panel
        // clips its own content to the same radii, because overflow clipping
        // on this view would swallow the shadow.
        drawerStyle: {
          backgroundColor: card,
          width: 304,
          borderTopRightRadius: 24,
          borderBottomRightRadius: 24,
          borderCurve: 'continuous',
          boxShadow: '6px 0 24px rgba(38, 41, 47, 0.25)',
        },
        overlayColor: 'rgba(38, 41, 47, 0.45)',
        sceneStyle: { backgroundColor: paper },
      }}
    >
      <Drawer.Screen name="(tabs)" />
    </Drawer>
  );
}
