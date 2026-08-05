// Platform seam for the share sheet. Native builds use expo-share-intent
// (iOS Share Extension + Android intent filter); the .web variant stubs it
// so the app also runs as a react-native-web preview in a browser.
export { useShareIntent } from 'expo-share-intent';
