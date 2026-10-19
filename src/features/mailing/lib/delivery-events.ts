// src/features/mailing/lib/delivery-events.ts
// Turns Resend delivery webhooks into list actions: a hard bounce drops that address, a
// spam report drops the reader altogether. Pure, so the check script needs no database.

/** What an event asks for: which addresses to take off the list, and why. */
export interface OptOutAction {
  source: "bounce" | "complaint";
  /** Lowercased addresses. */
  emails: string[];
}

/**
 * The bare, lowercased address from a `to` entry, which may be `Name <address>`.
 * @param raw - One `to` entry.
 * @returns The address, or "" when there isn't one.
 */
function addressOf(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const bare = raw.match(/<([^>]+)>/)?.[1] ?? raw;
  const email = bare.trim().toLowerCase();
  return email.includes("@") ? email : "";
}

/**
 * What a Resend webhook event means for the list, or null when it changes nothing.
 * Only Permanent bounces drop the address (Transient ones may clear); `email.suppressed`
 * follows Resend's own suppression reason.
 * @param event - The verified webhook payload.
 * @returns The action, or null.
 */
export function optOutActionFor(event: unknown): OptOutAction | null {
  if (!event || typeof event !== "object") return null;
  const { type, data } = event as { type?: unknown; data?: Record<string, unknown> };
  if (!data) return null;
  const to: unknown[] = Array.isArray(data.to) ? data.to : [data.to];
  const emails = [...new Set(to.map(addressOf).filter(Boolean))];
  if (emails.length === 0) return null;

  if (type === "email.complained") return { source: "complaint", emails };
  if (type === "email.bounced") {
    const bounce = data.bounce as { type?: unknown } | undefined;
    return bounce?.type === "Permanent" ? { source: "bounce", emails } : null;
  }
  if (type === "email.suppressed") {
    const suppressed = data.suppressed as { type?: unknown } | undefined;
    const reason = typeof suppressed?.type === "string" ? suppressed.type.toLowerCase() : "";
    return { source: reason.includes("complain") ? "complaint" : "bounce", emails };
  }
  return null;
}
