// src/features/business/lib/invoice-numbering.ts
/**
 * @file invoice-numbering.ts
 * @description Shared invoice-numbering helper. Both the admin invoice
 * create flow and the auto-drafted late-cancellation invoice flow have to
 * agree on the next number so they never collide on the unique
 * `Invoice.number` index. Sheets is the source of truth when reachable;
 * Prisma is the fallback when it's not.
 */

import { prisma } from "@/shared/lib/prisma";
import { nextInvoiceNumber } from "@/features/business/lib/business";
import { getInvoiceCounter, setInvoiceCounter } from "@/features/business/lib/google-sheets";

export interface NextInvoiceNumber {
  /** Formatted number ready to drop on the new invoice (e.g. TTP-2627-0042). */
  number: string;
  /** Numeric counter to write back to Sheets after the row is created, or null when Sheets was unreachable. */
  sheetNextCount: number | null;
  /** True when the Sheets fetch failed and Prisma had to be used instead. */
  sheetSyncWarning: boolean;
}

/**
 * Fetches the next invoice number, preferring Sheets and falling back to a
 * Prisma `findFirst(orderBy number desc)` + `nextInvoiceNumber` when Sheets
 * is unreachable. Callers should pass `sheetNextCount` to
 * {@link writeBackInvoiceCounter} after the invoice row is created so the
 * Sheets counter stays in sync.
 * @returns Next number plus the write-back counter (or null on fallback).
 */
export async function getNextInvoiceNumber(): Promise<NextInvoiceNumber> {
  try {
    const data = await getInvoiceCounter();
    return { number: data.nextFormatted, sheetNextCount: data.nextNumber, sheetSyncWarning: false };
  } catch {
    const last = await prisma.invoice.findFirst({ orderBy: { number: "desc" } });
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
