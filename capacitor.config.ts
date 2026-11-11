import type { CapacitorConfig } from '@capacitor/cli'

/**
 * The iOS app ships the hosted bundle from `dist/`. Board-local editing works
 * offline; Pro (sync, collaboration, agents) comes from the App Store.
 */
const config: CapacitorConfig = {
  appId: 'com.tacticsjournal.board',
  appName: 'Board',
  webDir: 'dist',
  ios: {
    contentInset: 'never',
    scrollEnabled: false,
    backgroundColor: '#000000',
  },
}

export default config
