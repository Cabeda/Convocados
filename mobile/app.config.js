/** @type {import('expo/config').ExpoConfig} */
module.exports = {
  name: "Convocados",
  slug: "convocados",
  version: "1.0.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  scheme: "convocados",
  splash: {
    image: "./assets/splash.png",
    resizeMode: "contain",
    backgroundColor: "#1b6b4a",
  },
  assetBundlePatterns: ["**/*"],
  ios: {
    supportsTablet: true,
    bundleIdentifier: "dev.convocados.app",
  },
  android: {
    adaptiveIcon: {
      backgroundColor: "#1b6b4a",
    },
    package: "com.cabeda.convocados",
    // In EAS builds the file secret is written to a temp path exposed via env var.
    // Locally falls back to the checked-out file.
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json",
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-dev-client",
    [
      "expo-notifications",
      {
        icon: "./assets/notification-icon.png",
        color: "#1b6b4a",
        defaultChannel: "default",
        sounds: [],
      },
    ],
  ],
  extra: {
    router: {
      origin: false,
    },
    eas: {
      projectId: "fae74416-eaec-42d6-b948-61a1156b2db6",
    },
  },
  owner: "jecabeda",
};
