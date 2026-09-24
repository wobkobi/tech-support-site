// src/app/api/business/invoices/sync-drive/route.ts
// Admin endpoint that links archived Drive PDFs to existing invoice records. POST scans
// every invoice PDF in Drive, matches each by filename to an invoice number, and
// back-fills driveFileId + driveWebUrl on the matched record. Unlike import-drive it
// never creates or re-parses records. Returns counts of matched, not-found and skipped
// (unparseable filename) files.

import {
  invoiceNumberCandidates,
  searchAllInvoicePdfs,
} from "@/features/business/lib/google-drive";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/business/invoices/sync-drive
 * Searches Google Drive for existing invoice PDFs and back-fills driveFileId + driveWebUrl
 * on matching invoice records. Matches by filename against invoice number.
 * @param request - Incoming Next.js request.
 * @returns JSON with counts of matched and unmatched Drive files.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    const files = await searchAllInvoicePdfs();
    let matched = 0;
    let notFound = 0;
    const skippedNames: string[] = [];

    for (const file of files) {
      const candidates = invoiceNumberCandidates(file.name);
      if (candidates.length === 0) {
        skippedNames.push(file.name);
        continue;
      }
      let invoice = null;
      for (const number of candidates) {
        invoice = await prisma.invoice.findFirst({ where: { number } });
        if (invoice) break;
      }
      if (!invoice) {
        notFound++;
        continue;
      }
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { driveFileId: file.fileId, driveWebUrl: file.webUrl },
      });
      matched++;
    }

    return NextResponse.json({
      ok: true,
      matched,
      notFound,
      driveFilesFound: files.length,
      skippedNames,
    });
  } catch (err) {
    console.error("[sync-drive] failed:", err);
    return errorResponse("Sync failed", 503);
  }
}
