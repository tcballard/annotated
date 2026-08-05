// Your avatar, top-left — the drawer's handle, X-style. Shared by the
// navigator headers and the timeline's own collapsing chrome.

import { useContext } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { AccountContext } from './AccountContext';
import { avatarColor, avatarInitial } from '../lib/core/avatar';
import { meta, tokens } from '../lib/tokens';

export default function HeaderAvatar() {
  // The drawer lives one layout up; expo-router addresses it by route path.
  const drawer = useNavigation('/(drawer)') as unknown as { openDrawer(): void };
  const { me } = useContext(AccountContext);
  return (
    <Pressable
      onPress={() => drawer.openDrawer()}
      hitSlop={10}
      style={styles.slot}
      accessibilityLabel="Open menu"
    >
      {me?.avatarUrl
        ? <Image source={{ uri: me.avatarUrl }} style={styles.image} />
        : (
          <View style={[styles.circle, { backgroundColor: me ? avatarColor(me.handle || me.displayName) : tokens.soft }]}>
            {me
              ? <Text style={styles.initial}>{avatarInitial(me)}</Text>
              : <Feather name="menu" size={16} color={meta} />}
          </View>
        )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  slot: { marginLeft: 14 },
  circle: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  image: { width: 30, height: 30, borderRadius: 15, backgroundColor: tokens.soft },
  initial: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
