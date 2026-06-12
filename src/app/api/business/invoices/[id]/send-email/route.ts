// src/app/api/business/invoices/[id]/send-email/route.ts
import { getInvoiceReviewEligibility } from "@/features/business/lib/contact-review-token";
import { uploadInvoicePdf } from "@/features/business/lib/google-drive";
import { extractYearCode, generateInvoicePdf } from "@/features/business/lib/invoice-pdf";
import { sendInvoiceEmail } from "@/features/reviews/lib/email";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { getSiteUrl } from "@/shared/lib/site-url";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * POST /api/business/invoices/[id]/send-email
 * Re-generates the invoice PDF, emails it to the client (with the friendly
 * review link in the body), and flips the invoice status to SENT.
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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Load the invoice
  const { id } = await ctx.params;
  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }
  if (!invoice.clientEmail) {
    return NextResponse.json({ error: "Invoice has no client email" }, { status: 400 });
  }

  // Optional operator overrides (match the preview): greetingName targets a
  // person inside a company invoice, customBody replaces the intro paragraph,
  // includeReview forces the review link on/off (defaults to eligibility).
  const body = (await request.json().catch(() => ({}))) as {
    greetingName?: unknown;
    customBody?: unknown;
    includeReview?: unknown;
  };
  const greetingName = typeof body.greetingName === "string" ? body.greetingName : undefined;
  const customBody = typeof body.customBody === "string" ? body.customBody : undefined;
  const includeReviewOverride =
    typeof body.includeReview === "boolean" ? body.includeReview : undefined;

  // Check review-link eligibility
  const siteUrl = getSiteUrl();
  const eligibility = await getInvoiceReviewEligibility({
    contactId: invoice.contactId,
    clientEmail: invoice.clientEmail,
    siteUrl,
  });

  // Server-side gate: if the customer is in cooldown or already reviewed, an
  // explicit `includeReview: true` from a stale client is ignored - the UI
  // blocks the checkbox but client state is not trusted.
  const includeReview = (includeReviewOverride ?? eligibility.canSend) && eligibility.canSend;
  const reviewUrl =
    includeReview && "reviewUrl" in eligibility ? (eligibility.reviewUrl ?? null) : null;

  // Generate the invoice PDF
  let pdfBytes: Buffer;
  try {
    pdfBytes = await generateInvoicePdf({
      ...invoice,
      issueDate: invoice.issueDate.toISOString(),
      dueDate: invoice.dueDate.toISOString(),
      createdAt: invoice.createdAt.toISOString(),
      updatedAt: invoice.updatedAt.toISOString(),
    });
  } catch (err) {
    console.error(`[invoice-email] PDF generation failed for ${invoice.number}:`, err);
    return NextResponse.json({ error: "PDF generation failed" }, { status: 500 });
  }

  // Send the email
  const ok = await sendInvoiceEmail({
    invoice: {
      number: invoice.number,
      clientName: invoice.clientName,
      clientEmail: invoice.clientEmail,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      total: invoice.total,
      driveWebUrl: invoice.driveWebUrl,
    },
    pdfBytes,
    reviewUrl,
    greetingName,
    customBody,
  });
  if (!ok) {
    return NextResponse.json({ error: "Email send failed" }, { status: 502 });
  }

  // Stamp reviewLinkSentAt iff the review line was actually included. This is
  // what powers the 30-day cooldown for invoice-to-invoice sends in
  // getInvoiceReviewEligibility. Resending the same invoice with the toggle
  // still on re-stamps it; sending with the toggle off leaves it alone (the
  // last actual send timestamp stands).
  const updated = await prisma.invoice.update({
    where: { id },
    data: {
      status: "SENT",
      ...(includeReview ? { reviewLinkSentAt: new Date() } : {}),
    },
    select: { updatedAt: true },
  });

  // Sync the freshly-sent PDF to Drive so the archive matches what the client received.
  // Failures are logged but don't fail the request - the email is the critical path.
  try {
    const yearCode = extractYearCode(invoice.number);
    const drive = await uploadInvoicePdf(
      pdfBytes,
      invoice.number,
      yearCode,
      invoice.driveFileId ?? undefined,
    );
    if (drive.fileId !== invoice.driveFileId || drive.webUrl !== invoice.driveWebUrl) {
      await prisma.invoice.update({
        where: { id },
        data: { driveFileId: drive.fileId, driveWebUrl: drive.webUrl },
      });
    }
  } catch (err) {
    console.error(`[invoice-email] Drive sync failed for ${invoice.number}:`, err);
  }

  return NextResponse.json({ ok: true, sentAt: updated.updatedAt.toISOString() });
}
