// src/features/reviews/lib/email.ts
/**
 * @description Shared Resend utility for sending transactional emails.
 */

import { buildAppointmentDescription, parseBookingNotes } from "@/features/booking/lib/booking";
import { buildIcs } from "@/features/booking/lib/ics";
import { formatNZD } from "@/features/business/lib/business";
import {
  DEFAULT_INVOICE_EMAIL_BODY,
  DEFAULT_QUOTE_EMAIL_BODY,
  DEFAULT_VOID_EMAIL_BODY,
} from "@/features/business/lib/invoice-email-defaults";
import { cancellationCopy } from "@/features/business/lib/pricing-policy";
import { getPolicy } from "@/features/business/lib/pricing-policy.server";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { formatDateShort, formatDateTimeLong } from "@/shared/lib/date-format";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { getSiteUrl } from "@/shared/lib/site-url";
import { Resend } from "resend";

/**
 * Escapes HTML so user-supplied values can be interpolated into email bodies.
 * @param value - The string to escape.
 * @returns The escaped string.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Renders a pricing-policy `**…**` copy string as email-safe HTML. Non-marker
 * segments are HTML-escaped as cheap insurance against future user input.
 * @param text - Copy string containing zero or more `**…**` segments.
 * @returns HTML fragment ready to drop into an email body.
 */
function renderEmphasisedHtml(text: string): string {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .map((part) => {
      const m = part.match(/^\*\*([^*]+)\*\*$/);
      return m ? `<strong>${escapeHtml(m[1])}</strong>` : escapeHtml(part);
    })
    .join("");
}

/**
 * Renders the standard email signature block (logo, name, contact, footer)
 * from the live business identity.
 * @param siteUrl - Canonical site URL for the logo link and footer.
 * @returns HTML string for the signature.
 */
async function buildEmailSignature(siteUrl: string): Promise<string> {
  const identity = await getIdentity();
  return `
    <div style="margin:32px 0 0;padding-top:24px;border-top:1px solid #e8e8e8">
      <a href="${siteUrl}" style="display:inline-block;margin-bottom:12px">
        <img src="${siteUrl}/assets/email-signature-400x135.png" alt="${identity.company} Tech" width="200" style="display:block;border:0;height:auto" />
      </a>
      <p style="margin:0 0 2px;font-size:14px;font-weight:600;color:#0c0a3e">${identity.name}</p>
      <p style="margin:0 0 10px;font-size:13px;color:#666">Owner &amp; Technician</p>
      <p style="margin:0 0 4px;font-size:13px;color:#555">📞 <a href="${identity.phoneTel}" style="color:#555;text-decoration:none">${identity.phone}</a></p>
      <p style="margin:0 0 4px;font-size:13px;color:#555">✉️ <a href="mailto:${identity.email}" style="color:#43bccd;text-decoration:none">${identity.email}</a></p>
      <p style="margin:0 0 4px;font-size:13px;color:#555">🌐 <a href="${siteUrl}" style="color:#43bccd;text-decoration:none">${siteUrl.replace(/^https?:\/\//, "")}</a></p>
      <p style="margin:0;font-size:12px;color:#999">${identity.location}</p>
    </div>`;
}

// Lazy singleton so module import never throws when RESEND_API_KEY is unset.
let _resend: Resend | null = null;
/**
 * Returns the shared Resend client, initialising it on first call.
 * @returns Resend client instance.
 */
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

/**
 * Names the given email env vars that are unset or blank, so a "not configured"
 * skip log says exactly which var to fix. The email layer deliberately skips
 * (never throws) when unconfigured; this only makes the cause visible.
 * @param names - Env var names the calling send path needs.
 * @returns Comma-joined list of the blank vars.
 */
function missingEmailEnv(...names: string[]): string {
  return names.filter((n) => !process.env[n]?.trim()).join(", ");
}

/**
 * Review data used for owner notification emails.
 */
export interface ReviewNotificationData {
  /** Review database ID */
  id: string;
  /** Review text content */
  text: string;
  /** Reviewer first name */
  firstName: string | null;
  /** Reviewer last name */
  lastName: string | null;
  /** Whether the reviewer posted anonymously */
  isAnonymous: boolean;
  /** Whether the review was verified via a booking token */
  verified: boolean;
}

/**
 * Sends the site owner a notification email when a new review is submitted.
 * Failures are caught and logged - never throws.
 * @param review - The newly submitted review.
 * @returns Promise that resolves when the email is sent (or silently fails).
 */
export async function sendOwnerReviewNotification(review: ReviewNotificationData): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL;
  const from = process.env.EMAIL_FROM;
  const siteUrl = getSiteUrl();

  if (!adminEmail || !from || !process.env.RESEND_API_KEY) {
    console.warn(
      `[email] Not configured (${missingEmailEnv("ADMIN_EMAIL", "EMAIL_FROM", "RESEND_API_KEY")}) - skipping owner notification.`,
    );
    return;
  }

  const displayName = review.isAnonymous
    ? "Anonymous"
    : [review.firstName, review.lastName].filter(Boolean).join(" ") || "Unknown";

  const badge = review.verified ? "✅ Verified (auto-approved)" : "⏳ Pending approval";
  const adminUrl = `${siteUrl}/admin/reviews`;
  const safeDisplayName = escapeHtml(displayName);
  const safeReviewText = escapeHtml(review.text).replace(/\n/g, "<br>");

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;background:#f6f7f8;margin:0;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.08)">
    <h2 style="margin:0 0 8px;color:#0c0a3e;font-size:20px">New review submitted</h2>
    <p style="margin:0 0 20px;color:#555;font-size:14px">${badge}</p>

    <div style="background:#f6f7f8;border-radius:8px;padding:16px;margin-bottom:20px">
      <p style="margin:0 0 8px;font-size:14px;color:#888"><strong style="color:#0c0a3e">${safeDisplayName}</strong></p>
      <p style="margin:0;color:#222;line-height:1.6;font-size:15px">${safeReviewText}</p>
    </div>

    ${
      !review.verified
        ? `<a href="${adminUrl}" style="display:inline-block;background:#43bccd;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">✅ Review &amp; Approve</a>`
        : `<p style="margin-top:12px;margin-bottom:0;color:#555;font-size:14px">This review has been verified.</p>`
    }
  </div>
