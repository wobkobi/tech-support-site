// src/features/reviews/lib/email-booking.ts
// Booking emails: owner notifications, customer confirmations, reminders and manage links.

import { buildAppointmentDescription, parseBookingNotes } from "@/features/booking/lib/booking";
import { buildIcs } from "@/features/booking/lib/ics";
import { cancellationCopy } from "@/features/business/lib/pricing-policy";
import { getPolicy } from "@/features/business/lib/pricing-policy.server";
import {
  brandName,
  buildEmailSignature,
  escapeHtml,
  htmlToText,
  missingEmailEnv,
  renderEmphasisedHtml,
  renderNotificationEmail,
  sendNow,
  sendOutreach,
  type MailPayload,
} from "@/features/reviews/lib/email-core";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { formatDateTimeLong } from "@/shared/lib/date-format";
import { getSiteUrl } from "@/shared/lib/site-url";

/** Why a booking email goes out: a new booking, a moved time, or an edit that kept the time. */
export type BookingEmailKind = "new" | "rescheduled" | "updated";

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
  /** Formatted notes (time slot, meeting type, address, phone, description) */
  notes: string;
  /** Appointment start (UTC) */
  startAt: Date;
  /** Appointment end (UTC) */
  endAt: Date;
  /** Cancel token for the cancel link */
  cancelToken: string;
  /** Promo title snapshotted at booking time, or null when none was active. */
  promoTitleAtBooking?: string | null;
  /** The days or times that promo covers ("Tuesdays 9am to 5pm"), or null when it has no limit. */
  promoWindowAtBooking?: string | null;
  /** Address with any unit; drives the map link and calendar LOCATION. Omit for remote jobs. */
  address?: string | null;
  /** Null on older bookings; only an explicit "remote" suppresses the address ({@link onSiteAddress}). */
  meetingType?: "in_person" | "remote" | null;
  /** How many times the booking has moved; becomes the calendar SEQUENCE. */
  rescheduleCount?: number;
  /** Parking, directions and other visit details from the booking form's second box. */
  accessNotes?: string | null;
}

/**
 * Amber promo panel for a booking email, or "" when there is nothing to say. A lapsed title
 * (a reschedule onto a day or time the offer doesn't cover) says so rather than going quiet.
 * @param booking - The booking being emailed about.
 * @param lapsedTitle - The offer the new time lost, when it lost one.
 * @returns HTML fragment.
 */
function promoPanel(booking: BookingNotificationData, lapsedTitle?: string | null): string {
  /**
   * Wraps a heading and a line in the amber panel.
   * @param heading - Bold first line, already escaped.
   * @param body - Second line, already escaped.
   * @returns HTML fragment.
   */
  const box = (heading: string, body: string): string =>
    `<div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:8px;padding:12px 16px;margin-bottom:16px"><p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#0c0a3e">🏷 ${heading}</p><p style="margin:0;font-size:13px;color:#444;line-height:1.5">${body}</p></div>`;
  if (booking.promoTitleAtBooking) {
    const windowNote = booking.promoWindowAtBooking
      ? ` It only covers ${escapeHtml(booking.promoWindowAtBooking)}, so moving to another day or time drops it.`
      : "";
    return box(
      `Rate locked in: ${escapeHtml(booking.promoTitleAtBooking)}`,
      `This offer applies to your appointment even if it ends before your visit.${windowNote}`,
    );
  }
  if (lapsedTitle) {
    return box(
      `${escapeHtml(lapsedTitle)} no longer applies`,
      "That offer doesn't cover your new day or time, so it won't come off this appointment.",
    );
  }
  return "";
}

/**
 * Grey "Other notes for the visit" panel for a booking email, or "" when there are none.
 * @param booking - The booking being emailed about.
 * @returns HTML fragment.
 */
function accessNotesPanel(booking: BookingNotificationData): string {
  const text = booking.accessNotes?.trim();
  if (!text) return "";
  return `<div style="background:#f6f7f8;border-radius:8px;padding:16px;margin-bottom:24px">
      <p style="margin:0 0 4px;font-size:13px;color:#888">Other notes for the visit</p>
      <p style="margin:0;font-size:14px;color:#444;line-height:1.6">${escapeHtml(text).replace(/\n/g, "<br>")}</p>
    </div>`;
}

