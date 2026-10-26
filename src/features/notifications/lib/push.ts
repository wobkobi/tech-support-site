// src/features/notifications/lib/push.ts
// Web Push delivery to the operator's own devices. Never throws, so a failed notification
// can't fail the customer action behind it.

import { prisma } from "@/shared/lib/prisma";
import webpush from "web-push";

/** One notification to deliver to every registered operator device. */
export interface OwnerPushInput {
  /** Notification heading, e.g. "New booking". */
  title: string;
  /** One-line detail. Name and time only - this renders on a lock screen. */
  body: string;
  /** Admin path opened when the notification is tapped. */
  url: string;
  /** Collapse key. Repeat pushes with one tag replace rather than stack. */
  tag?: string;
}

/** What one {@link sendOwnerPush} call did, for the Send test button. */
export interface OwnerPushResult {
  /** Devices the push service accepted the notification for. */
  sent: number;
  /** Devices that failed for a reason that may pass (a 500 or rate limit). */
  failed: number;
  /** Devices dropped because their endpoint has gone for good. */
  removed: number;
  /** Why nothing was attempted: no VAPID keys, no devices, or the device read failed. */
  skipped?: "not-configured" | "no-devices" | "error";
}

/**
 * Whether a push-service status means the endpoint is gone for good: only 404 and 410,
 * since a 500 or rate limit is transient.
 * @param statusCode - HTTP status from the push service, if any.
 * @returns True when the device row should be deleted.
 */
export function isGoneStatus(statusCode: number | undefined): boolean {
  return statusCode === 404 || statusCode === 410;
}

/**
 * Serialises a notification into the JSON the service worker parses.
 * @param input - Notification content.
 * @returns JSON string for the push body.
 */
export function buildPushPayload(input: OwnerPushInput): string {
  return JSON.stringify({
    title: input.title,
    body: input.body,
    url: input.url,
    // Fall back to the url so two pushes about the same record collapse.
    tag: input.tag ?? input.url,
  });
}

/**
 * Turns a test push result into the reply for the Send test button: an error unless at least
 * one device took it.
 * @param result - What the test push did.
 * @returns The HTTP status and the message to show.
 */
export function pushTestReply(result: OwnerPushResult): { status: number; message: string } {
  if (result.skipped === "not-configured") {
    return {
      status: 503,
      message: "Push isn't set up on the server (the VAPID keys are missing).",
    };
  }
  if (result.skipped === "no-devices") {
    return { status: 409, message: "No devices are registered for notifications." };
  }
  if (result.skipped === "error" || result.sent === 0) {
    return {
      status: 502,
      message: "The test didn't reach any device. Try turning notifications off and on.",
    };
  }
  const total = result.sent + result.failed;
  return {
    status: 200,
    message:
      result.failed > 0
        ? `Test sent to ${result.sent} of ${total} devices - it should appear shortly.`
        : "Test sent - it should appear shortly.",
  };
}

/**
 * Configures web-push from the environment.
 * @returns True when the VAPID keys are present and delivery can proceed.
 */
function configureVapid(): boolean {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    console.warn("[push] VAPID keys not configured - skipping owner push.");
    return false;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

/**
 * Sends a notification to every registered operator device. Never throws; callers await
 * it only so it runs before Vercel freezes the instance.
 * @param input - Notification content.
 * @returns How many devices took it, failed or were dropped.
 */
export async function sendOwnerPush(input: OwnerPushInput): Promise<OwnerPushResult> {
  const result: OwnerPushResult = { sent: 0, failed: 0, removed: 0 };
  try {
    if (!configureVapid()) return { ...result, skipped: "not-configured" };

    const devices = await prisma.pushDevice.findMany();
    if (devices.length === 0) return { ...result, skipped: "no-devices" };

    const payload = buildPushPayload(input);

    await Promise.all(
      devices.map(async (device) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: device.endpoint,
              keys: { p256dh: device.p256dh, auth: device.auth },
            },
            payload,
          );
          result.sent++;
          // Caught on its own: a failed stamp mustn't count a delivered push as failed.
          await prisma.pushDevice
            .update({ where: { id: device.id }, data: { lastSeenAt: new Date() } })
            .catch((err: unknown) => console.error("[push] lastSeenAt update failed", err));
        } catch (err) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (isGoneStatus(statusCode)) {
            // Gone for good - drop the row so it isn't retried on every booking.
            await prisma.pushDevice.delete({ where: { id: device.id } }).catch(() => null);
            result.removed++;
            return;
          }
          // Non-fatal: the device stays, and a stale lastSeenAt shows it in the device list.
          result.failed++;
          console.error(`[push] send failed (${statusCode ?? "no status"})`, err);
        }
      }),
    );
  } catch (err) {
    // Nothing here may propagate: this runs inside a customer's booking.
    console.error("[push] owner push failed", err);
    if (result.sent + result.failed + result.removed === 0) return { ...result, skipped: "error" };
  }
  return result;
}