</body>
</html>`;

  try {
    await getResend().emails.send({
      from,
      replyTo: adminEmail,
      to: adminEmail,
      subject: `New review - ${displayName} (${review.verified ? "verified" : "pending"})`,
      html,
    });
  } catch (error) {
    console.error("[email] Failed to send owner review notification:", error);
  }
}

/**
 * Booking data used for owner/customer booking emails.
 */
export interface BookingNotificationData {
  /** Booking ID */
  id: string;
  /** Customer name */
  name: string;
  /** Customer email */
  email: string;
  /** Formatted notes (includes time slot, duration, meeting type, address, phone, description) */
  notes: string;
  /** Appointment start (UTC) */
  startAt: Date;
  /** Appointment end (UTC) */
  endAt: Date;
  /** Cancel token for the cancel link */
  cancelToken: string;
  /** Promo title snapshotted at booking time, or null when none was active. */
  promoTitleAtBooking?: string | null;
  /**
   * Appointment address, already combined with any unit. Drives the map link
   * and the calendar attachment's LOCATION. Omit for remote jobs.
   */
  address?: string | null;
  /**
   * Nullable on older bookings. Only an explicit "remote" suppresses the
   * address ({@link onSiteAddress}); address and meetingType are written together.
   */
  meetingType?: "in_person" | "remote" | null;
  /** How many times the booking has moved; becomes the calendar SEQUENCE. */
  rescheduleCount?: number;
}

/**
 * Cancellation copy from LIVE settings (fee terms must never drift from what
 * is configured), narrowed to the tier that binds this booking.
 * @param booking - The booking being emailed about.
 * @returns Policy copy in the `**…**` emphasis convention.
 */
async function liveCancellationCopy(booking: BookingNotificationData): Promise<string> {
  const { CANCELLATION: live } = await getPolicy();
  // A null meetingType (older rows) can't be narrowed - show both tiers.
  return cancellationCopy(live, booking.meetingType ? { only: booking.meetingType } : undefined);
}

/**
 * On-site address for a booking, or "" when the job is remote or has none.
 * @param booking - The booking being emailed about.
 * @returns Trimmed address, or an empty string.
 */
function onSiteAddress(booking: BookingNotificationData): string {
  const isRemote = booking.meetingType === "remote";
  return !isRemote && booking.address ? booking.address.trim() : "";
}

/**
 * Maps link for the OWNER's emails only - the customer's address is their own
 * home; the operator is the one driving there.
 * @param booking - The booking being emailed about.
 * @returns HTML paragraph, or "" when there's nothing to map.
 */
function ownerMapHtml(booking: BookingNotificationData): string {
  const address = onSiteAddress(booking);
  if (!address) return "";
  // Just the action - the notes block directly above already prints the full
  // address, so repeating it here only makes the email longer.
  return `<p style="margin:0 0 20px"><a href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(
    address,
  )}" style="color:#43bccd;font-size:14px;font-weight:600">📍 Get directions</a></p>`;
}

/**
 * Builds the `.ics` attachment sent with the customer's booking emails.
 * @param booking - The booking being emailed about.
 * @returns A Resend attachment list holding one calendar file.
 */
async function bookingIcsAttachment(
  booking: BookingNotificationData,
): Promise<Array<{ filename: string; content: Buffer }>> {
  const siteUrl = getSiteUrl();
  const identity = await getIdentity();
  const isRemote = booking.meetingType === "remote";
  const address = onSiteAddress(booking);

  const ics = buildIcs({
    uid: `booking-${booking.id}@tothepointtech.co.nz`,
    start: booking.startAt,
    end: booking.endAt,
    summary: `${identity.company} appointment`,
    description: buildAppointmentDescription({
      company: identity.company,
      phone: identity.phone,
      email: identity.email,
      isRemote,
      userNotes: parseBookingNotes(booking.notes).userNotes,
      manageUrl: `${siteUrl}/booking/edit?token=${encodeURIComponent(booking.cancelToken)}`,
      cancelUrl: `${siteUrl}/booking/cancel?token=${encodeURIComponent(booking.cancelToken)}`,
    }),
    location: address || undefined,
    url: `${siteUrl}/booking/edit?token=${encodeURIComponent(booking.cancelToken)}`,
    sequence: booking.rescheduleCount ?? 0,
    organiserEmail: identity.email,
  });

  return [{ filename: "appointment.ics", content: Buffer.from(ics, "utf-8") }];
}

/**
 * Sends the site owner a notification email for a new or rescheduled booking.
 * Failures are caught and logged - never throws.
 * @param booking - The booking details.
 * @param options - Optional flags.
 * @param options.kind - "new" (default) for fresh bookings, "rescheduled" for edits.
 * @param options.previousStartAt - Original start time, shown in the body when rescheduled.
 * @returns Promise that resolves when the email is sent (or silently fails).
 */
export async function sendOwnerBookingNotification(
  booking: BookingNotificationData,
  options?: { kind?: "new" | "rescheduled"; previousStartAt?: Date },
): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL;
  const from = process.env.EMAIL_FROM;

  if (!adminEmail || !from || !process.env.RESEND_API_KEY) {
    console.warn(
      `[email] Not configured (${missingEmailEnv("ADMIN_EMAIL", "EMAIL_FROM", "RESEND_API_KEY")}) - skipping owner booking notification.`,
    );
    return;
  }

  // Derive display fields
  const kind = options?.kind ?? "new";
  const start = formatDateTimeLong(booking.startAt);
  const previous = options?.previousStartAt ? formatDateTimeLong(options.previousStartAt) : null;
  const notesHtml = escapeHtml(booking.notes).replace(/\n/g, "<br>");
  const safeName = escapeHtml(booking.name);
  const safeEmail = escapeHtml(booking.email);
  const safeMailto = encodeURIComponent(booking.email);

  const heading = kind === "rescheduled" ? "🔄 Booking rescheduled" : "New booking";
  const subject =
    kind === "rescheduled"
      ? `🔄 Booking rescheduled - ${booking.name} (${start})`
      : `New booking - ${booking.name} (${start})`;
  const previousLine =
    kind === "rescheduled" && previous
      ? `<p style="margin:0 0 16px;color:#555;font-size:13px">Was: <s>${escapeHtml(previous)}</s></p>`
      : "";

  // Render the email body
  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;background:#f6f7f8;margin:0;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.08)">
    <h2 style="margin:0 0 4px;color:#0c0a3e;font-size:20px">${heading}</h2>
    <p style="margin:0 0 4px;color:#555;font-size:14px">${start}</p>
    ${previousLine}

    <div style="background:#f6f7f8;border-radius:8px;padding:16px;margin-bottom:20px">
      <p style="margin:0 0 4px;font-size:14px;color:#888">Customer</p>
      <p style="margin:0 0 12px;font-size:15px;color:#0c0a3e;font-weight:600">${safeName}</p>
      <p style="margin:0 0 12px;font-size:14px;color:#444"><a href="mailto:${safeMailto}" style="color:#43bccd">${safeEmail}</a></p>
      <p style="margin:0;font-size:14px;color:#444;line-height:1.6">${notesHtml}</p>
    </div>

    ${ownerMapHtml(booking)}
  </div>
