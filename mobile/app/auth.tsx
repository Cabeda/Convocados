/**
 * OAuth callback route.
 *
 * The server redirects to convocados://auth?code=xxx after login.
 * expo-web-browser's maybeCompleteAuthSession() intercepts this and
 * passes the URL back to the openAuthSessionAsync() caller.
 *
 * This screen is shown only briefly (or not at all) during the redirect.
 */
import { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { colors } from "~/lib/theme";

WebBrowser.maybeCompleteAuthSession();

export default function AuthCallback() {
  useEffect(() => {
    // maybeCompleteAuthSession() above handles closing the browser session.
    // Nothing else needed here.
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center", alignItems: "center" }}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}
