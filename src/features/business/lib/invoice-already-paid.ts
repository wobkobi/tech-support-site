// src/features/business/lib/invoice-already-paid.ts
// Money paid before the invoice goes out ("paid $47 in cash"): validation and its income
// entry, told apart from the balance payment by Invoice.alreadyPaidIncomeId.

import { INCOME_METHODS } from "@/features/business/lib/constants";
import { recordIncome } from "@/features/business/lib/income-recording";
import {
  buildCashbookCells,
  deleteRowBySyncId,
  resolveSheetIdForDate,
  updateRowBySyncId,
} from "@/features/business/lib/sheets-sync";
import { parseAmount } from "@/features/business/lib/validation";
import { roundCents } from "@/shared/lib/money";
import { prisma } from "@/shared/lib/prisma";
import type { Prisma } from "@prisma/client";

/** A validated already-paid pair, or the error to 400 with. */
export type AlreadyPaidInput =
  { ok: true; amount: number | null; method: string | null } | { ok: false; error: string };

/**
 * Validates the already-paid amount and method from a request body. A missing, null or
 * 0 amount clears the part payment; a positive one needs an INCOME_METHODS method.
 * @param amount - Raw amount from the body.
 * @param method - Raw method from the body.
 * @returns The cleaned pair (both null when cleared), or an error message.
 */
export function parseAlreadyPaid(amount: unknown, method: unknown): AlreadyPaidInput {
  if (amount == null || amount === "") return { ok: true, amount: null, method: null };
  const parsed = parseAmount(amount);
  if (parsed === null) return { ok: false, error: "Invalid already-paid amount" };
  const cents = roundCents(parsed);
  if (cents === 0) return { ok: true, amount: null, method: null };
  if (typeof method !== "string" || !(INCOME_METHODS as readonly string[]).includes(method)) {
    return { ok: false, error: "Choose how the already-paid money came in" };
  }
  return { ok: true, amount: cents, method };
}

/**
 * Where-clause for the income entries that pay an invoice's balance: everything linked
 * to it except the already-paid entry.
 * @param invoice - The invoice's id and already-paid entry id.
 * @param invoice.id - Invoice id.
 * @param invoice.alreadyPaidIncomeId - The already-paid entry's id, or null.
 * @returns A Prisma where-clause for IncomeEntry.
 */
export function balanceIncomeWhere(invoice: {
  id: string;
  alreadyPaidIncomeId?: string | null;
}): Prisma.IncomeEntryWhereInput {
  return invoice.alreadyPaidIncomeId
    ? { invoiceId: invoice.id, id: { not: invoice.alreadyPaidIncomeId } }
    : { invoiceId: invoice.id };
}

/**
 * Moves a voided invoice's already-paid entry onto the invoice re-issuing it, so money
 * handed over on the day counts once. Run before {@link syncAlreadyPaidIncome}, which then
 * brings the entry's amount and method in line with the new invoice.
 * @param voidedId - The voided invoice being re-issued.
 * @param invoiceId - The new invoice.
 * @returns Whether an entry moved.
 */
export async function adoptReissuedAlreadyPaid(
  voidedId: string,
  invoiceId: string,
): Promise<boolean> {
  const voided = await prisma.invoice.findUnique({
    where: { id: voidedId },
    select: { status: true, alreadyPaidIncomeId: true },
  });
  if (voided?.status !== "VOIDED" || !voided.alreadyPaidIncomeId) return false;
  // Guarded on the old link, so two saves of one re-issue can't both take it.
  const moved = await prisma.incomeEntry.updateMany({
    where: { id: voided.alreadyPaidIncomeId, invoiceId: voidedId },
    data: { invoiceId },
  });
  if (moved.count !== 1) return false;
  await prisma.invoice.update({ where: { id: voidedId }, data: { alreadyPaidIncomeId: null } });
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { alreadyPaidIncomeId: voided.alreadyPaidIncomeId },
  });
  return true;
}

/**
 * Creates, updates or deletes the already-paid income entry (and its Cashbook row) to match
 * the invoice. The sheet wins on the next import, so a sheet failure warns for a hand fix.
 * If the sheet row delete fails, the entry is unlinked instead so the import can't duplicate it.
 * @param invoiceId - The invoice to reconcile.
 * @param date - Date for a newly created entry; defaults to the invoice's issue date.
 * @returns Whether the Cashbook sheet write was skipped or failed.
 */
export async function syncAlreadyPaidIncome(
  invoiceId: string,
  date?: Date,
): Promise<{ sheetSyncWarning: boolean }> {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return { sheetSyncWarning: false };
  const existing = invoice.alreadyPaidIncomeId
    ? await prisma.incomeEntry.findUnique({ where: { id: invoice.alreadyPaidIncomeId } })
    : null;
  const amount = invoice.isQuote ? null : invoice.alreadyPaid;
  const method = invoice.alreadyPaidMethod ?? INCOME_METHODS[0];

  // Cleared: drop the entry and its sheet row so the import can't bring it back.
  if (!amount || amount <= 0) {
    if (!existing) {
      if (invoice.alreadyPaidIncomeId) {
        await prisma.invoice.update({
          where: { id: invoiceId },
          data: { alreadyPaidIncomeId: null },
        });
      }
      return { sheetSyncWarning: false };
    }
    let sheetRowGone = !existing.sheetRowKey;
    if (existing.sheetRowKey) {
      try {
        const spreadsheetId = await resolveSheetIdForDate(existing.date);
        if (spreadsheetId) {
          await deleteRowBySyncId(spreadsheetId, "Cashbook", existing.sheetRowKey);
          sheetRowGone = true;
        }
      } catch (err) {
        console.error(`[already-paid] Sheet row delete failed for income ${existing.id}:`, err);
      }
    }
    await prisma.invoice.update({ where: { id: invoiceId }, data: { alreadyPaidIncomeId: null } });
    if (!sheetRowGone) {
      await prisma.incomeEntry.update({ where: { id: existing.id }, data: { invoiceId: null } });
      return { sheetSyncWarning: true };
    }
    await prisma.incomeEntry.delete({ where: { id: existing.id } });
    return { sheetSyncWarning: false };
  }

  if (!existing) {
    const result = await recordIncome({
      date: date ?? invoice.issueDate,
      customer: invoice.clientName,
      description: `Invoice ${invoice.number} - already paid`,
      amount,
      method,
      invoiceId,
    });
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { alreadyPaidIncomeId: result.entry.id },
    });
    return { sheetSyncWarning: result.sheetSyncWarning };
  }

  if (existing.amount === amount && existing.method === method) {
    return { sheetSyncWarning: false };
  }
  // Only amount and method follow the invoice; ledger edits to date or note stay.
  const updated = await prisma.incomeEntry.update({
    where: { id: existing.id },
    data: { amount, method },
  });
  try {
    const spreadsheetId = await resolveSheetIdForDate(updated.date);
    if (!spreadsheetId || !updated.sheetRowKey) return { sheetSyncWarning: !spreadsheetId };
    const result = await updateRowBySyncId(
      spreadsheetId,
      "Cashbook",
      updated.sheetRowKey,
      buildCashbookCells(updated),
    );
    if (result.syncId !== updated.sheetRowKey) {
      await prisma.incomeEntry.update({
        where: { id: updated.id },
        data: { sheetRowKey: result.syncId },
      });
    }
    return { sheetSyncWarning: false };
  } catch (err) {
    console.error(`[already-paid] Sheet write-through failed for income ${updated.id}:`, err);
    return { sheetSyncWarning: true };
  }
}