</body>
</html>`;

  // Send via Resend
  try {
    await getResend().emails.send({
      from,
      // Reply goes to the customer who booked, not back to the owner inbox.
      replyTo: booking.email,
      to: adminEmail,
      subject,
      html,
    });
  } catch (error) {
    console.error("[email] Failed to send owner booking notification:", error);
  }
}

/**
 * Sends the customer a booking confirmation or reschedule notification.
 * Failures are caught and logged - never throws.
 * @param booking - The booking details.
 * @param options - Optional flags.
 * @param options.kind - "new" (default) for a fresh booking; "rescheduled" for an edit.
 * @param options.previousStartAt - Original start time, shown crossed-out when rescheduled.
 */
export async function sendCustomerBookingConfirmation(
  booking: BookingNotificationData,
  options?: { kind?: "new" | "rescheduled"; previousStartAt?: Date },
): Promise<void> {
  const from = process.env.EMAIL_FROM;
  const siteUrl = getSiteUrl();

  if (!from || !process.env.RESEND_API_KEY) {
    console.warn(
      `[email] Not configured (${missingEmailEnv("EMAIL_FROM", "RESEND_API_KEY")}) - skipping customer booking confirmation.`,
    );
    return;
  }

  // Derive display fields
  const kind = options?.kind ?? "new";
  const firstName = booking.name.split(" ")[0];
  const safeFirstName = escapeHtml(firstName);
  const start = formatDateTimeLong(booking.startAt);
  const previous = options?.previousStartAt ? formatDateTimeLong(options.previousStartAt) : null;
  const cancelUrl = `${siteUrl}/booking/cancel?token=${encodeURIComponent(booking.cancelToken)}`;
  const editUrl = `${siteUrl}/booking/edit?token=${encodeURIComponent(booking.cancelToken)}`;
  // Only the customer's own words: the rest of the notes blob restates the time
  // (already shown above) and the meeting type / address (now their own line).
  const userNotesHtml = escapeHtml(parseBookingNotes(booking.notes).userNotes).replace(
    /\n/g,
    "<br>",
  );
  const onSite = onSiteAddress(booking);
  const whereLine =
    booking.meetingType === "remote"
      ? `<p style="margin:0 0 20px;color:#444;font-size:14px">💻 Remote session - no visit needed.</p>`
      : onSite
        ? `<p style="margin:0 0 20px;color:#444;font-size:14px">📍 ${escapeHtml(onSite)}</p>`
        : "";
  const cancellationText = await liveCancellationCopy(booking);

  const heading =
    kind === "rescheduled"
      ? `🔄 Appointment updated, ${safeFirstName}!`
      : `Booking confirmed, ${safeFirstName}!`;
  const intro =
    kind === "rescheduled"
      ? "Your appointment has been rescheduled. The Google Calendar invite has been updated to match."
      : "Thanks for choosing To The Point Tech - I'm looking forward to helping you out.";
  const subject =
    kind === "rescheduled" ? `🔄 Appointment updated - ${start}` : `Booking confirmed - ${start}`;
  const previousLine =
    kind === "rescheduled" && previous
      ? `<p style="margin:0 0 20px;color:#888;font-size:13px"><s>${escapeHtml(previous)}</s></p>`
      : "";
  const attachments = await bookingIcsAttachment(booking);
  const promoLine = booking.promoTitleAtBooking
    ? `<div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:8px;padding:12px 16px;margin-bottom:16px"><p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#0c0a3e">🏷 Rate locked in: ${escapeHtml(booking.promoTitleAtBooking)}</p><p style="margin:0;font-size:13px;color:#444;line-height:1.5">This rate applies to your appointment even if the offer ends before your visit.</p></div>`
    : "";

  // Render the email body
  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;background:#f6f7f8;margin:0;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.08)">
    <h2 style="margin:0 0 12px;color:#0c0a3e;font-size:20px">${heading}</h2>
    <p style="margin:0 0 20px;color:#444;line-height:1.6">${intro}</p>

    <p style="margin:0 0 8px;color:#888;font-size:13px;text-transform:uppercase;letter-spacing:.05em;font-weight:600">Your appointment</p>
    <p style="margin:0 0 4px;font-size:16px;font-weight:600;color:#0c0a3e">${start}</p>
    ${previousLine}
    ${whereLine}

    ${promoLine}

    ${
      userNotesHtml
        ? `<div style="background:#f6f7f8;border-radius:8px;padding:16px;margin-bottom:24px">
      <p style="margin:0 0 4px;font-size:13px;color:#888">What you told me</p>
      <p style="margin:0;font-size:14px;color:#444;line-height:1.6">${userNotesHtml}</p>
    </div>`
        : ""
    }

    <p style="margin:0 0 20px;color:#444;font-size:14px;line-height:1.6">
      Need to change anything? Use the buttons below, or just reply to this email.
    </p>

    <a href="${editUrl}" style="display:inline-block;background:#43bccd;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:13px;font-weight:600;margin:0 8px 10px 0">✏️ Change appointment</a>
    <a href="${cancelUrl}" style="display:inline-block;background:#e8e8e8;color:#333;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:13px;font-weight:600;margin:0 0 10px">❌ Cancel appointment</a>

    <p style="margin:28px 0 6px;color:#888;font-size:13px;text-transform:uppercase;letter-spacing:.05em;font-weight:600">Cancellation policy</p>
    <p style="margin:0;color:#444;font-size:13px;line-height:1.6">${renderEmphasisedHtml(cancellationText)}</p>
${await buildEmailSignature(siteUrl)}
  </div>
</body>
</html>`;

  // Send via Resend
  try {
    await getResend().emails.send({
      from,
      replyTo: process.env.ADMIN_EMAIL,
      to: booking.email,
      subject,
      html,
      attachments,
    });
  } catch (error) {
    console.error(`[email] Failed to send booking confirmation for booking ${booking.id}:`, error);
  }
}

/**
 * Sends a "your appointment is tomorrow" reminder. Fired by the
 * /api/cron/send-booking-reminders cron. Failures are logged - never throws.
 * @param booking - Booking details (same shape as the confirmation helper).
 * @returns True if Resend accepted the message, false on misconfig / failure.
 */
