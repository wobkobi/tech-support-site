// src/features/business/lib/invoice-numbering.ts
// Shared invoice/quote numbering so every create flow agrees on the unique `Invoice.number`.
// Sheets is the source of truth when reachable; Prisma is the fallback.

import { nextInvoiceNumber } from "@/features/business/lib/business";
import { nzFinancialYearCode } from "@/features/business/lib/financial-year";
import {
  getInvoiceCounter,
  getQuoteCounter,
  setInvoiceCounter,
  setQuoteCounter,
} from "@/features/business/lib/google-sheets";
import { prisma } from "@/shared/lib/prisma";

export interface NextInvoiceNumber {
  /** Formatted number ready to drop on the new invoice (e.g. TTP-2627-0042). */
  number: string;
  /** Counter to write back to Sheets after the row is created; null when Sheets was unreachable. */
  sheetNextCount: number | null;
  /** True when the Sheets fetch failed and Prisma had to be used instead. */
  sheetSyncWarning: boolean;
}

/**
 * Next invoice number as `max(sheet counter, highest DB number)`, so a stale Sheets B19
 * can't reuse a number; DB max alone when Sheets is down. Pass `sheetNextCount` to
 * {@link writeBackInvoiceCounter} after the row is created.
 * @returns Next number plus the write-back counter (or null on fallback).
 */
export async function getNextInvoiceNumber(): Promise<NextInvoiceNumber> {
  try {
    const data = await getInvoiceCounter();
    // Quotes share the table but have their own counter; keep Q- numbers out of this one.
    const last = await prisma.invoice.findFirst({
      where: { NOT: { number: { startsWith: "Q-" } } },
      orderBy: { number: "desc" },
      select: { number: true },
    });
    // Trailing "-NNNN" is the sequence; no match > 0 so the sheet counter wins.
    const dbMatch = last?.number.match(/-(\d+)$/);
    const dbNext = (dbMatch ? parseInt(dbMatch[1] ?? "", 10) : 0) + 1;
    const nextNumber = Math.max(data.nextNumber, dbNext);
    const number =
      nextNumber === data.nextNumber
        ? data.nextFormatted
        : `${data.prefix}-${data.yearCode}-${String(nextNumber).padStart(4, "0")}`;
    return { number, sheetNextCount: nextNumber, sheetSyncWarning: false };
  } catch {
    const last = await prisma.invoice.findFirst({
      where: { NOT: { number: { startsWith: "Q-" } } },
      orderBy: { number: "desc" },
    });
    const yearCode = nzFinancialYearCode();
    return {
      number: nextInvoiceNumber(last?.number ?? null, yearCode),
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
  // Highest existing Q- row; shared by both paths below.
  const last = await prisma.invoice.findFirst({
    where: { number: { startsWith: "Q-" } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const dbMatch = last?.number.match(/-(\d+)$/);
  const dbNext = (dbMatch ? parseInt(dbMatch[1] ?? "", 10) : 0) + 1;
  try {
    const data = await getQuoteCounter();
    const nextNumber = Math.max(data.nextNumber, dbNext);
    const number =
      nextNumber === data.nextNumber
        ? data.nextFormatted
        : `Q-${data.yearCode}-${String(nextNumber).padStart(4, "0")}`;
    return { number, sheetNextCount: nextNumber, sheetSyncWarning: false };
  } catch {
    const yearCode = nzFinancialYearCode();
    return {
      number: `Q-${yearCode}-${String(dbNext).padStart(4, "0")}`,
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
