// src/app/api/business/invoices/[id]/pay/route.ts
// Records a payment: atomically claims the PAID stamp, then the income entry (a failed
// ledger write hands the claim back), Drive PDF and reminder apology (best-effort).

import { balanceDue } from "@/features/business/lib/business";
import { INCOME_METHODS } from "@/features/business/lib/constants";
import { recordIncome } from "@/features/business/lib/income-recording";
import { balanceIncomeWhere } from "@/features/business/lib/invoice-already-paid";
import { reminderChasedPaidInvoice } from "@/features/business/lib/invoice-apology";
import { syncInvoicePdfToDriveById } from "@/features/business/lib/invoice-drive-sync";
import { sendReminderApology } from "@/features/business/lib/invoice-reminders";
import {
  formatDateForSheet,
  resolveSheetIdForDate,
  updateRowBySyncId,
} from "@/features/business/lib/sheets-sync";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import type { IncomeEntry } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/business/invoices/[id]/pay
 * Body: `{ paidAt?, method, reference?, createIncome?, sendApology?, adoptIncomeId? }`.
 * `adoptIncomeId` links an unlinked sheet-typed income row instead of making a second.
 * @param request - Next.js request (admin-auth gated).
 * @param ctx - Route ctx with the invoice id.
 * @param ctx.params - Resolved Next.js dynamic route params.
 * @returns JSON `{ ok, invoice, incomeEntry, incomeAction, sheetWarning, apologySent }` or an error.
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
  if (invoice.isQuote) {
    return errorResponse("Convert the quote to an invoice before recording payment.", 409);
  }

  const body = (await request.json().catch(() => ({}))) as {
    paidAt?: unknown;
    method?: unknown;
    reference?: unknown;
    createIncome?: unknown;
    sendApology?: unknown;
    adoptIncomeId?: unknown;
  };
  const adoptIncomeId =
    typeof body.adoptIncomeId === "string" && /^[a-f0-9]{24}$/i.test(body.adoptIncomeId)
      ? body.adoptIncomeId
      : null;
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
  // Both default false on an already-PAID invoice, so a non-dialog caller can't add a
  // second ledger row or apologise for a long-settled bill.
  const createIncome = typeof body.createIncome === "boolean" ? body.createIncome : !alreadyPaid;
  const sendApology = typeof body.sendApology === "boolean" ? body.sendApology : !alreadyPaid;

  // Atomic claim so a double-click hits count 0. Match null AND a missing key - a bare
  // `paidAt: null` compiles to "exists AND is null" and skips older rows.
  const claim = await prisma.invoice.updateMany({
    where: { id, OR: [{ paidAt: null }, { paidAt: { isSet: false } }] },
    data: { status: "PAID", paidAt, paymentMethod: method, paymentReference: reference },
  });
  if (claim.count !== 1) {
    const current = await prisma.invoice.findUnique({ where: { id } });
    const existing = await prisma.incomeEntry.findFirst({ where: balanceIncomeWhere(invoice) });
    return NextResponse.json({
      ok: true,
      invoice: current,
      incomeEntry: existing,
      incomeAction: "skipped",
      apologySent: false,
    });
  }

  // Only the claim winner reaches here. The already-paid entry is never touched.
  const balance = balanceDue(invoice);
  let incomeEntry: IncomeEntry | null = null;
  let incomeAction: "created" | "updated" | "skipped" = "skipped";
  let sheetWarning = false;
  try {
    let existingIncome = await prisma.incomeEntry.findFirst({
      where: balanceIncomeWhere(invoice),
    });
    // Adopt the operator-confirmed sheet row; only an unlinked row can be taken.
    if (!existingIncome && adoptIncomeId) {
      const adopted = await prisma.incomeEntry.updateMany({
        where: { id: adoptIncomeId, OR: [{ invoiceId: null }, { invoiceId: { isSet: false } }] },
        data: { invoiceId: id },
      });
      if (adopted.count === 1) {
        existingIncome = await prisma.incomeEntry.findUnique({ where: { id: adoptIncomeId } });
      }
    }
    incomeEntry = existingIncome;

    if (existingIncome) {
      // Only the dialog's fields; amount/customer/description may have been hand-edited.
      incomeEntry = await prisma.incomeEntry.update({
        where: { id: existingIncome.id },
        // A blank reference keeps whatever note the row already has (often typed in the sheet).
        data: { date: paidAt, method, notes: reference ?? existingIncome.notes },
      });
      // Null cells preserve the sheet's own values.
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
        console.error(
          `[invoice-pay] Sheet write-through failed for income ${incomeEntry.id}:`,
          err,
        );
        sheetWarning = true;
      }
      incomeAction = "updated";
    } else if (createIncome && balance > 0) {
      const result = await recordIncome({
        date: paidAt,
        customer: invoice.clientName,
        description: `Invoice ${invoice.number}`,
        amount: balance,
        method,
        notes: reference,
        invoiceId: id,
      });
      incomeEntry = result.entry;
      sheetWarning = result.sheetSyncWarning;
      incomeAction = "created";
    }
  } catch (err) {
    // Hand the claim back, or the retry would read it as paid and never record the income.
    console.error(`[invoice-pay] Income write failed for ${invoice.number}:`, err);
    await prisma.invoice
      .updateMany({
        where: { id, paidAt },
        data: {
          status: invoice.status,
          paidAt: null,
          paymentMethod: invoice.paymentMethod,
          paymentReference: invoice.paymentReference,
        },
      })
      .catch((e: unknown) => console.error(`[invoice-pay] Couldn't release ${invoice.number}:`, e));
    return errorResponse(
      "Couldn't record the payment in the income ledger. The invoice is still unpaid - try again.",
      500,
    );
  }

  // Re-sync the PAID-watermarked PDF to Drive (awaited; best-effort).
  await syncInvoicePdfToDriveById(id, "[invoice-pay]");

  // Apologise when a reminder chased money already paid. A failed send leaves
  // apologySentAt null, so it stays retryable.
  let apologySent = false;
  if (
    sendApology &&
    reminderChasedPaidInvoice({
      reminderLastSentAt: invoice.reminderLastSentAt,
      paidAt,
      apologySentAt: invoice.apologySentAt,
    })
  ) {
    const { comms } = await getSettings();
    if (comms.invoiceApologyEnabled) {
      apologySent = await sendReminderApology(invoice, paidAt);
      if (apologySent) console.log(`[invoice-pay] apology sent for ${invoice.number}`);
    }
  }

  const updated = await prisma.invoice.findUnique({ where: { id } });
  return NextResponse.json({
    ok: true,
    invoice: updated,
    incomeEntry,
    incomeAction,
    sheetWarning,
    apologySent,
  });
}
