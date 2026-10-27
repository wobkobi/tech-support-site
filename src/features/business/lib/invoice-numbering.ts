// src/features/business/lib/invoice-numbering.ts
// Shared invoice/quote numbering so every create flow agrees on the unique `Invoice.number`.
// Numbers run per financial year (TTP-202728-0001 on 1 April 2027); the highest saved this
// year and the Sheets counter both count, so neither can reuse a number.

import { nextInvoiceNumber, numberSequence } from "@/features/business/lib/business";
import { nzFinancialYearCode } from "@/features/business/lib/financial-year";
import {
  getInvoiceCounter,
  getQuoteCounter,
  setInvoiceCounter,
  setQuoteCounter,
} from "@/features/business/lib/google-sheets";
import { prisma } from "@/shared/lib/prisma";

export interface NextInvoiceNumber {
  /** Formatted number ready to drop on the new invoice (e.g. TTP-202627-0042). */
  number: string;
  /** Counter to write back to Sheets after the row is created; null when Sheets was unreachable. */
  sheetNextCount: number | null;
  /** True when the Sheets fetch failed and Prisma had to be used instead. */
  sheetSyncWarning: boolean;
}

/**
 * Highest sequence saved so far this financial year under a prefix. The zero-padded
 * sequence sorts as text, so the last row by number is the highest.
 * @param prefix - "TTP" for invoices, "Q" for quotes.
 * @param yearCode - Financial year code ("202627").
 * @returns The sequence, or 0 when this year has none yet.
 */
async function lastSequenceThisYear(prefix: string, yearCode: string): Promise<number> {
  const last = await prisma.invoice.findFirst({
    where: { number: { startsWith: `${prefix}-${yearCode}-` } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  return numberSequence(last?.number);
}

/**
 * Next invoice number for this financial year, from the highest saved this year and the
 * SETTINGS!B19 counter (see {@link nextInvoiceNumber}); the saved rows alone when Sheets
 * is down. Pass `sheetNextCount` to {@link writeBackInvoiceCounter} after the row is created.
 * @returns Next number plus the write-back counter (or null on fallback).
 */
export async function getNextInvoiceNumber(): Promise<NextInvoiceNumber> {
  const yearCode = nzFinancialYearCode();
  try {
    const data = await getInvoiceCounter();
    const dbLast = await lastSequenceThisYear(data.prefix, yearCode);
    const next = nextInvoiceNumber(data.prefix, yearCode, dbLast, data.lastNumber);
    return { number: next.number, sheetNextCount: next.sequence, sheetSyncWarning: false };
  } catch {
    const dbLast = await lastSequenceThisYear("TTP", yearCode);
    return {
      number: nextInvoiceNumber("TTP", yearCode, dbLast, null).number,
      sheetNextCount: null,
      sheetSyncWarning: true,
    };
  }
}

/**
 * Next quote number, same rule as {@link getNextInvoiceNumber} against the SETTINGS!B12
 * counter. Pass `sheetNextCount` to {@link writeBackQuoteCounter} after the row is created.
 * @returns Next Q- number plus the write-back counter (or null on fallback).
 */
export async function getNextQuoteNumber(): Promise<NextInvoiceNumber> {
  const yearCode = nzFinancialYearCode();
  const dbLast = await lastSequenceThisYear("Q", yearCode);
  try {
    const data = await getQuoteCounter();
    const next = nextInvoiceNumber("Q", yearCode, dbLast, data.lastNumber);
    return { number: next.number, sheetNextCount: next.sequence, sheetSyncWarning: false };
  } catch {
    return {
      number: nextInvoiceNumber("Q", yearCode, dbLast, null).number,
      sheetNextCount: null,
      sheetSyncWarning: true,
    };
  }
}

/**
 * Writes the just-used quote counter back to SETTINGS!B12, like {@link writeBackInvoiceCounter}.
 * @param count - The numeric counter that was just consumed.
 */
export async function writeBackQuoteCounter(count: number | null): Promise<void> {
  if (count === null) return;
  try {
    await setQuoteCounter(count);
  } catch (err) {
    console.error("[invoice-numbering] Sheets quote-counter write-back failed:", err);
  }
}

/**
 * Writes the just-used counter back to Sheets. No-op on null; failures are only logged,
 * since the invoice is already saved and counter drift self-corrects.
 * @param count - The numeric counter that was just consumed.
 */
export async function writeBackInvoiceCounter(count: number | null): Promise<void> {
  if (count === null) return;
  try {
    await setInvoiceCounter(count);
  } catch (err) {
    console.error("[invoice-numbering] Sheets counter write-back failed:", err);
  }
}
