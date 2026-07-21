// src/app/api/business/invoices/[id]/send-reminder/route.ts
// Manual "Send reminder" - same send-and-stamp as the cron, but NOT capped at
// two (the cap limits the robot, not the operator).

import { sendOverdueReminder } from "@/features/business/lib/invoice-reminders";
import { isInvoiceOverdue } from "@/features/business/lib/invoice-status";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * POST /api/business/invoices/[id]/send-reminder
 * @param request - Incoming request (admin-gated).
 * @param context - Route context carrying the invoice id param.
 * @param context.params - Promise resolving to `{ id }`.
 * @returns `{ ok, reminderNumber }` on success; 404 unknown; 409 when the
 *   invoice isn't a SENT invoice past its due date.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) return errorResponse("Invoice not found", 404);

  if (invoice.status !== "SENT" || !isInvoiceOverdue(invoice)) {
    return errorResponse("Only overdue SENT invoices can be chased.", 409);
  }

  const res = await sendOverdueReminder(invoice);
  if (!res.ok) return errorResponse(res.error ?? "Reminder failed", 502);

  return NextResponse.json({ ok: true, reminderNumber: res.reminderNumber });
}
