// Expo's default Metro config. `tsconfigPaths` is enabled by default from SDK 50,
// which is what makes the @/domain/* aliases in tsconfig.json resolve at runtime
// as well as at typecheck time.
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
