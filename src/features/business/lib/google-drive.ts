import { google } from "googleapis";
import { getOAuth2Client } from "@/features/calendar/lib/google-calendar";
import { Readable } from "stream";

/** Module-level cache to avoid repeat folder lookups per deploy. */
const folderCache = new Map<string, string>();

/**
 * Creates an authenticated Google Drive API v3 client.
 * @returns Drive v3 API client instance
 */
function getDriveClient(): ReturnType<typeof google.drive> {
  return google.drive({ version: "v3", auth: getOAuth2Client() });
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
 * "202627" → "2026-27" (6-digit, current format); "2627" → "2026-27" (4-digit, legacy fallback).
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
export async function getOrCreateInvoiceFolder(yearCode: string): Promise<string> {
  if (folderCache.has(yearCode)) return folderCache.get(yearCode)!;
  const invoicesId = await getOrCreateFolder("root", "Invoices");
  const yearId = await getOrCreateFolder(invoicesId, yearCodeToFolderName(yearCode));
  folderCache.set(yearCode, yearId);
  return yearId;
}

/**
 * Uploads a PDF buffer to Drive in the correct year folder.
 * @param buffer - PDF content as a Buffer.
 * @param invoiceNumber - Invoice number used as the filename (e.g. "TTP-2627-0042").
 * @param yearCode - Fiscal year code used to resolve the destination folder.
 * @returns Object with Drive file ID and web view URL.
 */
export async function uploadInvoicePdf(
  buffer: Buffer,
  invoiceNumber: string,
  yearCode: string,
): Promise<{ fileId: string; webUrl: string }> {
  const drive = getDriveClient();
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
  return { fileId: res.data.id!, webUrl: res.data.webViewLink! };
}

/**
 * Lists all invoice PDFs in the year folder.
 * @param yearCode - Fiscal year code of the folder to list.
 * @returns Array of file metadata objects.
 */
export async function listInvoicePdfs(
  yearCode: string,
): Promise<{ name: string; fileId: string; webUrl: string }[]> {
  const drive = getDriveClient();
  const folderId = await getOrCreateInvoiceFolder(yearCode);
  const res = await drive.files.list({
    q: `'${folderId}' in parents and mimeType='application/pdf' and trashed=false`,
    fields: "files(id,name,webViewLink)",
    pageSize: 200,
  });
  return (res.data.files ?? []).map((f) => ({
    name: f.name!,
    fileId: f.id!,
    webUrl: f.webViewLink!,
  }));
}

/**
 * Searches all of Drive for PDFs matching the invoice filename convention (e.g. TTP-2627-0042.pdf).
 * Used by the sync route to back-fill driveFileId/driveWebUrl on existing invoice records.
 * @returns Array of file metadata objects for all matching PDFs found in Drive.
 */
export async function searchAllInvoicePdfs(): Promise<
  { name: string; fileId: string; webUrl: string }[]
> {
  const drive = getDriveClient();
  const res = await drive.files.list({
    q: "name contains 'TTP-' and mimeType='application/pdf' and trashed=false",
    fields: "files(id,name,webViewLink)",
    pageSize: 500,
  });
  return (res.data.files ?? []).map((f) => ({
    name: f.name!,
    fileId: f.id!,
    webUrl: f.webViewLink!,
  }));
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
