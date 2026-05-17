// src/app/api/business/invoices/[id]/preview-email/route.ts
import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { buildInvoiceEmail } from "@/features/reviews/lib/email";
import { resolveInvoiceReviewUrl } from "@/features/business/lib/contact-review-token";

/**
 * POST /api/business/invoices/[id]/preview-email
 * Returns the rendered subject + HTML body for the invoice email so the
 * operator can review it in a modal before sending. No email is sent.
 * @param request - Next.js request (admin-auth gated).
 * @param ctx - Route ctx with the invoice id.
 * @param ctx.params - Resolved Next.js dynamic route params.
 * @returns JSON with `{ ok, subject, html }` or an error.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  // Optional operator overrides:
  // - greetingName: target a specific person when the invoice is for a company
  // - customBody: replace the default intro paragraph with a per-send message
  const body = (await request.json().catch(() => ({}))) as {
    greetingName?: unknown;
    customBody?: unknown;
  };
  const greetingName = typeof body.greetingName === "string" ? body.greetingName : undefined;
  const customBody = typeof body.customBody === "string" ? body.customBody : undefined;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tothepoint.co.nz";
  const reviewUrl = await resolveInvoiceReviewUrl({
    contactId: invoice.contactId,
    clientEmail: invoice.clientEmail,
    siteUrl,
  });

  const { subject, html } = buildInvoiceEmail({
    invoice: {
      number: invoice.number,
      clientName: invoice.clientName,
      clientEmail: invoice.clientEmail,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      total: invoice.total,
      driveWebUrl: invoice.driveWebUrl,
    },
    reviewUrl,
    greetingName,
    customBody,
  });

  return NextResponse.json({ ok: true, subject, html, to: invoice.clientEmail });
}