export async function sendBookingReminderEmail(booking: BookingNotificationData): Promise<boolean> {
  const from = process.env.EMAIL_FROM;
  const siteUrl = getSiteUrl();

  if (!from || !process.env.RESEND_API_KEY) {
    console.warn(
      `[email] Not configured (${missingEmailEnv("EMAIL_FROM", "RESEND_API_KEY")}) - skipping booking reminder email.`,
    );
    return false;
  }

  // Derive display fields
  const firstName = booking.name.split(" ")[0];
  const safeFirstName = escapeHtml(firstName);
  const start = formatDateTimeLong(booking.startAt);
  const cancelUrl = `${siteUrl}/booking/cancel?token=${encodeURIComponent(booking.cancelToken)}`;
  const editUrl = `${siteUrl}/booking/edit?token=${encodeURIComponent(booking.cancelToken)}`;
  const userNotesHtml = escapeHtml(parseBookingNotes(booking.notes).userNotes).replace(
    /\n/g,
    "<br>",
  );
  const onSite = onSiteAddress(booking);
  const whereLine =
    booking.meetingType === "remote"
      ? `<p style="margin:0 0 20px;color:#444;font-size:14px">💻 Remote session - no visit needed.</p>`
      : onSite
        ? `<p style="margin:0 0 20px;color:#444;font-size:14px">📍 ${escapeHtml(onSite)}</p>`
        : "";
  const cancellationText = await liveCancellationCopy(booking);
  const promoLine = booking.promoTitleAtBooking
    ? `<div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:8px;padding:12px 16px;margin-bottom:16px"><p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#0c0a3e">🏷 Rate locked in: ${escapeHtml(booking.promoTitleAtBooking)}</p><p style="margin:0;font-size:13px;color:#444;line-height:1.5">This rate applies to your appointment even if the offer ends before your visit.</p></div>`
    : "";
  const attachments = await bookingIcsAttachment(booking);

  // Render the email body. The "tomorrow" wording assumes comms.reminderLeadHours
  // stays near 24h; revisit this copy if that lead time moves far from a day.
  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;background:#f6f7f8;margin:0;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.08)">
    <h2 style="margin:0 0 12px;color:#0c0a3e;font-size:20px">Hi ${safeFirstName}, just a reminder</h2>
    <p style="margin:0 0 20px;color:#444;line-height:1.6">Your appointment with To The Point Tech is coming up tomorrow.</p>

    <p style="margin:0 0 8px;color:#888;font-size:13px;text-transform:uppercase;letter-spacing:.05em;font-weight:600">When</p>
    <p style="margin:0 0 4px;font-size:16px;font-weight:600;color:#0c0a3e">${start}</p>
    ${whereLine}

    ${promoLine}

    ${
      userNotesHtml
        ? `<div style="background:#f6f7f8;border-radius:8px;padding:16px;margin-bottom:24px">
      <p style="margin:0 0 4px;font-size:13px;color:#888">What you told me</p>
      <p style="margin:0;font-size:14px;color:#444;line-height:1.6">${userNotesHtml}</p>
    </div>`
        : ""
    }

    <p style="margin:0 0 20px;color:#444;font-size:14px;line-height:1.6">
      Need to change anything? Use the buttons below, or just reply to this email.
    </p>

    <a href="${editUrl}" style="display:inline-block;background:#43bccd;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:13px;font-weight:600;margin:0 8px 10px 0">✏️ Change appointment</a>
    <a href="${cancelUrl}" style="display:inline-block;background:#e8e8e8;color:#333;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:13px;font-weight:600;margin:0 0 10px">❌ Cancel appointment</a>

    <p style="margin:28px 0 6px;color:#888;font-size:13px;text-transform:uppercase;letter-spacing:.05em;font-weight:600">Cancellation policy</p>
    <p style="margin:0;color:#444;font-size:13px;line-height:1.6">${renderEmphasisedHtml(cancellationText)}</p>
${await buildEmailSignature(siteUrl)}
  </div>
</body>
</html>`;

  // Send via Resend
  try {
    await getResend().emails.send({
      from,
      replyTo: process.env.ADMIN_EMAIL,
      to: booking.email,
      subject: `Reminder: appointment tomorrow - ${start}`,
      html,
      attachments,
    });
    return true;
  } catch (error) {
    console.error(`[email] Failed to send reminder for booking ${booking.id}:`, error);
    return false;
  }
}

/** One upcoming booking listed in the manage-links email. */
export interface ManageLinksBooking {
  /** Appointment start (UTC). */
  startAt: Date;
  /** Token behind the edit / cancel links. */
  cancelToken: string;
}

/**
 * Emails manage links after a find-my-booking lookup. Only ever sent to the
 * address that owns the bookings, so carrying the tokens is safe.
 * @param to - Recipient address (the booking email).
 * @param bookings - Their upcoming bookings, soonest first.
 * @returns True if Resend accepted the message, false on misconfig / failure.
 */
export async function sendBookingManageLinksEmail(
  to: string,
  bookings: ManageLinksBooking[],
): Promise<boolean> {
  const from = process.env.EMAIL_FROM;
  const siteUrl = getSiteUrl();

  if (!from || !process.env.RESEND_API_KEY) {
    console.warn(
      `[email] Not configured (${missingEmailEnv("EMAIL_FROM", "RESEND_API_KEY")}) - skipping manage-links email.`,
    );
    return false;
  }
  if (bookings.length === 0) return false;

  const rows = bookings
    .map((b) => {
      const editUrl = `${siteUrl}/booking/edit?token=${encodeURIComponent(b.cancelToken)}`;
      const cancelUrl = `${siteUrl}/booking/cancel?token=${encodeURIComponent(b.cancelToken)}`;
      return `
    <div style="background:#f6f7f8;border-radius:8px;padding:16px;margin-bottom:16px">
      <p style="margin:0 0 12px;font-size:16px;font-weight:600;color:#0c0a3e">${formatDateTimeLong(b.startAt)}</p>
      <a href="${editUrl}" style="display:inline-block;background:#43bccd;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:13px;font-weight:600;margin:0 8px 10px 0">✏️ Change appointment</a>
      <a href="${cancelUrl}" style="display:inline-block;background:#e8e8e8;color:#333;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:13px;font-weight:600;margin:0 0 10px">❌ Cancel appointment</a>
    </div>`;
    })
    .join("");

  const plural = bookings.length === 1 ? "appointment" : "appointments";
  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;background:#f6f7f8;margin:0;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.08)">
    <h2 style="margin:0 0 12px;color:#0c0a3e;font-size:20px">Your upcoming ${plural}</h2>
    <p style="margin:0 0 20px;color:#444;line-height:1.6">Here are the links to change or cancel. If you didn't ask for this email you can safely ignore it.</p>
    ${rows}
    <p style="margin:20px 0 0;color:#444;font-size:14px;line-height:1.6">Prefer to talk it through? Just reply to this email.</p>
${await buildEmailSignature(siteUrl)}
  </div>
</body>
</html>`;

  try {
    await getResend().emails.send({
      from,
      replyTo: process.env.ADMIN_EMAIL,
      to,
      subject: `Your upcoming ${plural}`,
      html,
    });
    return true;
  } catch (error) {
    console.error("[email] Failed to send manage-links email:", error);
    return false;
  }
}

/**
 * Booking data used for customer review request emails.
 */
export interface ReviewRequestData {
  /** Booking ID or ReviewRequest ID */
  id: string;
  /** Customer name */
  name: string;
  /** Customer email address */
  email: string;
  /** Unique review token */
  reviewToken: string;
}

