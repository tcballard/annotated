# Native app guidance

UI work in `mobile/` follows Expo's **expo-native-ui** skill
(<https://github.com/expo/skills/blob/main/plugins/expo/skills/expo-native-ui/SKILL.md>,
adopted at v1.1.1). In particular:

- `boxShadow` for shadows — never the legacy `shadow*`/`elevation` props.
- `{ borderCurve: 'continuous' }` on rounded corners (capsules keep plain radii).
- `expo-haptics` conditionally on iOS (`process.env.EXPO_OS === 'ios'`) for tap feedback.
- `process.env.EXPO_OS`, not `Platform.OS`.
- `React.use`, not `React.useContext`.
- `fontVariant: ['tabular-nums']` on counters.
- `contentInsetAdjustmentBehavior="automatic"` on scroll containers instead of SafeAreaView where a stack owns the insets.
- `expo-audio`/`expo-video`, never `expo-av`; `expo-image`, never intrinsic `img`.

Two deliberate exceptions, where annotated's own design law outranks the skill:

1. **Brand tokens over platform semantic colors.** The one-terracotta / dark-paper
   palette is shared byte-for-byte across web, extension, and native
   (`lib/tokens.ts`, pinned by `test/consistency-audit.test.js`). Do not migrate
   to `Color.ios.*` / Material dynamic colors — the identity is the product's,
   not the platform's.
2. **Shared iconography over SF Symbols.** Icon shapes are part of the
   cross-surface anatomy (Feather here, matching outline SVGs on web and in the
   panel). Moving to `expo-image` `sf:` sources is a product-wide iconography
   decision (and needs an Android fallback) — raise it, don't drift into it.
