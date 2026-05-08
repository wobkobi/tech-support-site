import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { searchAllInvoicePdfs } from "@/features/business/lib/google-drive";

// Matches "Invoice TTP-202627-0006.pdf" or "Invoice TTP-0001.pdf" (skips -old variants)
const INVOICE_FILE_RE = /^Invoice\s+([A-Z]+-[\d-]+\d)\.pdf$/i;

/**
 * Extracts the number from a Drive filename and returns DB candidates to try.
 * @param filename - Drive PDF filename to parse
 * @returns Array of candidate invoice numbers to look up in the database
 */
function extractCandidates(filename: string): string[] {
  const m = filename.match(INVOICE_FILE_RE);
  if (!m) return [];
  const raw = m[1]; // e.g. "TTP-202627-0006" or "TTP-0001"
  const candidates = [raw];
  // Normalise 6-digit year like "202627" → 4-digit "2627"
  const yearMatch = raw.match(/^([A-Z]+-)(\d{6})(-.+)$/i);
  if (yearMatch) candidates.push(`${yearMatch[1]}${yearMatch[2].slice(-4)}${yearMatch[3]}`);
  return candidates;
}

/**
 * POST /api/business/invoices/sync-drive
 * Searches Google Drive for existing invoice PDFs and back-fills driveFileId + driveWebUrl
 * on matching invoice records. Matches by filename against invoice number.
 * @param request - Incoming Next.js request.
 * @returns JSON with counts of matched and unmatched Drive files.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const files = await searchAllInvoicePdfs();
    let matched = 0;
    let notFound = 0;
    const skippedNames: string[] = [];

    for (const file of files) {
      const candidates = extractCandidates(file.name);
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
    return NextResponse.json({ error: "Sync failed" }, { status: 503 });
  }
}