/**
 * Sends a review request email to a customer shortly after their appointment.
 * Failures are caught and logged - never throws.
 * @param booking - Booking details for the customer.
 * @returns True when the email was sent (or intentionally skipped because Resend
 *   is not configured); false when the send failed and should be retried.
 */
export async function sendCustomerReviewRequest(booking: ReviewRequestData): Promise<boolean> {
  const from = process.env.EMAIL_FROM;
  const siteUrl = getSiteUrl();

  if (!from || !process.env.RESEND_API_KEY) {
    console.warn(
      `[email] Not configured (${missingEmailEnv("EMAIL_FROM", "RESEND_API_KEY")}) - skipping customer review request.`,
    );
    return true;
  }

  const identity = await getIdentity();
  const reviewUrl = `${siteUrl}/review?token=${encodeURIComponent(booking.reviewToken)}`;
  const firstName = booking.name.split(" ")[0];
  const safeFirstName = escapeHtml(firstName);

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;background:#f6f7f8;margin:0;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.08)">
    <h2 style="margin:0 0 12px;color:#0c0a3e;font-size:20px">Hi ${safeFirstName}, how did everything go?</h2>
    <p style="margin:0 0 12px;color:#444;line-height:1.6">It was great meeting you - I hope I managed to get everything sorted and left you feeling a bit less frustrated with technology!</p>
    <p style="margin:0 0 12px;color:#444;line-height:1.6">If you have a spare moment, I'd love to hear how it went. A quick review makes a real difference for a small local business like mine, and helps other people find reliable tech support when they need it.</p>
    <p style="margin:0 0 24px;color:#444;line-height:1.6">It only takes a minute, and honest feedback is always welcome.</p>
    <a href="${reviewUrl}" style="display:inline-block;background:#43bccd;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px">Leave a review</a>

    <p style="margin:28px 0 20px;color:#444;font-size:14px;line-height:1.6">Thanks again for choosing ${identity.company} Tech. If you ever need a hand with anything else, don't hesitate to get in touch.</p>
${await buildEmailSignature(siteUrl)}
  </div>
</body>
</html>`;

  try {
    await getResend().emails.send({
      from,
      replyTo: process.env.ADMIN_EMAIL,
      to: booking.email,
      subject: `Thanks for having me, ${firstName} - how did everything go?`,
      html,
    });
    return true;
  } catch (error) {
    console.error(`[email] Failed to send review request for booking ${booking.id}:`, error);
    return false;
  }
}

/**
 * Builds the HTML body for a past-client review request email.
 * @param firstName - Customer's first name.
 * @param reviewUrl - The personalised review link URL.
 * @returns HTML string ready to send.
 */
export async function buildPastClientReviewEmailHtml(
  firstName: string,
  reviewUrl: string,
): Promise<string> {
  const siteUrl = getSiteUrl();
  const identity = await getIdentity();
  const safeFirstName = escapeHtml(firstName);
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;background:#f6f7f8;margin:0;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.08)">
    <h2 style="margin:0 0 12px;color:#0c0a3e;font-size:20px">Hi ${safeFirstName},</h2>
    <p style="margin:0 0 12px;color:#444;line-height:1.6">It's ${identity.name.split(" ")[0]} from ${identity.company} Tech - thanks again for letting me help you out!</p>
    <p style="margin:0 0 12px;color:#444;line-height:1.6">If you have a spare moment, a quick review would mean a lot - it really helps other people find reliable local tech support.</p>
    <p style="margin:0 0 24px;color:#444;line-height:1.6">No pressure at all, but if you're happy to, I'd really appreciate it.</p>
    <a href="${reviewUrl}" style="display:inline-block;background:#43bccd;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px">Leave a review</a>

    <p style="margin:28px 0 20px;color:#444;font-size:14px;line-height:1.6">If you ever need a hand with anything else, don't hesitate to get in touch.</p>
${await buildEmailSignature(siteUrl)}
  </div>
</body>
</html>`;
}

/**
 * Sends a review request email to a past client (admin-triggered).
 * Tone is tailored for clients who were seen days/weeks ago, mentioning
 * the site update and asking for a review. Failures are caught and logged.
 * @param booking - Past client details.
 * @returns True when the email was sent (or intentionally skipped because Resend
 *   is not configured); false when the send failed.
 */
export async function sendPastClientReviewRequest(booking: ReviewRequestData): Promise<boolean> {
  const from = process.env.EMAIL_FROM;
  const siteUrl = getSiteUrl();

  if (!from || !process.env.RESEND_API_KEY) {
    console.warn(
      `[email] Not configured (${missingEmailEnv("EMAIL_FROM", "RESEND_API_KEY")}) - skipping past client review request.`,
    );
    return true;
  }

  const reviewUrl = `${siteUrl}/review?token=${encodeURIComponent(booking.reviewToken)}`;
  const firstName = booking.name.split(" ")[0];
  const html = await buildPastClientReviewEmailHtml(firstName, reviewUrl);

  try {
    await getResend().emails.send({
      from,
      replyTo: process.env.ADMIN_EMAIL,
      to: booking.email,
      subject: `Hi ${firstName}, it's Harrison from To The Point Tech`,
      html,
    });
    return true;
  } catch (error) {
    console.error(
      `[email] Failed to send past client review request for request ${booking.id}:`,
      error,
    );
    return false;
  }
}

/**
 * Subset of the Invoice row needed to render the email body.
 * Kept as a structural type so callers can pass a Prisma row directly without coupling.
 */
export interface InvoiceEmailData {
  number: string;
  clientName: string;
  clientEmail: string;
  issueDate: Date;
  dueDate: Date;
  total: number;
  driveWebUrl?: string | null;
  /** True when the row is a quote - switches subject/body to quote wording. */
  isQuote?: boolean | null;
  /** Quote validity end; shown in place of the due date. */
  quoteValidUntil?: Date | null;
}

interface BuildInvoiceEmailArgs {
  invoice: InvoiceEmailData;
  reviewUrl: string | null;
  greetingName?: string;
  customBody?: string;
}

/**
 * Renders the invoice email subject + HTML body without sending. Shared by
 * the preview modal and the send route so the preview matches what's sent.
 * @param args - Render inputs.
 * @param args.invoice - Invoice row fields needed for the body.
 * @param args.reviewUrl - Stable per-contact review URL, or null to omit.
 * @param args.greetingName - Optional greeting target (e.g. person inside a company).
 * @param args.customBody - Optional intro replacement (multi-line via pre-wrap).
 * @returns Subject + escaped HTML body.
 */
