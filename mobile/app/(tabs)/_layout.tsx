// The tab bar: native chrome painted with the web's own tokens. Timeline
// is a fully native screen; Capture and Library host web surfaces in
// shell mode — navigation is never drawn twice.

import { Tabs } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Feather from '@expo/vector-icons/Feather';
import { card, ink, meta, paper, tokens } from '../../lib/tokens';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: paper },
        tabBarActiveTintColor: ink,
        tabBarInactiveTintColor: meta,
        tabBarStyle: { backgroundColor: card, borderTopColor: tokens.hair },
      }}
      screenListeners={{
        tabPress: () => { void Haptics.selectionAsync(); },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Timeline', tabBarIcon: ({ color, size }) => <Feather name="list" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="capture"
        options={{ title: 'Capture', tabBarIcon: ({ color, size }) => <Feather name="plus-square" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="library"
        options={{ title: 'Library', tabBarIcon: ({ color, size }) => <Feather name="bookmark" color={color} size={size} /> }}
      />
    </Tabs>
  );
}
