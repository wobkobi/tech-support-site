// src/app/api/business/invoices/[id]/pay/route.ts
/**
 * @description Records a payment against an invoice: atomically claims the PAID
 * stamp (idempotent under double-clicks / retries), creates or updates the
 * linked income-ledger entry, and re-syncs the PAID-watermarked PDF to Drive.
 * The DB stamp is authoritative; the income + Drive steps are best-effort and
 * never roll back the payment.
 */

import { INCOME_METHODS } from "@/features/business/lib/constants";
import { recordIncome } from "@/features/business/lib/income-recording";
import { syncInvoicePdfToDriveById } from "@/features/business/lib/invoice-drive-sync";
import {
  formatDateForSheet,
  resolveSheetIdForDate,
  updateRowBySyncId,
} from "@/features/business/lib/sheets-sync";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so the awaited Drive re-upload can't 504.
export const maxDuration = 60;

/**
 * POST /api/business/invoices/[id]/pay
 * Body: `{ paidAt?, method, reference?, createIncome? }`. `method` must be an
 * INCOME_METHODS value; `paidAt` defaults to now; `createIncome` defaults true
 * except on an already-PAID invoice (where a non-dialog caller must not silently
 * create a second ledger row).
 * @param request - Next.js request (admin-auth gated).
 * @param ctx - Route ctx with the invoice id.
 * @param ctx.params - Resolved Next.js dynamic route params.
 * @returns JSON `{ ok, invoice, incomeEntry, incomeAction, sheetWarning }` or an error.
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
  if (!invoice) return errorResponse("Invoice not found", 404);
  if (invoice.status === "VOIDED") {
    return errorResponse("Cannot record payment on a voided invoice.", 409);
  }

  const body = (await request.json().catch(() => ({}))) as {
    paidAt?: unknown;
    method?: unknown;
    reference?: unknown;
    createIncome?: unknown;
  };
  const method = typeof body.method === "string" ? body.method : "";
  if (!(INCOME_METHODS as readonly string[]).includes(method)) {
    return errorResponse("Invalid payment method", 400);
  }
  const paidAt =
    typeof body.paidAt === "string" && body.paidAt ? new Date(body.paidAt) : new Date();
  if (Number.isNaN(paidAt.getTime())) return errorResponse("Invalid paidAt date", 400);
  const reference =
    typeof body.reference === "string" && body.reference.trim() ? body.reference.trim() : null;
  const alreadyPaid = invoice.status === "PAID";
  // Defaults true, but false on an already-PAID invoice so a non-dialog caller
  // can't double-count a ledger row that was entered by hand.
  const createIncome = typeof body.createIncome === "boolean" ? body.createIncome : !alreadyPaid;

  // Atomic claim: stamp the payment only where paidAt is still null. Covers a
  // fresh payment (status flips to PAID) and a backfill onto a legacy PAID row
  // (paidAt still null). A concurrent double-click or a re-pay finds paidAt
  // already set > count 0 > returns current state without a second income row.
  const claim = await prisma.invoice.updateMany({
    where: { id, paidAt: null },
    data: { status: "PAID", paidAt, paymentMethod: method, paymentReference: reference },
  });
  if (claim.count !== 1) {
    const current = await prisma.invoice.findUnique({ where: { id } });
    const existing = await prisma.incomeEntry.findFirst({ where: { invoiceId: id } });
    return NextResponse.json({
      ok: true,
      invoice: current,
      incomeEntry: existing,
      incomeAction: "skipped",
    });
  }

  // Income step (only the claim winner reaches here).
  const existingIncome = await prisma.incomeEntry.findFirst({ where: { invoiceId: id } });
  let incomeEntry = existingIncome;
  let incomeAction: "created" | "updated" | "skipped" = "skipped";
  let sheetWarning = false;

  if (existingIncome) {
    // Update ONLY the fields the dialog collects (date, method, reference note);
    // never amount/customer/description, which the operator may have edited in
    // the ledger or the sheet.
    incomeEntry = await prisma.incomeEntry.update({
      where: { id: existingIncome.id },
      data: { date: paidAt, method, notes: reference },
    });
    // Write those fields through to the existing sheet row (no new row). Null
    // cells preserve the sheet's customer/description/amount.
    try {
      const spreadsheetId = await resolveSheetIdForDate(incomeEntry.date);
      if (!spreadsheetId) {
        sheetWarning = true;
      } else if (incomeEntry.sheetRowKey) {
        const cells: (string | number | null)[] = [
          formatDateForSheet(incomeEntry.date), // A: date
          null, // B: customer - preserve
          null, // C: description - preserve
          incomeEntry.method, // D: method
          null, // E: amount - preserve
          null, // F: sheet-managed
          null, // G: sheet-managed
          incomeEntry.notes ?? "", // H: notes / reference
        ];
        const result = await updateRowBySyncId(
          spreadsheetId,
          "Cashbook",
          incomeEntry.sheetRowKey,
          cells,
        );
        if (result.syncId !== incomeEntry.sheetRowKey) {
          incomeEntry = await prisma.incomeEntry.update({
            where: { id: incomeEntry.id },
            data: { sheetRowKey: result.syncId },
          });
        }
      }
    } catch (err) {
      console.error(`[invoice-pay] Sheet write-through failed for income ${incomeEntry.id}:`, err);
      sheetWarning = true;
    }
    incomeAction = "updated";
  } else if (createIncome) {
    const result = await recordIncome({
      date: paidAt,
      customer: invoice.clientName,
      description: `Invoice ${invoice.number}`,
      amount: invoice.total,
      method,
      notes: reference,
      invoiceId: id,
    });
    incomeEntry = result.entry;
    sheetWarning = result.sheetSyncWarning;
    incomeAction = "created";
  }

  // Re-sync the PAID-watermarked PDF to Drive (awaited; best-effort).
  await syncInvoicePdfToDriveById(id, "[invoice-pay]");

  const updated = await prisma.invoice.findUnique({ where: { id } });
  return NextResponse.json({ ok: true, invoice: updated, incomeEntry, incomeAction, sheetWarning });
}
