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
2. **One drawn icon set, sourced from core.** The product's icon vocabulary
   lives in `packages/core/src/icons.ts` (the web's hand-drawn canon plus
   Feather-derived additions, MIT) and renders natively through
   `components/Icon.tsx` — never an icon font. The only platform glyphs
   allowed are `SystemIcon`'s allowlist (share, back, forward): system
   affordances wear the OS's own drawing — SF Symbols on iOS per the skill —
   because those glyphs belong to the platform, not the brand. Adding a name
   to that allowlist is a design decision; the consistency audit pins it.

Touch targets: every tappable control meets the 44pt floor with real padded
boxes, not stacked `hitSlop` (overlapping slop on neighbouring actions causes
misfires). Pinned in `test/native-navigation.test.js`.

Switcher anatomy: a top switcher is the product's one tab rail — ink text,
700 active, the 2px terracotta underline inset 34% each side, exactly the
web/panel geometry. Pills are dock anatomy (the web's bottom feed dock) and
never appear as a top switcher. Pinned in `test/native-navigation.test.js`.
