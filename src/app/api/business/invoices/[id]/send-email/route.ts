// src/app/api/business/invoices/[id]/send-email/route.ts
import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { sendInvoiceEmail } from "@/features/reviews/lib/email";
import { getInvoiceReviewEligibility } from "@/features/business/lib/contact-review-token";
import { extractYearCode, generateInvoicePdf } from "@/features/business/lib/invoice-pdf";
import { uploadInvoicePdf } from "@/features/business/lib/google-drive";

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

  const { id } = await ctx.params;
  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }
  if (!invoice.clientEmail) {
    return NextResponse.json({ error: "Invoice has no client email" }, { status: 400 });
  }

  // Optional operator overrides (match the preview):
  // - greetingName: target a specific person inside a company invoice
  // - customBody: replace the default intro paragraph
  // - includeReview: explicit yes/no for the review link. When omitted we
  //   default to whatever eligibility says (canSend ? include : skip).
  const body = (await request.json().catch(() => ({}))) as {
    greetingName?: unknown;
    customBody?: unknown;
    includeReview?: unknown;
  };
  const greetingName = typeof body.greetingName === "string" ? body.greetingName : undefined;
  const customBody = typeof body.customBody === "string" ? body.customBody : undefined;
  const includeReviewOverride =
    typeof body.includeReview === "boolean" ? body.includeReview : undefined;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tothepoint.co.nz";
  const eligibility = await getInvoiceReviewEligibility({
    contactId: invoice.contactId,
    clientEmail: invoice.clientEmail,
    siteUrl,
  });

  // Server-side gate: if the customer is in cooldown or already reviewed, an
  // explicit `includeReview: true` from a stale client is ignored - the UI
  // blocks the checkbox but we shouldn't trust client state.
  const includeReview = (includeReviewOverride ?? eligibility.canSend) && eligibility.canSend;
  const reviewUrl =
    includeReview && "reviewUrl" in eligibility ? (eligibility.reviewUrl ?? null) : null;

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

  // Stamp reviewLinkSentAt iff we actually included the review line. This is
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
  // Failures are logged but don't fail the request — the email is the critical path.
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
