// src/app/api/business/invoices/[id]/send-email/route.ts
// Admin endpoint that emails an invoice to the client. POST re-generates the PDF, sends
// it, flips a draft to SENT, stamps sentAt (which starts the review-ask clock), cancels
// the review ask when the operator unticked it, and re-syncs the PDF to Drive. A changed
// send-to address replaces the invoice's email, becomes the contact's primary email and
// reopens a review ask that already went to the old address.

import { syncInvoicePdfToDrive } from "@/features/business/lib/invoice-drive-sync";
import {
  parseInvoiceEmailOverrides,
  toInvoiceEmailPayload,
} from "@/features/business/lib/invoice-email-request";
import { generateInvoicePdf, serialiseInvoice } from "@/features/business/lib/invoice-pdf";
import { sendInvoiceEmail } from "@/features/reviews/lib/email-invoice";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { normaliseEmail } from "@/shared/lib/normalise-email";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/** Same shape check the contact editor uses: something@domain.tld, no spaces. */
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

/**
 * Makes a send-to address that worked the contact's primary email, keeping the old
 * primary in altEmails so bookings and reviews under it still match. The contact is the
 * invoice's linked one, else the live contact holding the invoice's stored email. The
 * normal update bumps updatedAt, so the next contact sync pushes the change to Google.
 * Best-effort - the email has already gone.
 * @param contactId - Invoice.contactId, if linked.
 * @param invoiceEmail - Invoice.clientEmail, used to find an unlinked contact.
 * @param newEmail - Normalised address the invoice was just sent to.
 */
async function promoteContactEmail(
  contactId: string | null,
  invoiceEmail: string,
  newEmail: string,
): Promise<void> {
  try {
    const select = { id: true, email: true, altEmails: true } as const;
    const oldEmail = normaliseEmail(invoiceEmail);
    const contact = contactId
      ? await prisma.contact.findFirst({ where: { id: contactId, deletedAt: null }, select })
      : oldEmail
        ? await prisma.contact.findFirst({
            where: {
              deletedAt: null,
              OR: [
                { email: { equals: oldEmail, mode: "insensitive" } },
                { altEmails: { has: oldEmail } },
              ],
            },
            select,
          })
        : null;
    if (!contact) return;

    const primary = normaliseEmail(contact.email);
    if (primary === newEmail) return;
    const altEmails = [...new Set([primary, ...contact.altEmails.map(normaliseEmail)])].filter(
      (e) => e && e !== newEmail,
    );
    await prisma.contact.update({
      where: { id: contact.id },
      data: { email: newEmail, altEmails: { set: altEmails } },
    });
  } catch (err) {
    console.error(`[invoice-email] Could not add ${newEmail} to the contact:`, err);
  }
}

/**
 * POST /api/business/invoices/[id]/send-email
 * Re-generates the invoice PDF, emails it to the client, and flips a draft to SENT.
 * @param request - Next.js request (admin-auth gated).
 * @param ctx - Route ctx with the invoice id.
 * @param ctx.params - Resolved Next.js dynamic route params.
 * @returns JSON with `{ ok, sentAt }` or an error.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  // Load the invoice
  const { id } = await ctx.params;
  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) {
    return errorResponse("Invoice not found", 404);
  }
  // A voided invoice is cancelled; emailing its PDF (and flipping it back to
  // SENT) would resurrect a terminal record. Issue a fresh invoice instead.
  if (invoice.status === "VOIDED") {
    return errorResponse("Cannot email a voided invoice; issue a new one instead.", 409);
  }

  // Optional operator overrides (match the preview): greetingName targets a
  // person inside a company invoice, customBody replaces the intro paragraph,
  // reviewAsk false cancels the automatic review ask, toEmail sends this one
  // email somewhere other than the stored clientEmail.
  const { greetingName, customBody, reviewAsk, toEmail } =
    await parseInvoiceEmailOverrides(request);
  if (toEmail && !EMAIL_RE.test(toEmail)) {
    return errorResponse("That send-to address doesn't look like an email", 400);
  }
  // A new address replaces the stored one from here on: the PDF, Drive copy, overdue
  // reminders and the review ask all read Invoice.clientEmail.
  const newEmail = toEmail && toEmail !== normaliseEmail(invoice.clientEmail) ? toEmail : null;
  const sending = newEmail ? { ...invoice, clientEmail: newEmail } : invoice;
  if (!sending.clientEmail) {
    return errorResponse("Invoice has no client email", 400);
  }

  // Generate the invoice PDF
  let pdfBytes: Buffer;
  try {
    pdfBytes = await generateInvoicePdf(serialiseInvoice(sending));
  } catch (err) {
    console.error(`[invoice-email] PDF generation failed for ${invoice.number}:`, err);
    return errorResponse("PDF generation failed", 500);
  }

  // Send the email
  const ok = await sendInvoiceEmail({
    invoice: await toInvoiceEmailPayload(sending),
    pdfBytes,
    greetingName,
    customBody,
  });
  if (!ok) {
    return errorResponse("Email send failed", 502);
  }

  // Status only ever moves DRAFT > SENT; a re-sent SENT or PAID invoice (a receipt copy)
  // must not regress. sentAt is stamped on the first email whatever the status, so a
  // receipt for an invoice paid on the day still starts the review-ask clock. The
  // unticked box only cancels an ask that is still open on a real invoice. A review ask
  // that already went to the old address is reopened, so the next review-ask run sends it
  // again to the new one (its due date has passed, so it goes on that run).
  const now = new Date();
  const cancelAsk = reviewAsk === false && !invoice.isQuote && !invoice.reviewAskOutcome;
  const reopenAsk = !!newEmail && invoice.reviewAskOutcome === "sent";
  const updated = await prisma.invoice.update({
    where: { id },
    data: {
      ...(invoice.status === "DRAFT" ? { status: "SENT" } : {}),
      ...(invoice.sentAt ? {} : { sentAt: now }),
      ...(cancelAsk
        ? { reviewAskOutcome: "cancelled", reviewAskNote: "unticked", reviewAskDecidedAt: now }
        : {}),
      ...(newEmail
        ? { clientEmail: newEmail, resentAt: now, resentFromEmail: invoice.clientEmail || null }
        : {}),
      ...(reopenAsk
        ? {
            reviewAskOutcome: null,
            reviewAskNote: null,
            reviewAskDecidedAt: null,
            reviewLinkSentAt: null,
          }
        : {}),
    },
    select: { updatedAt: true, sentAt: true },
  });

  // Sync the freshly-sent PDF to Drive so the archive matches what the client
  // received. Best-effort - the email is the critical path.
  await syncInvoicePdfToDrive(sending, pdfBytes, "[invoice-email]");

  if (newEmail) {
    await promoteContactEmail(invoice.contactId, invoice.clientEmail, newEmail);
  }

  // Return the real sentAt (falling back to updatedAt for legacy SENT rows that
  // predate the sentAt column).
  return NextResponse.json({
    ok: true,
    sentAt: (updated.sentAt ?? updated.updatedAt).toISOString(),
  });
}
