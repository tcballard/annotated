// The X anatomy in annotated's identity: your avatar top-left opens the
// drawer, the wordmark sits center, four quiet tabs live along the bottom
// — Home · Search · Notifications · Profile — and capture floats as the
// ink FAB above them.

import { useContext } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Tabs, useNavigation, useRouter } from 'expo-router';
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
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { unseen } = useContext(AccountContext);
  return (
    <View style={styles.frame}>
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
          tabBarStyle: { backgroundColor: card, borderTopColor: tokens.hair },
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
            tabBarIcon: ({ color, size }) => <Feather name="user" color={color} size={size} />,
          }}
        />
      </Tabs>
      <Pressable
        style={[styles.fab, { bottom: 64 + insets.bottom }]}
        onPress={() => { void Haptics.selectionAsync(); router.push('/capture'); }}
        accessibilityLabel="Capture a moment"
      >
        <Feather name="plus" size={26} color="#fff" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1 },
  headerTitle: { color: ink, fontWeight: '700', fontSize: 17 },
  headerAvatarSlot: { marginLeft: 14 },
  headerAvatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  headerAvatarImage: { width: 30, height: 30, borderRadius: 15, backgroundColor: tokens.soft },
  headerAvatarText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  badge: { backgroundColor: tokens.accent, color: '#fff', fontSize: 11, fontWeight: '700' },
  fab: {
    position: 'absolute',
    right: 18,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: tokens.chrome,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: tokens['chrome-dark'],
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
