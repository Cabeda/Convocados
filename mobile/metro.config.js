const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// Monorepo: ensure Metro watches only the mobile directory
config.watchFolders = [__dirname];

// Ensure node_modules resolution works within the mobile package
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, "node_modules"),
];

module.exports = config;
