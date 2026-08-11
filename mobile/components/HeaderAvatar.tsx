// Your avatar, top-left — the drawer's handle, X-style. Shared by the
// navigator headers and the timeline's own collapsing chrome.

import { useContext } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from 'expo-router';
import Icon from './Icon';
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
              : <Icon name="menu" size={16} color={meta} />}
          </View>
        )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // The menu button's visual face stays 30pt; its touch target meets the
  // 44pt floor through the slot's own box.
  slot: { marginLeft: 6, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  circle: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  image: { width: 30, height: 30, borderRadius: 15, backgroundColor: tokens.soft },
  initial: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