/**
 * Cancellation copy from live settings, narrowed to the tier that binds this booking.
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
 * Maps link for the owner's emails only - the operator is the one driving there.
 * @param booking - The booking being emailed about.
 * @returns HTML paragraph, or "" when there's nothing to map.
 */
function ownerMapHtml(booking: BookingNotificationData): string {
  const address = onSiteAddress(booking);
  if (!address) return "";
  // Just the action - the notes block above already prints the full address.
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
      accessNotes: booking.accessNotes,
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
 * Sends the site owner a notification email for a new, rescheduled or edited booking.
 * Failures are caught and logged - never throws.
 * @param booking - The booking details.
 * @param options - Optional flags.
 * @param options.kind - "new" (default) for fresh bookings, "rescheduled" for a moved time,
 * "updated" for an edit that kept the time.
 * @param options.previousStartAt - Original start time, shown in the body when rescheduled.
 * @returns Promise that resolves when the email is sent (or silently fails).
 */
export async function sendOwnerBookingNotification(
  booking: BookingNotificationData,
  options?: { kind?: BookingEmailKind; previousStartAt?: Date },
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

  const heading =
    kind === "rescheduled"
      ? "🔄 Booking rescheduled"
      : kind === "updated"
        ? "Booking details changed"
        : "New booking";
  const subject =
    kind === "rescheduled"
      ? `🔄 Booking rescheduled - ${booking.name} (${start})`
      : kind === "updated"
        ? `Booking details changed - ${booking.name} (${start})`
        : `New booking - ${booking.name} (${start})`;
  const previousLine =
    kind === "rescheduled" && previous
      ? `<p style="margin:0 0 16px;color:#555;font-size:13px">Was: <s>${escapeHtml(previous)}</s></p>`
      : "";

  // Render the email body
  const html = renderNotificationEmail(`
    <h2 style="margin:0 0 4px;color:#0c0a3e;font-size:20px">${heading}</h2>
    <p style="margin:0 0 4px;color:#555;font-size:14px">${start}</p>
    ${previousLine}

    <div style="background:#f6f7f8;border-radius:8px;padding:16px;margin-bottom:20px">
      <p style="margin:0 0 4px;font-size:14px;color:#888">Customer</p>
      <p style="margin:0 0 12px;font-size:15px;color:#0c0a3e;font-weight:600">${safeName}</p>
      <p style="margin:0 0 12px;font-size:14px;color:#444"><a href="mailto:${safeMailto}" style="color:#43bccd">${safeEmail}</a></p>
      <p style="margin:0;font-size:14px;color:#444;line-height:1.6">${notesHtml}</p>
    </div>

    ${accessNotesPanel(booking)}

    ${ownerMapHtml(booking)}
`);

  // Send via Resend
  try {
    await sendNow({
      from,
      // Reply goes to the customer who booked, not back to the owner inbox.
      replyTo: booking.email,
      to: adminEmail,
      subject,
      html,
      text: htmlToText(html),
    });
  } catch (error) {
    console.error("[email] Failed to send owner booking notification:", error);
  }
}

/**
 * Tells the owner a customer has cancelled. Failures are caught and logged - never throws.
 * @param booking - The cancelled booking's details.
 * @param options - Optional flags.
 * @param options.lateCancellation - True when the cancel landed inside the fee window.
 * @returns Promise that resolves when the email is sent (or silently fails).
 */
export async function sendOwnerBookingCancellation(
  booking: BookingNotificationData,
  options?: { lateCancellation?: boolean },
): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL;
  const from = process.env.EMAIL_FROM;

  if (!adminEmail || !from || !process.env.RESEND_API_KEY) {
    console.warn(
      `[email] Not configured (${missingEmailEnv("ADMIN_EMAIL", "EMAIL_FROM", "RESEND_API_KEY")}) - skipping owner cancellation notification.`,
    );
    return;
  }

  const start = formatDateTimeLong(booking.startAt);
  const safeName = escapeHtml(booking.name);
  const safeEmail = escapeHtml(booking.email);
  const safeMailto = encodeURIComponent(booking.email);
  const lateLine = options?.lateCancellation
    ? `<p style="margin:0 0 16px;color:#c1440e;font-size:13px">Inside the fee window - a draft cancellation invoice was created.</p>`
    : "";

  const html = renderNotificationEmail(`
    <h2 style="margin:0 0 4px;color:#0c0a3e;font-size:20px">Booking cancelled</h2>
    <p style="margin:0 0 4px;color:#555;font-size:14px">Was: <s>${escapeHtml(start)}</s></p>
    ${lateLine}

    <div style="background:#f6f7f8;border-radius:8px;padding:16px;margin-bottom:20px">
      <p style="margin:0 0 4px;font-size:14px;color:#888">Customer</p>
      <p style="margin:0 0 12px;font-size:15px;color:#0c0a3e;font-weight:600">${safeName}</p>
      <p style="margin:0;font-size:14px;color:#444"><a href="mailto:${safeMailto}" style="color:#43bccd">${safeEmail}</a></p>
    </div>
`);

  try {
    await sendNow({
      from,
      // Reply goes to the customer who cancelled, not back to the owner inbox.
      replyTo: booking.email,
      to: adminEmail,
      subject: `Booking cancelled - ${booking.name} (${start})`,
      html,
      text: htmlToText(html),
    });
  } catch (error) {
    console.error("[email] Failed to send owner cancellation notification:", error);
  }
}

