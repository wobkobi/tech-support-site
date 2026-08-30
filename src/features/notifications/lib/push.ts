// src/features/notifications/lib/push.ts
// Web Push delivery to the operator's own devices. Mirrors the owner-email
// helpers: swallows every error and never throws, so a failed notification can
// never fail the customer action that triggered it.

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

/**
 * Reports whether a push-service status means the endpoint is permanently
 * gone. Only 404 and 410 qualify: a 500 or a rate limit is transient, and
 * retiring a device on those would unsubscribe a browser that still works.
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
 * Sends a notification to every registered operator device. Never throws:
 * callers await this only so it actually runs before Vercel freezes the
 * instance, never so its result can block them.
 * @param input - Notification content.
 * @returns Promise that resolves once delivery has been attempted.
 */
export async function sendOwnerPush(input: OwnerPushInput): Promise<void> {
  try {
    if (!configureVapid()) return;

    const devices = await prisma.pushDevice.findMany();
    if (devices.length === 0) return;

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
          await prisma.pushDevice.update({
            where: { id: device.id },
            data: { lastSeenAt: new Date(), failureCount: 0 },
          });
        } catch (err) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (isGoneStatus(statusCode)) {
            // The browser is gone for good - drop the row so it stops being
            // retried on every future booking.
            await prisma.pushDevice.delete({ where: { id: device.id } }).catch(() => null);
            return;
          }
          console.error(`[push] send failed (${statusCode ?? "no status"})`, err);
          await prisma.pushDevice
            .update({
              where: { id: device.id },
              data: { failureCount: { increment: 1 } },
            })
            .catch(() => null);
        }
      }),
    );
  } catch (err) {
    // Nothing here may propagate: this runs inside a customer's booking.
    console.error("[push] owner push failed", err);
  }
}
