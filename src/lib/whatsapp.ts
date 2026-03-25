import { detectLocale } from "~/lib/i18n";
import type { useT } from "~/lib/useT";

export interface WhatsAppMessageData {
  title: string;
  date: Date;
  location?: string | null;
  spotsLeft: number;
  maxPlayers: number;
  eventUrl: string;
}

export function formatWhatsAppMessage(
  data: WhatsAppMessageData,
  t: ReturnType<typeof useT>
): string {
  const locale = detectLocale();
  const dateFormat: Intl.DateTimeFormatOptions = {
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
  };
  const formattedDate = data.date.toLocaleString(locale === "pt" ? "pt-PT" : "en-GB", dateFormat);

  const parts: string[] = [];

  parts.push(`⚽ ${data.title}`);
  parts.push(`📅 ${formattedDate}`);

  if (data.location) {
    parts.push(`📍 ${data.location}`);
  }

  if (data.spotsLeft > 0) {
    parts.push(`👥 ${t("spotsLeft", { n: data.spotsLeft })}`);
  } else {
    parts.push(`👥 ${t("full")}`);
  }

  parts.push(`👉 ${data.eventUrl}`);

  return parts.join("\n");
}

export function getWhatsAppUrl(message: string, isMobile: boolean = false): string {
  const encoded = encodeURIComponent(message);
  return isMobile
    ? `whatsapp://send?text=${encoded}`
    : `https://web.whatsapp.com/send?text=${encoded}`;
}

export function isMobileDevice(): boolean {
  if (typeof window === "undefined") return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
}