export async function buildInvoiceEmail({
  invoice,
  reviewUrl,
  greetingName,
  customBody,
}: BuildInvoiceEmailArgs): Promise<{ subject: string; html: string }> {
  const siteUrl = getSiteUrl();
  const identity = await getIdentity();
  const isQuote = invoice.isQuote === true;
  const defaultBody = isQuote ? DEFAULT_QUOTE_EMAIL_BODY : DEFAULT_INVOICE_EMAIL_BODY;
  const bodyText = (customBody ?? defaultBody).trim();
  // pre-wrap preserves line breaks the operator typed; escape first so the
  // body can never inject markup.
  const safeBody = escapeHtml(bodyText || defaultBody);
  // Greeting: caller-supplied override wins; otherwise fall back to the first
  // word of clientName. The Send modal lets the operator type the right name
  // per send, so there's no auto-detection of company vs person here.
  const trimmedOverride = greetingName?.trim();
  const greetingTarget =
    trimmedOverride || (invoice.clientName.split(" ")[0] || invoice.clientName).trim();
  const safeGreeting = escapeHtml(greetingTarget);
  const safeNumber = escapeHtml(invoice.number);
  const dueDate = escapeHtml(formatDateShort(invoice.dueDate));
  const totalLabel = escapeHtml(formatNZD(invoice.total));
  const driveLink = invoice.driveWebUrl
    ? `<p style="margin:0 0 16px;font-size:14px;color:#555">An online copy is also here: <a href="${escapeHtml(invoice.driveWebUrl)}" style="color:#43bccd">view ${isQuote ? "quote" : "invoice"}</a>.</p>`
    : "";
  // No review ask on a quote - the job hasn't happened yet.
  const reviewLine =
    reviewUrl && !isQuote
      ? `<p style="margin:24px 0 0;font-size:14px;color:#555">If you've got a moment, I'd love to hear how it went - you can <a href="${escapeHtml(reviewUrl)}" style="color:#43bccd">leave a quick review here</a>. It's anonymous if you'd prefer.</p>`
      : "";

  // Quote emails swap the due line for validity and drop the bank block -
  // payment details come with the invoice after acceptance.
  const dateLine = isQuote
    ? invoice.quoteValidUntil
      ? `<p style="margin:0"><strong>Valid until:</strong> ${escapeHtml(formatDateShort(invoice.quoteValidUntil))}</p>`
      : ""
    : `<p style="margin:0"><strong>Due:</strong> ${dueDate} (${identity.paymentTermsDays} days from issue)</p>`;
  const paymentBlock = isQuote
    ? ""
    : `<p style="margin:0 0 8px;font-size:14px;color:#333"><strong>Bank transfer:</strong></p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#333">
      Payee: ${escapeHtml(identity.name)}<br />
      Account: <strong>${escapeHtml(identity.bankAccount)}</strong><br />
      Reference: <strong>${safeNumber}</strong>
    </p>`;

  // Append " Tech" to match the signature and body brand name, so the subject
  // and the rest of the same email show one consistent business name.
  const subject = isQuote
    ? `Your quote from ${identity.company} Tech (${invoice.number})`
    : `Your invoice from ${identity.company} Tech (${invoice.number})`;
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:24px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0c0a3e;background:#f6f7f8">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:24px">
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0c0a3e">Hi ${safeGreeting},</h1>

    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#333;white-space:pre-wrap">${safeBody}</p>

    <div style="margin:0 0 16px;padding:12px 16px;background:#f3f4f6;border-radius:8px;font-size:14px;color:#333">
      <p style="margin:0 0 4px"><strong>${isQuote ? "Quote" : "Invoice"}:</strong> ${safeNumber}</p>
      <p style="margin:0 0 4px"><strong>Total:</strong> ${totalLabel}</p>
      ${dateLine}
    </div>

    ${driveLink}

    ${paymentBlock}

    <p style="margin:0;font-size:14px;color:#333">Any questions, just reply.</p>

    ${reviewLine}

    ${await buildEmailSignature(siteUrl)}
  </div>
</body>
</html>`;

  return { subject, html };
}

interface SendInvoiceEmailArgs {
  invoice: InvoiceEmailData;
  pdfBytes: Uint8Array;
  reviewUrl: string | null;
  greetingName?: string;
  customBody?: string;
}

/**
 * Sends the rendered invoice email via Resend with the PDF attached.
 * Failures are caught and logged - never throws.
 * @param args - Send inputs.
 * @param args.invoice - Invoice row fields needed for the body.
 * @param args.pdfBytes - Raw PDF bytes returned by `generateInvoicePdf`.
 * @param args.reviewUrl - Stable per-contact review URL, or null to omit the review line.
 * @param args.greetingName - Optional greeting target (forwarded to {@link buildInvoiceEmail}).
 * @param args.customBody - Optional intro replacement.
 * @returns True if the email was accepted by Resend, false on failure or misconfig.
 */
export async function sendInvoiceEmail({
  invoice,
  pdfBytes,
  reviewUrl,
  greetingName,
  customBody,
}: SendInvoiceEmailArgs): Promise<boolean> {
  const from = process.env.EMAIL_FROM;
  if (!from || !process.env.RESEND_API_KEY) {
    console.warn(
      `[email] Not configured (${missingEmailEnv("EMAIL_FROM", "RESEND_API_KEY")}) - skipping invoice email.`,
    );
    return false;
  }
  if (!invoice.clientEmail) {
    console.warn(`[email] Invoice ${invoice.number} has no clientEmail - skipping send.`);
    return false;
  }

  const { subject, html } = await buildInvoiceEmail({
    invoice,
    reviewUrl,
    greetingName,
    customBody,
  });
  try {
    await getResend().emails.send({
      from,
      replyTo: process.env.ADMIN_EMAIL,
      to: invoice.clientEmail,
      subject,
      html,
      attachments: [
        {
          filename: `${invoice.isQuote ? "Quote" : "Invoice"} ${invoice.number}.pdf`,
          content: Buffer.from(pdfBytes),
        },
      ],
    });
    return true;
  } catch (error) {
    console.error(`[email] Failed to send invoice ${invoice.number}:`, error);
    return false;
  }
}

interface SendInvoiceReminderEmailArgs {
  invoice: InvoiceEmailData;
  pdfBytes: Uint8Array;
  /** 1 for the first nudge, 2 for the second-and-final. Sets the tone. */
  reminderNumber: number;
}

/**
 * Sends an overdue-invoice nudge with the PDF attached. No review-link
 * machinery - chasing money and asking for a review don't mix. Never throws.
 * @param args - Send inputs.
 * @param args.invoice - Invoice row fields needed for the body.
 * @param args.pdfBytes - Raw PDF bytes (OVERDUE watermark already applied by the caller's generate).
 * @param args.reminderNumber - 1 or 2; the second says it's the last one.
 * @returns True if Resend accepted the message, false on failure or misconfig.
 */
export async function sendInvoiceReminderEmail({
  invoice,
  pdfBytes,
  reminderNumber,
}: SendInvoiceReminderEmailArgs): Promise<boolean> {
  const from = process.env.EMAIL_FROM;
  if (!from || !process.env.RESEND_API_KEY) {
    console.warn(
      `[email] Not configured (${missingEmailEnv("EMAIL_FROM", "RESEND_API_KEY")}) - skipping invoice reminder.`,
    );
    return false;
  }
  if (!invoice.clientEmail) {
    console.warn(`[email] Invoice ${invoice.number} has no clientEmail - skipping reminder.`);
    return false;
  }

  const siteUrl = getSiteUrl();
  const identity = await getIdentity();
  const { comms } = await getSettings();
  const greeting = escapeHtml((invoice.clientName.split(" ")[0] || invoice.clientName).trim());
  const safeNumber = escapeHtml(invoice.number);
  const dueDate = escapeHtml(formatDateShort(invoice.dueDate));
  const totalLabel = escapeHtml(formatNZD(invoice.total));
  const closing =
    reminderNumber >= comms.invoiceReminderMaxCount
      ? "This is the last automatic reminder I'll send. If something's holding payment up, just reply and we'll sort it out."
      : "If you've already paid in the last day or two, please ignore this - bank transfers can cross over.";

  const subject = `Friendly reminder - invoice ${invoice.number} (${totalLabel})`;
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:24px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0c0a3e;background:#f6f7f8">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:24px">
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0c0a3e">Hi ${greeting},</h1>

    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#333">Just a friendly nudge - invoice ${safeNumber} was due on ${dueDate} and hasn't come through yet. A copy is attached.</p>

    <div style="margin:0 0 16px;padding:12px 16px;background:#f3f4f6;border-radius:8px;font-size:14px;color:#333">
      <p style="margin:0 0 4px"><strong>Invoice:</strong> ${safeNumber}</p>
      <p style="margin:0 0 4px"><strong>Amount due:</strong> ${totalLabel}</p>
      <p style="margin:0"><strong>Was due:</strong> ${dueDate}</p>
    </div>

    <p style="margin:0 0 8px;font-size:14px;color:#333"><strong>Bank transfer:</strong></p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#333">
      Payee: ${escapeHtml(identity.name)}<br />
      Account: <strong>${escapeHtml(identity.bankAccount)}</strong><br />
      Reference: <strong>${safeNumber}</strong>
    </p>

    <p style="margin:0;font-size:14px;color:#333">${closing}</p>

    ${await buildEmailSignature(siteUrl)}
  </div>
</body>
</html>`;

  try {
    await getResend().emails.send({
      from,
      replyTo: process.env.ADMIN_EMAIL,
      to: invoice.clientEmail,
      subject,
      html,
      attachments: [
        {
          filename: `Invoice ${invoice.number}.pdf`,
          content: Buffer.from(pdfBytes),
        },
      ],
    });
    return true;
  } catch (error) {
    console.error(`[email] Failed to send reminder for invoice ${invoice.number}:`, error);
    return false;
  }
}

