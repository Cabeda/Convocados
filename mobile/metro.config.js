const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// Monorepo: ensure Metro watches only the mobile directory
config.watchFolders = [__dirname];

// Ensure node_modules resolution works within the mobile package
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, "node_modules"),
];

// Force React to always resolve from mobile's own node_modules.
// Without this, Metro can pick up the root-level React in a monorepo,
// resulting in two React instances and a "useMemo of null" crash.
config.resolver.extraNodeModules = {
  react: path.resolve(__dirname, "node_modules/react"),
  "react-native": path.resolve(__dirname, "node_modules/react-native"),
  "react-native/Libraries/Utilities/codegenNativeComponent": path.resolve(
    __dirname,
    "node_modules/react-native/Libraries/Utilities/codegenNativeComponent"
  ),
};

module.exports = config;
