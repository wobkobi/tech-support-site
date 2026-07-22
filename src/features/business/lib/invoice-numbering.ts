// src/features/business/lib/invoice-numbering.ts
/**
 * @description Shared invoice-numbering helper. Both the admin invoice
 * create flow and the auto-drafted late-cancellation invoice flow have to
 * agree on the next number so they never collide on the unique
 * `Invoice.number` index. Sheets is the source of truth when reachable;
 * Prisma is the fallback when it's not.
 */

import { nextInvoiceNumber } from "@/features/business/lib/business";
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
  /** Numeric counter to write back to Sheets after the row is created, or null when Sheets was unreachable. */
  sheetNextCount: number | null;
  /** True when the Sheets fetch failed and Prisma had to be used instead. */
  sheetSyncWarning: boolean;
}

/**
 * Fetches the next invoice number as `max(sheet counter, highest existing DB
 * number)`, so a stale Sheets B19 or a row created since the last write-back
 * can't hand out an already-used number - the caller's collision-retry loop
 * then converges upward. Falls back to the DB max alone when Sheets is
 * unreachable. Callers pass `sheetNextCount` to {@link writeBackInvoiceCounter}
 * after the row is created so the Sheets counter stays in sync.
 * @returns Next number plus the write-back counter (or null on fallback).
 */
export async function getNextInvoiceNumber(): Promise<NextInvoiceNumber> {
  try {
    const data = await getInvoiceCounter();
    // Quote rows share the table + unique index but number from their own
    // counter - exclude them so a Q- number can never seed the invoice
    // sequence (isQuote catches converted rows whose flag was later cleared;
    // the prefix filter catches any legacy row).
    const last = await prisma.invoice.findFirst({
      where: { NOT: { number: { startsWith: "Q-" } } },
      orderBy: { number: "desc" },
      select: { number: true },
    });
    // Trailing "-NNNN" is the sequence; the year segment can't leak in (\d+
    // stops at the hyphen). Missing/legacy > 0 so the sheet counter wins.
    const dbMatch = last?.number.match(/-(\d+)$/);
    const dbNext = (dbMatch ? parseInt(dbMatch[1], 10) : 0) + 1;
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
    const now = new Date();
    const fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const yearCode = String(fy) + String(fy + 1).slice(2);
    return {
      number: nextInvoiceNumber(last?.number ?? null, yearCode),
      sheetNextCount: null,
      sheetSyncWarning: true,
    };
  }
}

/**
 * Fetches the next QUOTE number as `max(sheet quote counter, highest existing
 * Q- number in the DB)` - the same convergence rule as invoices, against the
 * dedicated SETTINGS!B12 counter. Falls back to the DB max alone when Sheets
 * is unreachable. Callers pass `sheetNextCount` to
 * {@link writeBackQuoteCounter} after the row is created.
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
  const dbNext = (dbMatch ? parseInt(dbMatch[1], 10) : 0) + 1;
  try {
    const data = await getQuoteCounter();
    const nextNumber = Math.max(data.nextNumber, dbNext);
    const number =
      nextNumber === data.nextNumber
        ? data.nextFormatted
        : `Q-${data.yearCode}-${String(nextNumber).padStart(4, "0")}`;
    return { number, sheetNextCount: nextNumber, sheetSyncWarning: false };
  } catch {
    const now = new Date();
    const fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const yearCode = String(fy) + String(fy + 1).slice(2);
    return {
      number: `Q-${yearCode}-${String(dbNext).padStart(4, "0")}`,
      sheetNextCount: null,
      sheetSyncWarning: true,
    };
  }
}

/**
 * Writes the just-used quote counter back to SETTINGS!B12. Same no-op /
 * swallow semantics as {@link writeBackInvoiceCounter}.
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
 * Writes the just-used counter back to Sheets. No-op when `count` is null
 * (Sheets fell over during fetch - sync will recover on the next successful
 * fetch + write cycle). Failures are caught and logged; the caller's invoice
 * is already saved and the counter drift is recoverable.
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
