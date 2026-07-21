// src/features/business/lib/invoice-drive-sync.ts
/**
 * @description Shared "sync the invoice PDF to Google Drive" helper, previously
 * copy-pasted across five call sites (PATCH, void, send-email, create,
 * cancellation). Re-uploads the PDF (replacing the Drive file in place when
 * driveFileId is set, else creating a fresh one) and persists any new ids.
 * Failures are logged, never thrown - Drive is a non-critical archive sync.
 */

import { uploadInvoicePdf } from "@/features/business/lib/google-drive";
import {
  extractYearCode,
  generateInvoicePdf,
  serializeInvoice,
} from "@/features/business/lib/invoice-pdf";
import { prisma } from "@/shared/lib/prisma";

/** The invoice fields the Drive sync needs. */
interface DriveSyncInvoice {
  /** Invoice DB id. */
  id: string;
  /** Invoice number (drives the Drive filename + folder). */
  number: string;
  /** Existing Drive file id (in-place replace) or null (fresh upload). */
  driveFileId: string | null;
  /** Existing Drive web URL, for the change check. */
  driveWebUrl: string | null;
}

/**
 * Uploads an already-generated invoice PDF to Drive and persists new ids on the
 * invoice when they change. Never throws.
 * @param invoice - Invoice id/number + current Drive ids.
 * @param pdfBytes - The generated PDF bytes.
 * @param logPrefix - Prefix for the failure log line.
 */
export async function syncInvoicePdfToDrive(
  invoice: DriveSyncInvoice,
  pdfBytes: Buffer,
  logPrefix = "[invoice-drive]",
): Promise<void> {
  try {
    const yearCode = extractYearCode(invoice.number);
    const drive = await uploadInvoicePdf(
      pdfBytes,
      invoice.number,
      yearCode,
      invoice.driveFileId ?? undefined,
    );
    if (drive.fileId !== invoice.driveFileId || drive.webUrl !== invoice.driveWebUrl) {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { driveFileId: drive.fileId, driveWebUrl: drive.webUrl },
      });
    }
  } catch (err) {
    console.error(`${logPrefix} Drive sync failed:`, err);
  }
}

/**
 * Refetches an invoice, regenerates its PDF, and syncs it to Drive - for callers
 * that don't already hold the row and PDF (the PATCH and /pay paths). Never throws.
 * @param invoiceId - Invoice DB id.
 * @param logPrefix - Prefix for the failure log line.
 */
export async function syncInvoicePdfToDriveById(
  invoiceId: string,
  logPrefix = "[invoice-drive]",
): Promise<void> {
  try {
    const inv = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) return;
    const pdfBytes = await generateInvoicePdf(serializeInvoice(inv));
    await syncInvoicePdfToDrive(inv, pdfBytes, logPrefix);
  } catch (err) {
    console.error(`${logPrefix} Drive sync (by id) failed:`, err);
  }
}
