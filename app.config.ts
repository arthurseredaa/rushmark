import type { ExpoConfig } from 'expo/config';

// Secrets live in .env (git-ignored); .env.example documents them.
// These are OAuth *client IDs*, not secrets in the credential sense, but they
// are per-developer and do not belong in version control.
const iosClientId = process.env.GOOGLE_IOS_CLIENT_ID ?? '';
const webClientId = process.env.GOOGLE_WEB_CLIENT_ID ?? '';
const iosUrlScheme = process.env.GOOGLE_IOS_URL_SCHEME ?? 'com.googleusercontent.apps.PLACEHOLDER';

const config: ExpoConfig = {
  name: 'Rushmark',
  slug: 'rushmark',
  version: '1.0.0',
  orientation: 'default',
  scheme: 'rushmark',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  platforms: ['ios'],
  ios: {
    bundleIdentifier: 'com.rushmark.app',
    supportsTablet: true,
    infoPlist: {
      // Cached originals live in Documents/ (FR-010: Caches/ is purged by iOS
      // under storage pressure, which the spec forbids). Documents/ is exposed
      // to the Files app so the user can see and reclaim the space themselves.
      UIFileSharingEnabled: true,
      LSSupportsOpeningDocumentsInPlace: true,
    },
  },
  plugins: [
    'expo-router',
    'expo-dev-client',
    'expo-sqlite',
    // Local notifications for finished background downloads (FR-006e). No push
    // server — client-only, per NFR-2.
    'expo-notifications',
    [
      '@react-native-google-signin/google-signin',
      {
        iosUrlScheme,
      },
    ],
    [
      'expo-build-properties',
      {
        ios: {
          deploymentTarget: '16.0',
          // Google Sign-In pulls in AppCheckCore, whose transitive deps
          // (GoogleUtilities, RecaptchaInterop) ship without module maps and
          // therefore can't be imported from Swift when linked statically.
          // Forcing modular headers on just those two generates the maps
          // without switching the whole pod graph to frameworks.
          extraPods: [
            { name: 'GoogleUtilities', modular_headers: true },
            { name: 'RecaptchaInterop', modular_headers: true },
          ],
        },
      },
    ],
  ],
  extra: {
    googleIosClientId: iosClientId,
    googleWebClientId: webClientId,
  },
  experiments: {
    typedRoutes: true,
  },
};

export default config;
