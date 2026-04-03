import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Share, Linking, Platform,
} from "react-native";
import { useEffect, useState, useCallback } from "react";
import { useLocalSearchParams } from "expo-router";
import { fetchEvent } from "~/api/endpoints";
import type { EventDetail } from "~/types/api";
import { useT } from "~/hooks/useT";
import { colors } from "~/lib/theme";
import { getServerUrl } from "~/auth/storage";

function googleCalendarUrl(event: EventDetail): string {
  const start = new Date(event.dateTime);
  const end = new Date(start.getTime() + (event.durationMinutes ?? 60) * 60_000);
  const fmt = (d: Date) =>
    d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${fmt(start)}/${fmt(end)}`,
    location: event.location ?? "",
    details: `Convocados game — ${event.maxPlayers} max players`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function webcalUrl(serverUrl: string, eventId: string): string {
  return `webcal://${serverUrl.replace(/^https?:\/\//, "")}/api/events/${eventId}/calendar.ics`;
}

export default function CalendarScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [ev, url] = await Promise.all([fetchEvent(id), getServerUrl()]);
      setEvent(ev);
      setServerUrl(url ?? "");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleGoogleCalendar = async () => {
    if (!event) return;
    await Linking.openURL(googleCalendarUrl(event));
  };

  const handleAppleCalendar = async () => {
    if (!event || !serverUrl) return;
    const url = webcalUrl(serverUrl, id!);
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) {
      await Linking.openURL(url);
    } else {
      await Share.share({ message: `${serverUrl}/api/events/${id}/calendar.ics` });
    }
  };

  const handleShareIcs = async () => {
    if (!event || !serverUrl) return;
    const url = `${serverUrl}/api/events/${id}/calendar.ics`;
    await Share.share({
      message: `Add "${event.title}" to your calendar:\n${url}`,
      url,
    });
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (error || !event) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error ?? t("eventNotFound")}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.heading}>📅 Add to Calendar</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{event.title}</Text>
        <Text style={styles.cardMeta}>
          {new Date(event.dateTime).toLocaleString(undefined, {
            weekday: "long", month: "long", day: "numeric",
            hour: "2-digit", minute: "2-digit",
          })}
          {event.durationMinutes ? ` · ${event.durationMinutes} min` : ""}
        </Text>
        {event.location ? <Text style={styles.cardLocation}>📍 {event.location}</Text> : null}
      </View>

      <TouchableOpacity style={styles.googleBtn} onPress={handleGoogleCalendar}>
        <Text style={styles.googleBtnText}>📆 Open in Google Calendar</Text>
      </TouchableOpacity>

      {Platform.OS === "ios" && (
        <TouchableOpacity style={styles.secondaryBtn} onPress={handleAppleCalendar}>
          <Text style={styles.secondaryBtnText}>🍎 Add to Apple Calendar</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={[styles.secondaryBtn, { marginTop: 10 }]} onPress={handleShareIcs}>
        <Text style={styles.secondaryBtnText}>📤 Share .ics file</Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1, backgroundColor: colors.bg,
    justifyContent: "center", alignItems: "center", padding: 24,
  },
  container: { flex: 1, backgroundColor: colors.bg, padding: 16 },
  heading: {
    color: colors.primary, fontSize: 22, fontWeight: "800",
    marginTop: 8, marginBottom: 16,
  },
  error: { color: colors.error, fontSize: 14 },
  card: {
    backgroundColor: colors.surface, borderRadius: 12, padding: 16,
    marginBottom: 20, borderWidth: 1, borderColor: colors.border,
  },
  cardTitle: { color: colors.text, fontSize: 18, fontWeight: "700", marginBottom: 4 },
  cardMeta: { color: colors.textSecondary, fontSize: 14 },
  cardLocation: { color: colors.textMuted, fontSize: 13, marginTop: 4 },
  googleBtn: {
    backgroundColor: "#1a73e8", borderRadius: 12,
    padding: 16, alignItems: "center", marginBottom: 10,
  },
  googleBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  secondaryBtn: {
    backgroundColor: colors.surface, borderRadius: 12,
    padding: 16, alignItems: "center",
    borderWidth: 1, borderColor: colors.border,
  },
  secondaryBtnText: { color: colors.text, fontSize: 16, fontWeight: "600" },
});
