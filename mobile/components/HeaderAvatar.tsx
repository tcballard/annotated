// Your avatar, top-left — the menu's handle, X-style. Shared by the
// navigator headers and the timeline's own collapsing chrome.

import { use } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Icon from './Icon';
import { AccountContext } from './AccountContext';
import { SwipeMenuContext } from './SwipeMenuShell';
import { avatarColor, avatarInitial } from '../lib/core/avatar';
import { meta, tokens } from '../lib/tokens';

export default function HeaderAvatar() {
  const { open } = use(SwipeMenuContext);
  const { me } = use(AccountContext);
  return (
    <Pressable
      onPress={open}
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
