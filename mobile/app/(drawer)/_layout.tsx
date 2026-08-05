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
        drawerStyle: { backgroundColor: card, width: 300 },
        sceneStyle: { backgroundColor: paper },
      }}
    >
      <Drawer.Screen name="(tabs)" />
    </Drawer>
  );
}
