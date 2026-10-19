// src/app/api/business/invoices/[id]/send-email/route.ts
// Emails an invoice: flips a draft to SENT and stamps sentAt (starting the review-ask
// clock). A changed send-to address replaces the invoice's and the contact's email.

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
 * Make a send-to address that worked the contact's primary email, keeping the old one in
 * altEmails so its bookings still match. Best-effort - the email has already gone.
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

  const { id } = await ctx.params;
  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) {
    return errorResponse("Invoice not found", 404);
  }
  // Emailing a voided invoice would resurrect a terminal record.
  if (invoice.status === "VOIDED") {
    return errorResponse("Cannot email a voided invoice; issue a new one instead.", 409);
  }

  // Overrides match the preview; reviewAsk false cancels the ask, toEmail redirects the send.
  const { greetingName, customBody, reviewAsk, toEmail } =
    await parseInvoiceEmailOverrides(request);
  if (toEmail && !EMAIL_RE.test(toEmail)) {
    return errorResponse("That send-to address doesn't look like an email", 400);
  }
  // A new address replaces the stored one; everything downstream reads Invoice.clientEmail.
  const newEmail = toEmail && toEmail !== normaliseEmail(invoice.clientEmail) ? toEmail : null;
  const sending = newEmail ? { ...invoice, clientEmail: newEmail } : invoice;
  if (!sending.clientEmail) {
    return errorResponse("Invoice has no client email", 400);
  }

  let pdfBytes: Buffer;
  try {
    pdfBytes = await generateInvoicePdf(serialiseInvoice(sending));
  } catch (err) {
    console.error(`[invoice-email] PDF generation failed for ${invoice.number}:`, err);
    return errorResponse("PDF generation failed", 500);
  }

  const ok = await sendInvoiceEmail({
    invoice: await toInvoiceEmailPayload(sending),
    pdfBytes,
    greetingName,
    customBody,
  });
  if (!ok) {
    return errorResponse("Email send failed", 502);
  }

  // Status only moves DRAFT > SENT; sentAt stamps on the first email whatever the status,
  // so a same-day receipt still starts the review-ask clock. A review ask already sent to
  // the old address is reopened so the next run re-sends it.
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

  // Best-effort - the email is the critical path.
  await syncInvoicePdfToDrive(sending, pdfBytes, "[invoice-email]");

  if (newEmail) {
    await promoteContactEmail(invoice.contactId, invoice.clientEmail, newEmail);
  }

  // updatedAt covers SENT rows that predate the sentAt column.
  return NextResponse.json({
    ok: true,
    sentAt: (updated.sentAt ?? updated.updatedAt).toISOString(),
  });
}
