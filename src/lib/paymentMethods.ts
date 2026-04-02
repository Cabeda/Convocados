/**
 * Structured payment method types, validation, and deep link generation.
 * Shared between server (API validation) and client (deep link rendering).
 */

export const PAYMENT_METHOD_TYPES = ["phone", "mbway", "revolut_tag", "revolut_link", "cash", "other"] as const;
export type PaymentMethodType = (typeof PAYMENT_METHOD_TYPES)[number];

export interface PaymentMethod {
  type: PaymentMethodType;
  value: string;
  label?: string;
}

/** Validate a single payment method. Returns an error string or null if valid. */
export function validatePaymentMethod(m: unknown): string | null {
  if (!m || typeof m !== "object") return "Invalid payment method.";
  const { type, value } = m as Record<string, unknown>;
  if (!type || !PAYMENT_METHOD_TYPES.includes(type as PaymentMethodType)) {
    return `Invalid type. Must be one of: ${PAYMENT_METHOD_TYPES.join(", ")}`;
  }
  if (!value || typeof value !== "string" || !value.trim()) {
    return "Value is required.";
  }
  const v = (value as string).trim();
  switch (type as PaymentMethodType) {
    case "phone":
    case "mbway": {
      // Allow digits, spaces, dashes, plus sign. Must have at least 6 digits.
      const digits = v.replace(/[^0-9]/g, "");
      if (digits.length < 6 || digits.length > 15) return "Phone number must have 6-15 digits.";
      break;
    }
    case "revolut_tag": {
      // Revolut usernames: alphanumeric, dots, underscores, hyphens. Strip leading @.
      const tag = v.replace(/^@/, "");
      if (!/^[a-zA-Z0-9._-]{1,50}$/.test(tag)) return "Invalid Revolut tag.";
      break;
    }
    case "revolut_link": {
      // Must be a revolut.me or rev.money URL
      if (!/^https?:\/\/(revolut\.me|rev\.money)\//i.test(v)) {
        return "Must be a revolut.me or rev.money link.";
      }
      break;
    }
    case "cash":
    case "other":
      // Free text — any non-empty value is valid
      break;
  }
  return null;
}

/** Validate an array of payment methods. Returns first error or null. */
export function validatePaymentMethods(methods: unknown): string | null {
  if (!Array.isArray(methods)) return "paymentMethods must be an array.";
  if (methods.length > 10) return "Maximum 10 payment methods.";
  for (const m of methods) {
    const err = validatePaymentMethod(m);
    if (err) return err;
  }
  return null;
}

/** Normalize a payment method value (trim, strip @ from revolut tags, etc.) */
export function normalizePaymentMethod(m: PaymentMethod): PaymentMethod {
  const value = m.value.trim();
  switch (m.type) {
    case "revolut_tag":
      return { ...m, value: value.replace(/^@/, ""), label: m.label?.trim() };
    case "phone":
    case "mbway":
      return { ...m, value: value.replace(/\s+/g, ""), label: m.label?.trim() };
    default:
      return { ...m, value, label: m.label?.trim() };
  }
}

/** Parse and normalize payment methods from a JSON string or array. Returns [] on invalid input. */
export function parsePaymentMethods(raw: string | null | undefined): PaymentMethod[] {
  if (!raw) return [];
  try {
    const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((m: unknown) => validatePaymentMethod(m) === null)
      .map((m: PaymentMethod) => normalizePaymentMethod(m));
  } catch {
    return [];
  }
}

/**
 * Generate a deep link URL for a payment method.
 * @param method - The payment method
 * @param amount - Optional amount to pre-fill
 * @param currency - Optional currency code (default EUR)
 * @returns The deep link URL, or null if no deep link is available
 */
export function getDeepLink(
  method: PaymentMethod,
  amount?: number,
  currency?: string,
): string | null {
  switch (method.type) {
    case "phone":
      return `tel:${method.value}`;
    case "mbway":
      // MB Way has no public deep link scheme — return null, UI will show copy fallback
      return null;
    case "revolut_tag": {
      const base = `https://revolut.me/${method.value}`;
      if (amount && amount > 0) {
        const params = new URLSearchParams();
        params.set("amount", amount.toFixed(2));
        if (currency) params.set("currency", currency);
        return `${base}?${params.toString()}`;
      }
      return base;
    }
    case "revolut_link":
      return method.value;
    case "cash":
    case "other":
      return null;
    default:
      return null;
  }
}

/** Get a display label for a payment method type. */
export function getMethodTypeLabel(type: PaymentMethodType): string {
  switch (type) {
    case "phone": return "Phone";
    case "mbway": return "MB Way";
    case "revolut_tag": return "Revolut";
    case "revolut_link": return "Revolut Link";
    case "cash": return "Cash";
    case "other": return "Other";
  }
}

/** Get a display value for a payment method (formatted for the user). */
export function getDisplayValue(method: PaymentMethod): string {
  switch (method.type) {
    case "revolut_tag":
      return `@${method.value}`;
    case "revolut_link": {
      // Show just the path part for cleaner display
      try {
        const url = new URL(method.value);
        return url.pathname.slice(1) || method.value;
      } catch {
        return method.value;
      }
    }
    default:
      return method.value;
  }
}

/**
 * Get a link to open the MB Way app based on the user's platform.
 * - Android: intent URI that opens the app or falls back to Play Store
 * - iOS: App Store link (opens the app if installed via universal links)
 * - Desktop/unknown: null (no app to open)
 */
export function getMbwayAppLink(userAgent: string | undefined): string | null {
  if (!userAgent) return null;
  const ua = userAgent.toLowerCase();
  if (/android/i.test(ua)) {
    // Intent URI that opens the MB Way app directly; falls back to Play Store if not installed
    const fallback = encodeURIComponent("https://play.google.com/store/apps/details?id=pt.sibs.android.mbway");
    return `intent://#Intent;package=pt.sibs.android.mbway;S.browser_fallback_url=${fallback};end`;
  }
  if (/iphone|ipad|ipod/i.test(ua)) {
    // Custom URL scheme to open the MB Way app directly on iOS
    return "mbway://";
  }
  return null;
}
