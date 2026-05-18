// src/features/booking/lib/sms.ts
/**
 * @file sms.ts
 * @description ClickSend SMS integration for transactional messages (currently
 * just the same-day booking reminder). Best-effort send: if ClickSend env vars
 * are missing or the API errors, the function logs and returns - the cron's
 * per-booking try/catch keeps the rest of the batch going.
 *
 * Why ClickSend over Twilio: NZ carriers have clamped down on alphanumeric
 * Sender IDs to combat scam SMS, and Twilio's NZ alpha sender support is
 * unreliable in practice (messages get dropped or replaced with a random
 * sender ID). ClickSend's NZ alpha senders actually deliver, and their
 * short-code pricing is reasonable if we ever upgrade.
 *
 * Env vars required:
 * - CLICKSEND_USERNAME (ClickSend account username, usually the signup email)
 * - CLICKSEND_API_KEY (from dashboard - Developers > API Credentials)
 * - CLICKSEND_FROM (alphanumeric sender like "ToThePoint", or a number)
 */

import { formatDateTimeLong } from "@/shared/lib/date-format";
import { rateLimit } from "@/shared/lib/rate-limit";

const SMS_PER_PHONE_PER_DAY = 3;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const CLICKSEND_SEND_URL = "https://rest.clicksend.com/v3/sms/send";

/**
 * Data shape for the same-day reminder SMS.
 */
export interface ReminderSmsData {
  /** Customer's first name (or full name; the SMS just uses the first word). */
  name: string;
  /** E.164 phone number (e.g. "+64211234567"). Must include "+". */
  phone: string;
  /** Appointment start in UTC. */
  startAt: Date;
}

/**
 * Sends a same-day "your appointment is in X hours" reminder via ClickSend.
 * Never throws - returns false on misconfig / send failure so the cron can
 * decide whether to still stamp the sent-at timestamp.
 * @param booking - Reminder inputs.
 * @returns True if ClickSend accepted the message, false on failure or misconfig.
 */
export async function sendBookingReminderSms(booking: ReminderSmsData): Promise<boolean> {
  const username = process.env.CLICKSEND_USERNAME;
  const apiKey = process.env.CLICKSEND_API_KEY;
  const from = process.env.CLICKSEND_FROM;
  if (!username || !apiKey || !from) {
    console.warn("[sms] ClickSend not configured - skipping booking reminder SMS.");
    return false;
  }

  // Defense-in-depth cap: at most a few SMSes to the same phone per day,
  // regardless of how many bookings or cron quirks land in that window.
  // In-memory bucket survives only within a single serverless instance,
  // which is acceptable for catching runaway loops within a single cron run.
  const limited = rateLimit(`sms:${booking.phone}`, SMS_PER_PHONE_PER_DAY, ONE_DAY_MS);
  if (!limited.allowed) {
    console.warn(`[sms] per-phone daily cap reached for ${booking.phone}; skipping send`);
    return false;
  }

  const firstName = booking.name.split(" ")[0];
  const when = formatDateTimeLong(booking.startAt);
  const body =
    `Hi ${firstName}, this is Harrison from To The Point Tech reminding you about our appointment today (${when}). See you soon!\n\n` +
    `Reply STOP to opt out.`;

  const authHeader = `Basic ${Buffer.from(`${username}:${apiKey}`).toString("base64")}`;

  try {
    const res = await fetch(CLICKSEND_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          {
            source: "tothepoint-site",
            from,
            to: booking.phone,
            body,
          },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "<no body>");
      console.error(`[sms] ClickSend HTTP ${res.status} sending to ${booking.phone}: ${text}`);
      return false;
    }

    // ClickSend returns 200 with { response_code: "SUCCESS", data: { messages: [...] } }.
    // A per-message failure (e.g. invalid number) returns 200 at the HTTP layer but a
    // non-SUCCESS status on the individual message - check both.
    const json = (await res.json().catch(() => null)) as {
      response_code?: string;
      data?: { messages?: { status?: string; error_text?: string }[] };
    } | null;
    const messageStatus = json?.data?.messages?.[0]?.status;
    if (json?.response_code !== "SUCCESS" || messageStatus !== "SUCCESS") {
      console.error(
        `[sms] ClickSend logical failure for ${booking.phone}: response_code=${json?.response_code}, status=${messageStatus}, error=${json?.data?.messages?.[0]?.error_text ?? "<none>"}`,
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error(`[sms] Failed to send reminder to ${booking.phone}:`, error);
    return false;
  }
}