interface BuildVoidEmailArgs {
  invoice: InvoiceEmailData;
  greetingName?: string;
  customBody?: string;
}

/**
 * Renders the "your invoice has been voided" email subject + body. Mirrors
 * {@link buildInvoiceEmail} but drops the bank-transfer block and review line - voided
 * invoices never request payment or a review.
 * @param args - Render inputs.
 * @param args.invoice - Invoice row fields needed for the body.
 * @param args.greetingName - Optional operator-typed greeting target.
 * @param args.customBody - Optional override; falls back to {@link DEFAULT_VOID_EMAIL_BODY}.
 * @returns Subject + escaped HTML body.
 */
export async function buildVoidEmail({
  invoice,
  greetingName,
  customBody,
}: BuildVoidEmailArgs): Promise<{
  subject: string;
  html: string;
}> {
  const siteUrl = getSiteUrl();
  const bodyText = (customBody ?? DEFAULT_VOID_EMAIL_BODY).trim();
  const safeBody = escapeHtml(bodyText || DEFAULT_VOID_EMAIL_BODY);
  const trimmedOverride = greetingName?.trim();
  const greetingTarget =
    trimmedOverride || (invoice.clientName.split(" ")[0] || invoice.clientName).trim();
  const safeGreeting = escapeHtml(greetingTarget);
  const safeNumber = escapeHtml(invoice.number);
  const issueDate = escapeHtml(formatDateShort(invoice.issueDate));
  const totalLabel = escapeHtml(formatNZD(invoice.total));

  const subject = `Invoice ${invoice.number} - voided`;
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:24px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0c0a3e;background:#f6f7f8">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:24px">
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0c0a3e">Hi ${safeGreeting},</h1>

    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#333;white-space:pre-wrap">${safeBody}</p>

    <div style="margin:0 0 16px;padding:12px 16px;background:#f3f4f6;border-radius:8px;font-size:14px;color:#333">
      <p style="margin:0 0 4px"><strong>Voided invoice:</strong> ${safeNumber}</p>
      <p style="margin:0 0 4px"><strong>Original amount:</strong> ${totalLabel}</p>
      <p style="margin:0"><strong>Issued:</strong> ${issueDate}</p>
    </div>

    <p style="margin:0;font-size:14px;color:#333">Any questions, just reply.</p>

    ${await buildEmailSignature(siteUrl)}
  </div>
</body>
</html>`;

  return { subject, html };
}

interface SendVoidNotificationArgs {
  invoice: InvoiceEmailData;
  pdfBytes: Uint8Array;
  greetingName?: string;
  customBody?: string;
}

/**
 * Sends the void notification with the VOID-stamped PDF attached.
 * Logs + returns false on failure rather than throwing so the void endpoint
 * can report `notified: false` without rolling back the status change.
 * @param args - Send inputs.
 * @param args.invoice - Invoice row fields needed for the body.
 * @param args.pdfBytes - PDF bytes (already VOID-stamped).
 * @param args.greetingName - Optional greeting target.
 * @param args.customBody - Optional intro replacement.
 * @returns True if Resend accepted the email, false otherwise.
 */
export async function sendVoidNotification({
  invoice,
  pdfBytes,
  greetingName,
  customBody,
}: SendVoidNotificationArgs): Promise<boolean> {
  const from = process.env.EMAIL_FROM;
  if (!from || !process.env.RESEND_API_KEY) {
    console.warn(
      `[email] Not configured (${missingEmailEnv("EMAIL_FROM", "RESEND_API_KEY")}) - skipping void notification.`,
    );
    return false;
  }
  if (!invoice.clientEmail) {
    console.warn(
      `[email] Invoice ${invoice.number} has no clientEmail - skipping void notification.`,
    );
    return false;
  }

  const { subject, html } = await buildVoidEmail({ invoice, greetingName, customBody });
  try {
    // Resend SDK v3+ returns { data, error } instead of throwing on API-level
    // failures (invalid sender, rate limit, etc.). Check error explicitly so a
    // rejected call isn't silently reported as "Client notified".
    const result = await getResend().emails.send({
      from,
      replyTo: process.env.ADMIN_EMAIL,
      to: invoice.clientEmail,
      subject,
      html,
      attachments: [
        {
          filename: `Invoice ${invoice.number} VOIDED.pdf`,
          content: Buffer.from(pdfBytes),
        },
      ],
    });
    if (result.error) {
      console.error(
        `[email] Resend rejected void notification for ${invoice.number}:`,
        result.error,
      );
      return false;
    }
    console.log(
      `[email] Void notification sent for ${invoice.number}:`,
      result.data?.id ?? "(no id returned)",
    );
    return true;
  } catch (error) {
    console.error(`[email] Failed to send void notification for ${invoice.number}:`, error);
    return false;
  }
}

/** Business enquiry data used for the operator notification + enquirer ack. */
export interface BusinessEnquiryData {
  /** Company or trading name; null for a personal enquiry. */
  company: string | null;
  /** Contact person's name. */
  name: string;
  /** Contact email (reply-to target for the notification). */
  email: string;
  /** Contact phone in E.164, or null when not supplied. */
  phone: string | null;
  /** What they need help with (free text). */
  needs: string;
  /** Interest level: one-off job, retainer, or unsure. Optional. */
  interest: string | null;
  /** Urgency: this week / this month / exploring. Optional. */
  urgency: string | null;
}

/**
 * Sends the operator a notification email for a new business enquiry.
 * Failures are caught and logged - never throws.
 * @param enquiry - The enquiry details.
 * @returns Promise that resolves when the email is sent (or silently fails).
 */
export async function sendBusinessEnquiryNotification(enquiry: BusinessEnquiryData): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL;
  const from = process.env.EMAIL_FROM;

  if (!adminEmail || !from || !process.env.RESEND_API_KEY) {
    console.warn(
      `[email] Not configured (${missingEmailEnv("ADMIN_EMAIL", "EMAIL_FROM", "RESEND_API_KEY")}) - skipping business enquiry notification.`,
    );
    return;
  }

  const safeName = escapeHtml(enquiry.name);
  const safeEmail = escapeHtml(enquiry.email);
  const safeMailto = encodeURIComponent(enquiry.email);
  const needsHtml = escapeHtml(enquiry.needs).replace(/\n/g, "<br>");
  const companyBlock = enquiry.company
    ? `<p style="margin:0 0 4px;font-size:14px;color:#888">Company</p>
      <p style="margin:0 0 12px;font-size:15px;color:#0c0a3e;font-weight:600">${escapeHtml(enquiry.company)}</p>`
    : `<p style="margin:0 0 12px;font-size:14px;color:#888">Personal enquiry (no company)</p>`;
  const metaLine = [enquiry.interest, enquiry.urgency]
    .filter(Boolean)
    .map((v) => escapeHtml(v as string))
    .join(" · ");
  const phoneLine = enquiry.phone
    ? `<p style="margin:0 0 12px;font-size:14px;color:#444"><a href="tel:${escapeHtml(enquiry.phone)}" style="color:#43bccd">${escapeHtml(enquiry.phone)}</a></p>`
    : "";

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;background:#f6f7f8;margin:0;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.08)">
    <h2 style="margin:0 0 4px;color:#0c0a3e;font-size:20px">New business enquiry</h2>
    ${metaLine ? `<p style="margin:0 0 16px;color:#555;font-size:14px">${metaLine}</p>` : ""}

    <div style="background:#f6f7f8;border-radius:8px;padding:16px;margin-bottom:20px">
      ${companyBlock}
      <p style="margin:0 0 4px;font-size:14px;color:#888">Contact</p>
      <p style="margin:0 0 4px;font-size:15px;color:#0c0a3e;font-weight:600">${safeName}</p>
      <p style="margin:0 0 12px;font-size:14px;color:#444"><a href="mailto:${safeMailto}" style="color:#43bccd">${safeEmail}</a></p>
      ${phoneLine}
      <p style="margin:0 0 4px;font-size:14px;color:#888">What they need</p>
      <p style="margin:0;font-size:14px;color:#444;line-height:1.6">${needsHtml}</p>
    </div>
  </div>
</body>
</html>`;

  try {
    await getResend().emails.send({
      from,
      // Reply goes straight back to the enquirer, not the owner inbox.
      replyTo: enquiry.email,
      to: adminEmail,
      subject: enquiry.company
        ? `Business enquiry - ${enquiry.company} (${enquiry.name})`
        : `Business enquiry - ${enquiry.name} (personal)`,
      html,
    });
  } catch (error) {
    console.error("[email] Failed to send business enquiry notification:", error);
  }
}

