/**
 * Validation for user-supplied webhook URLs.
 *
 * Convocados makes server-side requests to these URLs (the webhook test
 * endpoint and webhook delivery), so they must not be usable to reach loopback,
 * private, link-local, or cloud-metadata addresses (SSRF).
 *
 * This blocks literal private hosts. It does not defend against DNS rebinding
 * (a public hostname resolving to a private IP); that needs resolution-time
 * checks, which the delivery worker would have to enforce.
 */

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "metadata.google.internal",
  "metadata",
  "instance-data",
]);

function parseIpv4(host: string): number[] | null {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return parts;
}

function isPrivateIpv4(parts: number[]): boolean {
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  return false;
}

/**
 * Decode an IPv4 tail of an IPv6 address. WHATWG URL normalises
 * `[::ffff:127.0.0.1]` to `[::ffff:7f00:1]` and `[::127.0.0.1]` to
 * `[::7f00:1]`, so matching the dotted form alone misses loopback.
 */
function ipv4FromTail(tail: string): number[] | null {
  const dotted = parseIpv4(tail);
  if (dotted) return dotted;

  const hex = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const high = parseInt(hex[1], 16);
  const low = parseInt(hex[2], 16);
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

function isPrivateIpv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "::1" || h === "::") return true;
  if (h.startsWith("fe80")) return true; // link-local
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // unique local fc00::/7
  if (h.startsWith("::ffff:")) {
    const v4 = ipv4FromTail(h.slice(7));
    return v4 ? isPrivateIpv4(v4) : false;
  }
  // IPv4-compatible ::/96 (deprecated, but still normalised by URL).
  if (h.startsWith("::")) {
    const v4 = ipv4FromTail(h.slice(2));
    return v4 ? isPrivateIpv4(v4) : false;
  }
  return false;
}

/** Returns an error message when the URL is unsafe, or null when it is allowed. */
export function validateWebhookUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "Invalid URL.";
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "Webhook URL must use http or https.";
  }

  const host = url.hostname.toLowerCase();
  if (!host) return "Webhook URL must include a host.";
  if (
    BLOCKED_HOSTS.has(host) ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return "Webhook URL host is not allowed.";
  }

  const ipv4 = parseIpv4(host);
  if (ipv4 && isPrivateIpv4(ipv4)) {
    return "Webhook URL must not target a private or loopback address.";
  }
  if (host.includes(":") && isPrivateIpv6(host)) {
    return "Webhook URL must not target a private or loopback address.";
  }

  return null;
}
