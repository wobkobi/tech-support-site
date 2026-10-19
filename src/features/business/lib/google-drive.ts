// src/features/business/lib/google-drive.ts
// Google Drive v3 helpers: the "Invoices > {year}" folder tree, invoice PDF upload/listing,
// and spreadsheet listing for the sheets importer.

import { getOAuth2Client } from "@/features/calendar/lib/google-calendar";
import { drive as googleDrive, type drive_v3 } from "@googleapis/drive";
import { Readable } from "stream";

/** Module-level cache to avoid repeat folder lookups per deploy. */
const folderCache = new Map<string, string>();

/**
 * Creates an authenticated Google Drive API v3 client.
 * @returns Drive v3 API client instance
 */
export function getDriveClient(): drive_v3.Drive {
  return googleDrive({ version: "v3", auth: getOAuth2Client() });
}

/**
 * Finds or creates a Google Drive folder with the given name inside a parent folder.
 * @param parentId - The parent folder ID ("root" for My Drive root).
 * @param name - The folder name to find or create.
 * @returns The folder ID.
 */
async function getOrCreateFolder(parentId: string, name: string): Promise<string> {
  const drive = getDriveClient();
  const q = `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`;
  const list = await drive.files.list({ q, fields: "files(id)", pageSize: 1 });
  const existing = list.data.files?.[0]?.id;
  if (existing) return existing;

  const created = await drive.files.create({
    requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] },
    fields: "id",
  });
  return created.data.id!;
}

/**
 * Converts a year code to the Drive folder name format used by the Apps Script.
 * "202627" > "2026-27" (6-digit, current format); "2627" > "2026-27" (4-digit, legacy fallback).
 * @param yearCode - Compact fiscal year code string
 * @returns Human-readable folder name like "2026-27"
 */
function yearCodeToFolderName(yearCode: string): string {
  if (yearCode.length === 6) return `${yearCode.slice(0, 4)}-${yearCode.slice(4)}`;
  return `20${yearCode.slice(0, 2)}-${yearCode.slice(2)}`;
}

/**
 * Finds or creates the folder tree "Invoices > {year}" matching the existing Drive structure.
 * Results are cached per yearCode for the lifetime of the process.
 * @param yearCode - Compact fiscal year code (e.g. "2627" for FY 2026-27).
 * @returns The Google Drive folder ID for the year subfolder.
 */
async function getOrCreateInvoiceFolder(yearCode: string): Promise<string> {
  if (folderCache.has(yearCode)) return folderCache.get(yearCode)!;
  const invoicesId = await getOrCreateFolder("root", "Invoices");
  const yearId = await getOrCreateFolder(invoicesId, yearCodeToFolderName(yearCode));
  folderCache.set(yearCode, yearId);
  return yearId;
}

/**
 * Shares a Drive file as "anyone with the link can view" so emailed links work without a
 * Google sign-in. Idempotent; failures are logged, never thrown.
 * @param fileId - Drive file ID to share.
 */
async function ensureAnyoneWithLinkReader(fileId: string): Promise<void> {
  try {
    const drive = getDriveClient();
    await drive.permissions.create({
      fileId,
      requestBody: { type: "anyone", role: "reader" },
      // The client already gets the invoice via Resend.
      sendNotificationEmail: false,
    });
  } catch (err) {
    console.warn(`[drive] Failed to set anyone-with-link reader on ${fileId}:`, err);
  }
}

/**
 * Uploads an invoice PDF to its year folder, replacing in place to keep the URL stable
 * (a deleted file is recreated), shared as anyone-with-the-link.
 * @param buffer - PDF content as a Buffer.
 * @param invoiceNumber - Filename (e.g. "TTP-2627-0042").
 * @param yearCode - Fiscal year code used to resolve the destination folder.
 * @param existingFileId - Optional existing Drive file ID to update in place.
 * @returns Object with Drive file ID and web view URL.
 */
export async function uploadInvoicePdf(
  buffer: Buffer,
  invoiceNumber: string,
  yearCode: string,
  existingFileId?: string,
): Promise<{ fileId: string; webUrl: string }> {
  const drive = getDriveClient();

  if (existingFileId) {
    try {
      const res = await drive.files.update({
        fileId: existingFileId,
        media: { mimeType: "application/pdf", body: Readable.from(buffer) },
        fields: "id,webViewLink",
      });
      await ensureAnyoneWithLinkReader(res.data.id!);
      return { fileId: res.data.id!, webUrl: res.data.webViewLink! };
    } catch (err) {
      // Recreate only on 404/410; a transient error rethrows rather than orphan the emailed PDF.
      const e = err as { code?: unknown; response?: { status?: unknown } };
      const status =
        typeof e.response?.status === "number"
          ? e.response.status
          : typeof e.code === "number"
            ? e.code
            : null;
      if (status !== 404 && status !== 410) throw err;
      console.warn(
        `[drive] File ${existingFileId} (${invoiceNumber}) is gone (${status}); creating new file:`,
        err,
      );
    }
  }

  const folderId = await getOrCreateInvoiceFolder(yearCode);
  const res = await drive.files.create({
    requestBody: {
      name: `Invoice ${invoiceNumber}.pdf`,
      mimeType: "application/pdf",
      parents: [folderId],
    },
    media: {
      mimeType: "application/pdf",
      body: Readable.from(buffer),
    },
    fields: "id,webViewLink",
  });
  await ensureAnyoneWithLinkReader(res.data.id!);
  return { fileId: res.data.id!, webUrl: res.data.webViewLink! };
}

