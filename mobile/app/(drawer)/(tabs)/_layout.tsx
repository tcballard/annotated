// The X anatomy in annotated's identity: your avatar top-left opens the
// drawer, the wordmark sits center, and five quiet tabs live in a floating
// pill along the bottom — Home · Search · Capture (the pen, center) ·
// Notifications · Profile. The bar is padded off the screen edges above
// the home indicator, Substack-style — the same floating-pill language as
// the web's mobile dock — and the feeds scroll behind it.

import { useContext } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Tabs, useNavigation } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Feather from '@expo/vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BrandMark from '../../../components/BrandMark';
import { AccountContext } from '../../../components/AccountContext';
import { avatarColor, avatarInitial } from '../../../lib/core/avatar';
import { card, ink, meta, paper, tokens } from '../../../lib/tokens';

const HeaderAvatar = () => {
  // The drawer lives one layout up; expo-router addresses it by route path.
  const drawer = useNavigation('/(drawer)') as unknown as { openDrawer(): void };
  const { me } = useContext(AccountContext);
  return (
    <Pressable
      onPress={() => drawer.openDrawer()}
      hitSlop={10}
      style={styles.headerAvatarSlot}
      accessibilityLabel="Open menu"
    >
      {me?.avatarUrl
        ? <Image source={{ uri: me.avatarUrl }} style={styles.headerAvatarImage} />
        : (
          <View style={[styles.headerAvatar, { backgroundColor: me ? avatarColor(me.handle || me.displayName) : tokens.soft }]}>
            {me
              ? <Text style={styles.headerAvatarText}>{avatarInitial(me)}</Text>
              : <Feather name="menu" size={16} color={meta} />}
          </View>
        )}
    </Pressable>
  );
};

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { unseen } = useContext(AccountContext);
  // The pill floats: inset from the edges, above the home indicator, and
  // the surfaces that cannot scroll behind it (the WebView tabs) end at
  // its clearance instead.
  const barBottom = Math.max(insets.bottom, 12) + 4;
  const webSceneStyle = { backgroundColor: paper, paddingBottom: barBottom + 60 };
  return (
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
          position: 'absolute',
          left: 14,
          right: 14,
          bottom: barBottom,
          height: 58,
          borderRadius: 29,
          backgroundColor: card,
          borderTopWidth: 0,
          borderWidth: 1,
          borderColor: tokens.border,
          paddingBottom: 0,
          shadowColor: tokens['chrome-dark'],
          shadowOpacity: 0.18,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 6 },
          elevation: 8,
        },
        tabBarItemStyle: { height: 58, paddingTop: 8 },
      }}
      screenListeners={{
        tabPress: () => { void Haptics.selectionAsync(); },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          headerTitle: () => <BrandMark />,
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
  );
}

const styles = StyleSheet.create({
  headerTitle: { color: ink, fontWeight: '700', fontSize: 17 },
  headerAvatarSlot: { marginLeft: 14 },
  headerAvatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  headerAvatarImage: { width: 30, height: 30, borderRadius: 15, backgroundColor: tokens.soft },
  headerAvatarText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  badge: { backgroundColor: tokens.accent, color: '#fff', fontSize: 11, fontWeight: '700' },
});
