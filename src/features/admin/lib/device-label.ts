// src/features/admin/lib/device-label.ts
// Short "Browser on OS" label from a user-agent string, for the sign-in log. Rough on purpose:
// it only needs to tell the operator's own devices apart from a stranger's.

/**
 * The browser name. Order matters: Edge and Opera UAs also contain "Chrome", Chrome's contains
 * "Safari", and iOS browsers report as Safari with their own token (CriOS, FxiOS, EdgiOS).
 * @param ua - User-agent string.
 * @returns Browser name, or null when unknown.
 */
function browserOf(ua: string): string | null {
  if (/EdgiOS|Edg\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/SamsungBrowser/.test(ua)) return "Samsung Internet";
  if (/FxiOS|Firefox\//.test(ua)) return "Firefox";
  if (/CriOS|Chrome\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  if (/curl|wget|python|node|axios|Go-http/i.test(ua)) return "Script";
  return null;
}

/**
 * The operating system or device.
 * @param ua - User-agent string.
 * @returns OS name, or null when unknown.
 */
function osOf(ua: string): string | null {
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "Windows";
  if (/Mac OS X|Macintosh/.test(ua)) return "Mac";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Linux/.test(ua)) return "Linux";
  return null;
}

/**
 * "Firefox on Windows", "Safari on iPhone", or the best part that could be read.
 * @param ua - User-agent string, or null.
 * @returns Device label.
 */
export function deviceLabel(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = browserOf(ua);
  const os = osOf(ua);
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? "Unknown device";
}