/**
 * Sends the enquirer a short acknowledgement of their business enquiry.
 * Failures are caught and logged - never throws.
 * @param enquiry - The enquiry details.
 * @returns Promise that resolves when the email is sent (or silently fails).
 */
export async function sendBusinessEnquiryAck(enquiry: BusinessEnquiryData): Promise<void> {
  const from = process.env.EMAIL_FROM;
  const siteUrl = getSiteUrl();

  if (!from || !process.env.RESEND_API_KEY) {
    console.warn(
      `[email] Not configured (${missingEmailEnv("EMAIL_FROM", "RESEND_API_KEY")}) - skipping business enquiry ack.`,
    );
    return;
  }

  const firstName = enquiry.name.split(" ")[0];
  const safeFirstName = escapeHtml(firstName);
  // Personal enquiries thank the person directly rather than a company.
  const aboutTarget = enquiry.company ? ` for ${escapeHtml(enquiry.company)}` : "";
  const signature = await buildEmailSignature(siteUrl);

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;background:#f6f7f8;margin:0;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.08)">
    <h2 style="margin:0 0 16px;color:#0c0a3e;font-size:20px">Thanks for getting in touch</h2>
    <p style="margin:0 0 12px;color:#222;font-size:15px;line-height:1.6">Hi ${safeFirstName},</p>
    <p style="margin:0 0 12px;color:#222;font-size:15px;line-height:1.6">
      Thanks for your enquiry about IT support${aboutTarget}. I'll come back to you within
      one business day - usually sooner.
    </p>
    <p style="margin:0;color:#222;font-size:15px;line-height:1.6">
      If it's urgent, feel free to ring me directly.
    </p>
    ${signature}
  </div>
</body>
</html>`;

  try {
    await getResend().emails.send({
      from,
      replyTo: process.env.ADMIN_EMAIL,
      to: enquiry.email,
      subject: "Thanks for your enquiry - To The Point Tech",
      html,
    });
  } catch (error) {
    console.error("[email] Failed to send business enquiry ack:", error);
  }
}
