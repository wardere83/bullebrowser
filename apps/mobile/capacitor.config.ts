import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.bullebrowser.mobile',
  appName: 'BulleBrowser',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  ios: { contentInset: 'never' },
  // Remote pages live in a separate unprivileged native browser, never this bridge.
};
export default config;