/**
 * Sends the customer a booking confirmation, reschedule or edit notice.
 * Failures are caught and logged - never throws.
 * @param booking - The booking details.
 * @param options - Optional flags.
 * @param options.kind - "new" (default) for a fresh booking, "rescheduled" for a moved time,
 * "updated" for an edit that kept the time (no calendar file: the invite hasn't changed).
 * @param options.previousStartAt - Original start time, shown crossed-out when rescheduled.
 * @param options.quietHours - Hold for the quiet window. Set only by operator-driven
 * moves; customer self-service confirmations stay immediate.
 * @param options.lapsedPromoTitle - The offer a reschedule lost because the new time falls
 * outside its days or times, so the email says it no longer applies.
 */
export async function sendCustomerBookingConfirmation(
  booking: BookingNotificationData,
  options?: {
    kind?: BookingEmailKind;
    previousStartAt?: Date;
    quietHours?: boolean;
    lapsedPromoTitle?: string | null;
  },
): Promise<void> {
  const send = options?.quietHours
    ? (payload: MailPayload) => sendOutreach(payload, booking.id)
    : sendNow;
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
  const firstName = booking.name.split(" ")[0] ?? "";
  const safeFirstName = escapeHtml(firstName);
  const start = formatDateTimeLong(booking.startAt);
  const previous = options?.previousStartAt ? formatDateTimeLong(options.previousStartAt) : null;
  const cancelUrl = `${siteUrl}/booking/cancel?token=${encodeURIComponent(booking.cancelToken)}`;
  const editUrl = `${siteUrl}/booking/edit?token=${encodeURIComponent(booking.cancelToken)}`;
  // Only the customer's own words; the rest of the notes blob repeats lines shown above.
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
      : kind === "updated"
        ? `Changes saved, ${safeFirstName}`
        : `Booking confirmed, ${safeFirstName}!`;
  const identity = await getIdentity();
  const intro =
    kind === "rescheduled"
      ? "Your appointment has been rescheduled. The Google Calendar invite has been updated to match."
      : kind === "updated"
        ? "I've saved the changes to your booking. Your appointment time is the same."
        : `Thanks for choosing ${escapeHtml(brandName(identity))} - I'm looking forward to helping you out.`;
  const subject =
    kind === "rescheduled"
      ? `🔄 Appointment updated - ${start}`
      : kind === "updated"
        ? `Booking details updated - ${start}`
        : `Booking confirmed - ${start}`;
  const previousLine =
    kind === "rescheduled" && previous
      ? `<p style="margin:0 0 20px;color:#888;font-size:13px"><s>${escapeHtml(previous)}</s></p>`
      : "";
  // A second file with an unchanged SEQUENCE is ignored or added twice by calendar apps.
  const attachments = kind === "updated" ? undefined : await bookingIcsAttachment(booking);
  const promoLine = promoPanel(booking, options?.lapsedPromoTitle);

  // Render the email body
  const html = renderNotificationEmail(`
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

    ${accessNotesPanel(booking)}

    <p style="margin:0 0 20px;color:#444;font-size:14px;line-height:1.6">
      Need to change anything? Use the buttons below, or just reply to this email.
    </p>

    <a href="${editUrl}" style="display:inline-block;background:#43bccd;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:13px;font-weight:600;margin:0 8px 10px 0">✏️ Change appointment</a>
    <a href="${cancelUrl}" style="display:inline-block;background:#e8e8e8;color:#333;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:13px;font-weight:600;margin:0 0 10px">❌ Cancel appointment</a>

    <p style="margin:28px 0 6px;color:#888;font-size:13px;text-transform:uppercase;letter-spacing:.05em;font-weight:600">Cancellation policy</p>
    <p style="margin:0;color:#444;font-size:13px;line-height:1.6">${renderEmphasisedHtml(cancellationText)}</p>
${await buildEmailSignature(siteUrl)}
`);

  // Send via Resend
  try {
    const result = await send({
      from,
      replyTo: process.env.ADMIN_EMAIL,
      to: booking.email,
      subject,
      html,
      text: htmlToText(html),
      attachments,
    });
    if (result.error) {
      console.error(`[email] Resend rejected confirmation for ${booking.id}:`, result.error);
    }
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
  const firstName = booking.name.split(" ")[0] ?? "";
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
  const identity = await getIdentity();
  const promoLine = promoPanel(booking);
  const attachments = await bookingIcsAttachment(booking);

  // "Tomorrow" wording assumes comms.reminderLeadHours stays near 24h.
  const html = renderNotificationEmail(`
    <h2 style="margin:0 0 12px;color:#0c0a3e;font-size:20px">Hi ${safeFirstName}, just a reminder</h2>
    <p style="margin:0 0 20px;color:#444;line-height:1.6">Your appointment with ${escapeHtml(brandName(identity))} is coming up tomorrow.</p>

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

    ${accessNotesPanel(booking)}

    <p style="margin:0 0 20px;color:#444;font-size:14px;line-height:1.6">
      Need to change anything? Use the buttons below, or just reply to this email.
    </p>

    <a href="${editUrl}" style="display:inline-block;background:#43bccd;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:13px;font-weight:600;margin:0 8px 10px 0">✏️ Change appointment</a>
    <a href="${cancelUrl}" style="display:inline-block;background:#e8e8e8;color:#333;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:13px;font-weight:600;margin:0 0 10px">❌ Cancel appointment</a>

    <p style="margin:28px 0 6px;color:#888;font-size:13px;text-transform:uppercase;letter-spacing:.05em;font-weight:600">Cancellation policy</p>
    <p style="margin:0;color:#444;font-size:13px;line-height:1.6">${renderEmphasisedHtml(cancellationText)}</p>
${await buildEmailSignature(siteUrl)}
`);

  // Send via Resend
  try {
    const result = await sendOutreach(
      {
        from,
        replyTo: process.env.ADMIN_EMAIL,
        to: booking.email,
        subject: `Reminder: appointment tomorrow - ${start}`,
        html,
        text: htmlToText(html),
        attachments,
      },
      booking.id,
    );
    // Resend rejects with { error }, not a throw; returning true would stop the cron retrying.
    if (result.error) {
      console.error(`[email] Resend rejected reminder for ${booking.id}:`, result.error);
      return false;
    }
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
 * Emails manage links after a find-my-booking lookup. Safe to carry tokens: only
 * sent to the address that owns the bookings.
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
  const html = renderNotificationEmail(`
    <h2 style="margin:0 0 12px;color:#0c0a3e;font-size:20px">Your upcoming ${plural}</h2>
    <p style="margin:0 0 20px;color:#444;line-height:1.6">Here are the links to change or cancel. If you didn't ask for this email you can safely ignore it.</p>
    ${rows}
    <p style="margin:20px 0 0;color:#444;font-size:14px;line-height:1.6">Prefer to talk it through? Just reply to this email.</p>
${await buildEmailSignature(siteUrl)}
`);

  try {
    await sendNow({
      from,
      replyTo: process.env.ADMIN_EMAIL,
      to,
      subject: `Your upcoming ${plural}`,
      html,
      text: htmlToText(html),
    });
    return true;
  } catch (error) {
    console.error("[email] Failed to send manage-links email:", error);
    return false;
  }
}
