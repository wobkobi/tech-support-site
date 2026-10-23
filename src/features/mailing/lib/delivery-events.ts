// src/features/mailing/lib/delivery-events.ts
// Turns Resend webhooks into list actions: a hard bounce drops that address, a spam report
// drops the reader altogether, and a broadcast copy that never arrived marks its row.
// Pure, so the check script needs no database.

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

/** A broadcast copy that didn't arrive, and the reason its row shows. */
export interface BroadcastFailure {
  broadcastId: string;
  /** Lowercased addresses. */
  emails: string[];
  reason: string;
}

/**
 * A broadcast copy that never reached the inbox: a Permanent bounce, or Resend holding it
 * back. A spam report isn't one (the email did arrive), and a Transient bounce may clear.
 * @param event - The verified webhook payload.
 * @returns The failure, or null.
 */
export function broadcastFailureFor(event: unknown): BroadcastFailure | null {
  if (!event || typeof event !== "object") return null;
  const { type, data } = event as { type?: unknown; data?: Record<string, unknown> };
  const broadcastId = typeof data?.broadcast_id === "string" ? data.broadcast_id : "";
  if (!data || !broadcastId) return null;
  const to: unknown[] = Array.isArray(data.to) ? data.to : [data.to];
  const emails = [...new Set(to.map(addressOf).filter(Boolean))];
  if (emails.length === 0) return null;

  if (type === "email.bounced") {
    const bounce = data.bounce as { type?: unknown } | undefined;
    if (bounce?.type !== "Permanent") return null;
    return { broadcastId, emails, reason: "Bounced: this address doesn't take email." };
  }
  if (type === "email.suppressed") {
    return {
      broadcastId,
      emails,
      reason: "Not sent: Resend won't send to this address after an earlier bounce or spam report.",
    };
  }
  return null;
}

/**
 * The address a `contact.updated` event unsubscribed, from Resend's own unsubscribe link
 * or its dashboard.
 * @param event - The verified webhook payload.
 * @returns The lowercased address, or null when the event doesn't unsubscribe anyone.
 */
export function contactUnsubscribeFor(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const { type, data } = event as { type?: unknown; data?: Record<string, unknown> };
  if (type !== "contact.updated" || data?.unsubscribed !== true) return null;
  return addressOf(data.email) || null;
}