/**
 * Searches all of Drive for PDFs matching the invoice filename convention (e.g. TTP-2627-0042.pdf).
 * Back-fills driveFileId/driveWebUrl on existing invoice records.
 * @returns Array of file metadata objects for all matching PDFs found in Drive.
 */
export async function searchAllInvoicePdfs(): Promise<
  { name: string; fileId: string; webUrl: string }[]
> {
  const drive = getDriveClient();
  const results: { name: string; fileId: string; webUrl: string }[] = [];
  // Paged, since one page silently truncates; nextPageToken must be listed in `fields`.
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: "name contains 'TTP-' and mimeType='application/pdf' and trashed=false",
      fields: "nextPageToken, files(id,name,webViewLink)",
      pageSize: 500,
      ...(pageToken ? { pageToken } : {}),
    });
    for (const f of res.data.files ?? []) {
      if (!f.id || !f.name) continue;
      results.push({ name: f.name, fileId: f.id, webUrl: f.webViewLink! });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return results;
}

/**
 * Lists every spreadsheet in a Drive folder, recursing into subfolders. Names carry the
 * folder breadcrumb; `modifiedTime` lets the import skip unchanged workbooks.
 * @param folderId - The Drive folder ID to scan.
 * @returns `{ name, fileId, modifiedTime }` for every spreadsheet, sorted by name.
 */
export async function listSpreadsheetsInFolder(
  folderId: string,
): Promise<{ name: string; fileId: string; modifiedTime: string | null }[]> {
  const drive = getDriveClient();
  const results: { name: string; fileId: string; modifiedTime: string | null }[] = [];

  /**
   * Recursive walker.
   * @param currentFolderId - Folder being scanned.
   * @param breadcrumbs - Folder names walked so far, for display.
   */
  async function walk(currentFolderId: string, breadcrumbs: string[]): Promise<void> {
    let pageToken: string | undefined;
    do {
      const res = await drive.files.list({
        q: `'${currentFolderId}' in parents and trashed=false and (mimeType='application/vnd.google-apps.spreadsheet' or mimeType='application/vnd.google-apps.folder')`,
        fields: "nextPageToken, files(id,name,mimeType,modifiedTime)",
        pageSize: 100,
        ...(pageToken ? { pageToken } : {}),
      });
      for (const f of res.data.files ?? []) {
        if (!f.id || !f.name) continue;
        if (f.mimeType === "application/vnd.google-apps.spreadsheet") {
          const displayName =
            breadcrumbs.length > 0 ? `${breadcrumbs.join(" / ")} / ${f.name}` : f.name;
          results.push({ name: displayName, fileId: f.id, modifiedTime: f.modifiedTime ?? null });
        } else if (f.mimeType === "application/vnd.google-apps.folder") {
          await walk(f.id, [...breadcrumbs, f.name]);
        }
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
  }

  await walk(folderId, []);
  results.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  return results;
}

/**
 * Downloads a Drive file and returns its content as a Buffer.
 * @param fileId - Google Drive file ID.
 * @returns File content as a Buffer.
 */
export async function downloadDriveFile(fileId: string): Promise<Buffer> {
  const drive = getDriveClient();
  const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
  return Buffer.from(res.data as ArrayBuffer);
}

/** Matches "Invoice TTP-202627-0006.pdf" or "Invoice TTP-0001.pdf" (skips -old variants). */
const INVOICE_FILE_RE = /^Invoice\s+([A-Z]+-[\d-]+\d)\.pdf$/i;

/**
 * Invoice-number candidates from a Drive PDF filename: as written, plus the 4-digit-year
 * form ("TTP-202627-0006" > "TTP-2627-0006").
 * @param filename - Drive file name, e.g. "Invoice TTP-202627-0006.pdf".
 * @returns Candidate invoice numbers; empty when the name isn't an invoice PDF.
 */
export function invoiceNumberCandidates(filename: string): string[] {
  const m = filename.match(INVOICE_FILE_RE);
  if (!m) return [];
  const raw = m[1] ?? "";
  const candidates = [raw];
  const yearMatch = raw.match(/^([A-Z]+-)(\d{6})(-.+)$/i);
  if (yearMatch) candidates.push(`${yearMatch[1]}${(yearMatch[2] ?? "").slice(-4)}${yearMatch[3]}`);
  return candidates;
}
