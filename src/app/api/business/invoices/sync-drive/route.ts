// src/app/api/business/invoices/sync-drive/route.ts
// Links archived Drive PDFs to existing invoices by filename. Never creates or
// re-parses records (that's import-drive).

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
 * Back-fill driveFileId + driveWebUrl on invoices matched by PDF filename.
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
