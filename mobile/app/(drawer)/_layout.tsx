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
        // rounded on its open edge, lifted by a soft ink shadow, over the
        // same ink scrim the web's modals use. The shadow lives here on the
        // container — the panel clips its own content to the same radii,
        // because overflow clipping on this view would swallow the shadow.
        drawerStyle: {
          backgroundColor: card,
          width: 304,
          borderTopRightRadius: 24,
          borderBottomRightRadius: 24,
          shadowColor: '#26292F',
          shadowOpacity: 0.25,
          shadowRadius: 24,
          shadowOffset: { width: 6, height: 0 },
          elevation: 16,
        },
        overlayColor: 'rgba(38, 41, 47, 0.45)',
        sceneStyle: { backgroundColor: paper },
      }}
    >
      <Drawer.Screen name="(tabs)" />
    </Drawer>
  );
}
