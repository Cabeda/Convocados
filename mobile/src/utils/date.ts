/**
 * Date formatting utilities for the mobile app.
 * Mirrors the web app's countdown/relative date logic.
 */

export function formatRelativeDate(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffMins = Math.round(diffMs / 60_000);
  const diffHours = Math.round(diffMs / 3_600_000);
  const diffDays = Math.round(diffMs / 86_400_000);

  if (diffMs < 0) {
    // Past
    const absDays = Math.abs(diffDays);
    if (absDays === 0) return "Today";
    if (absDays === 1) return "Yesterday";
    return `${absDays} days ago`;
  }

  // Future
  if (diffMins < 60) return `in ${Math.max(1, diffMins)}m`;
  if (diffHours < 24) return `in ${diffHours}h`;
  if (diffDays === 1) return "Tomorrow";
  if (diffDays < 7) return `in ${diffDays} days`;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateTime(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTime(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}
