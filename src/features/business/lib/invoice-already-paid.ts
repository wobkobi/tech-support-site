// src/features/business/lib/invoice-already-paid.ts
// Money a client hands over before the invoice goes out ("paid $47 in cash"): request
// validation for the amount and method, and the income entry that records it. The entry
// is linked to the invoice like the balance payment's, and told apart from it by
// Invoice.alreadyPaidIncomeId.

import { INCOME_METHODS } from "@/features/business/lib/constants";
import { recordIncome } from "@/features/business/lib/income-recording";
import {
  buildCashbookCells,
  deleteRowBySyncId,
  resolveSheetIdForDate,
  updateRowBySyncId,
} from "@/features/business/lib/sheets-sync";
import { parseAmount } from "@/features/business/lib/validation";
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
  const cents = Math.round(parsed * 100) / 100;
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
 * Brings the already-paid income entry in line with the invoice: creates it when the
 * invoice gains a part payment, updates the amount and method when they change, and
 * deletes it (with its Cashbook row) when the part payment is cleared or the invoice is
 * a quote. The Cashbook sheet is the source of truth on the next import, so a sheet
 * failure is not reconciled for you: an update that misses the sheet gets put back to the
 * sheet's amount, and the warning tells the operator to fix the row by hand.
 *
 * A removal deletes the sheet row first and only then the entry. If the sheet delete
 * fails, the entry is kept but unlinked from the invoice, so it keeps mirroring the row
 * still in the sheet instead of the import re-adding that row as a second income entry.
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
  // Only the amount and method follow the invoice; a date or note the operator
  // changed in the ledger stays.
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
