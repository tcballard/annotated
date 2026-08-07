// The X anatomy in annotated's identity: your avatar top-left opens the
// drawer, the wordmark sits center, and five quiet tabs live in a floating
// pill along the bottom — Home · Search · Capture (the pen, center) ·
// Notifications · Profile. The bar is padded off the screen edges above
// the home indicator, Substack-style — the same floating-pill language as
// the web's mobile dock — and the feeds scroll behind it.

import { useContext, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Tabs } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Feather from '@expo/vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import HeaderAvatar from '../../../components/HeaderAvatar';
import CaptureSheet from '../../../components/CaptureSheet';
import { AccountContext } from '../../../components/AccountContext';
import { card, ink, meta, paper, tokens } from '../../../lib/tokens';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { unseen } = useContext(AccountContext);
  // The pen is not a destination: it summons the capture sheet over
  // whatever you were reading, X-compose style.
  const [captureOpen, setCaptureOpen] = useState(false);
  // The bar is flat and full-width, X-style: card surface, one hairline,
  // icons over the home indicator. No pill, no shadow, no float.
  const webSceneStyle = { backgroundColor: paper };
  return (
    <>
    <Tabs
      screenOptions={{
        headerShown: true,
        headerLeft: () => <HeaderAvatar />,
        headerStyle: { backgroundColor: card },
        headerShadowVisible: false,
        headerTitleAlign: 'center',
        sceneStyle: { backgroundColor: paper },
        tabBarActiveTintColor: ink,
        tabBarInactiveTintColor: meta,
        tabBarShowLabel: false,
        tabBarStyle: {
          backgroundColor: card,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: tokens.border,
          height: 52 + insets.bottom,
          paddingBottom: insets.bottom,
          paddingTop: 2,
          elevation: 0,
          shadowOpacity: 0,
        },
        tabBarItemStyle: { height: 50 },
      }}
      screenListeners={{
        tabPress: () => { void Haptics.selectionAsync(); },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          // The timeline draws its own chrome so it can hide on scroll.
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Feather name="home" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: 'Search',
          headerTitle: 'Search',
          headerTitleStyle: styles.headerTitle,
          tabBarIcon: ({ color, size }) => <Feather name="search" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="capture"
        options={{
          title: 'Capture',
          headerTitle: 'Capture',
          headerTitleStyle: styles.headerTitle,
          sceneStyle: webSceneStyle,
          tabBarIcon: ({ color, size }) => <Feather name="edit-3" color={color} size={size} />,
        }}
        listeners={{
          // The share sheet still lands on the tab screen (it arrives with
          // params); a bare pen press opens the sheet instead of traveling.
          tabPress: (event) => {
            event.preventDefault();
            setCaptureOpen(true);
          },
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: 'Notifications',
          headerTitle: 'Notifications',
          headerTitleStyle: styles.headerTitle,
          tabBarIcon: ({ color, size }) => <Feather name="bell" color={color} size={size} />,
          ...(unseen > 0 ? { tabBarBadge: unseen > 9 ? '9+' : unseen, tabBarBadgeStyle: styles.badge } : {}),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          headerTitle: 'Profile',
          headerTitleStyle: styles.headerTitle,
          sceneStyle: webSceneStyle,
          tabBarIcon: ({ color, size }) => <Feather name="user" color={color} size={size} />,
        }}
      />
    </Tabs>
    <CaptureSheet visible={captureOpen} onClose={() => setCaptureOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  headerTitle: { color: ink, fontWeight: '700', fontSize: 17 },
  badge: { backgroundColor: tokens.accent, color: '#fff', fontSize: 11, fontWeight: '700' },
});
