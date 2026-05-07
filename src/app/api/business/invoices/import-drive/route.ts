import { NextRequest, NextResponse } from "next/server";
import { inflateSync } from "node:zlib";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { searchAllInvoicePdfs, downloadDriveFile } from "@/features/business/lib/google-drive";

const INVOICE_FILE_RE = /^Invoice\s+([A-Z]+-[\d-]+\d)\.pdf$/i;

/**
 * Extracts invoice number candidates from a Drive PDF filename.
 * @param filename - Drive file name, e.g. "Invoice TTP-202627-0006.pdf"
 * @returns Array of invoice number strings to try (modern + legacy format)
 */
function extractCandidates(filename: string): string[] {
  const m = filename.match(INVOICE_FILE_RE);
  if (!m) return [];
  const raw = m[1];
  const candidates = [raw];
  const yearMatch = raw.match(/^([A-Z]+-)(\d{6})(-.+)$/i);
  if (yearMatch) candidates.push(`${yearMatch[1]}${yearMatch[2].slice(-4)}${yearMatch[3]}`);
  return candidates;
}

/**
 * Estimates an issue date from the year code in an invoice number (falls back to April 2020).
 * @param invoiceNumber - Invoice number string, e.g. "TTP-2627-0001"
 * @returns Estimated issue date
 */
function estimateIssueDate(invoiceNumber: string): Date {
  const m = invoiceNumber.match(/[A-Z]+-(\d{4})\d{0,2}-/);
  if (m) return new Date(`${m[1]}-04-01`);
  return new Date("2020-04-01");
}

/**
 * Decodes a raw PDF string that uses 2-byte font encoding with a -29 glyph offset.
 * Google Sheets-generated PDFs encode each character as 0x00 + (realCharCode - 29).
 * Detection: if more than 30% of code units are NUL (0x00), treat as 2-byte shifted.
 * @param s - Raw string from a PDF Tj/TJ text operator
 * @returns Decoded plain-text string
 */
function decodePdfString(s: string): string {
  let nullCount = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 0) nullCount++;
  }
  if (s.length > 0 && nullCount / s.length > 0.3) {
    let out = "";
    for (let i = 0; i < s.length; i++) {
      const cp = s.charCodeAt(i);
      if (cp === 0) continue;
      const decoded = cp + 29;
      if (decoded >= 32 && decoded <= 126) out += String.fromCharCode(decoded);
    }
    // Byte 92 ('\') decodes to 'y' (92+29=121). When the PDF escape handler captures
    // '\' + next_byte, both pass through decode and produce spurious 'y' between
    // uppercase letters (e.g. "HyELP" → "HELP", "DUyE" → "DUE").
    return out.replace(/([A-Z])y([A-Z])/g, "$1$2");
  }
  return s;
}

/**
 * Normalises font-artifact capitalisation in a single word.
 * Google Sheets PDFs sometimes encode runs so that an interior letter decodes
 * as uppercase when the surrounding letters are lowercase — e.g. "BIll".
 * Detection: an uppercase letter that both (a) is preceded by an uppercase
 * letter and (b) is followed by a lowercase letter.  Only title-case the word
 * when that pattern is found; all-caps acronyms (e.g. "HELP") are left alone.
 * @param word - Single word token to normalise
 * @returns Word with artifact capitalisation corrected
 */
function fixWordCase(word: string): string {
  if (word.length < 2 || word === word.toUpperCase()) return word;
  let artifact = false;
  for (let i = 1; i < word.length - 1; i++) {
    if (/[A-Z]/.test(word[i]) && /[A-Z]/.test(word[i - 1]) && /[a-z]/.test(word[i + 1])) {
      artifact = true;
      break;
    }
  }
  return artifact ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word;
}

/**
 * Extracts PDF text operators (Tj / TJ) from a decoded content stream string.
 * @param content - Raw content stream text
 * @returns Array of decoded text strings from each text operator
 */
function extractTextOps(content: string): string[] {
  const out: string[] = [];
  // (text) Tj
  const tjRe = /\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*Tj/g;
  let m: RegExpExecArray | null;
  while ((m = tjRe.exec(content)) !== null) {
    const raw = m[1].replace(
      /\\([()\\nrtf])/g,
      (_, c: string) => ({ n: "\n", r: "\r", t: "\t", f: "\f" })[c] ?? c,
    );
    out.push(decodePdfString(raw));
  }
  // [(text) kern ...] TJ
  const tjArrRe = /\[([^\]]*)\]\s*TJ/g;
  while ((m = tjArrRe.exec(content)) !== null) {
    const parts = (m[1].match(/\(([^)]*)\)/g) ?? []).map((p) => p.slice(1, -1));
    if (parts.length) out.push(decodePdfString(parts.join("")));
  }
  return out;
}

/**
 * Extracts plain text from a PDF buffer.
 * Tries every stream segment: raw text operators first, then zlib decompression.
 * @param buffer - Raw PDF bytes.
 * @returns Concatenated text content from all content streams.
 */
function extractPdfText(buffer: Buffer): string {
  const str = buffer.toString("binary");
  const texts: string[] = [];

  const streamRe = /stream\r?\n([\s\S]+?)\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(str)) !== null) {
    const raw = m[1];
    const rawOps = extractTextOps(raw);
    if (rawOps.length > 0) {
      texts.push(...rawOps);
      continue;
    }
    try {
      const decompressed = inflateSync(Buffer.from(raw, "binary")).toString("latin1");
      texts.push(...extractTextOps(decompressed));
    } catch {
      // not a deflate stream — skip
    }
  }

  return texts.join(" ");
}

interface ParsedInvoiceData {
  clientName: string;
  clientEmail: string;
  issueDate: Date | null;
  dueDate: Date | null;
  total: number;
  subtotal: number;
}

/**
 * Extracts a numeric amount from text using a regex pattern.
 * @param text - Full invoice text to search
 * @param pattern - Regex with a capture group matching the amount string
 * @returns Parsed amount, or 0 if not matched
 */
function parseAmount(text: string, pattern: RegExp): number {
  const m = text.match(pattern);
  return m ? parseFloat(m[1].replace(",", "")) : 0;
}

/**
 * Parses text extracted from the legacy Google Sheets invoice PDF template.
 * @param text - Decoded plain text from the PDF
 * @returns Partial invoice data extracted from the text
 */
function parseLegacyInvoiceText(text: string): ParsedInvoiceData {
  // Allow optional spaces after the dollar sign to handle elements joined with spaces
  const subtotal = parseAmount(text, /Subtotal\s*\$?\s*([\d,]+\.?\d{0,2})/i);
  let total = parseAmount(text, /TOTAL\s+DUE\s*\$?\s*([\d,]+\.?\d{0,2})/i);
  // Fall back to subtotal if TOTAL DUE line not matched (no-GST invoices are equal anyway)
  if (total === 0 && subtotal > 0) total = subtotal;

  // Extract email first - needed by the secondary name lookup below.
  let clientEmail = "";
  const fromIdx = Math.max(
    text.search(/From\s+Harrison/i),
    text.search(/From\s+To\s+The\s+Point/i),
  );
  const searchArea = fromIdx > 0 ? text.slice(0, fromIdx) : text;
  const emailMatch = searchArea.match(/\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/);
  if (emailMatch) {
    const e = emailMatch[1];
    if (!e.includes("tothepoint.co.nz") && e !== "client@example.com") clientEmail = e;
  }

  // Pure template labels — never real names.
  const LABEL_LOWER = new Set([
    "to",
    "due",
    "date",
    "email",
    "from",
    "phone",
    "bank",
    "item",
    "qty",
    "unit",
    "price",
    "reference",
    "invoice",
    "tax",
    "name",
    "line",
    "total",
    "nzd",
    "subtotal",
    "client",
  ]);
  /**
   * Returns true if the string looks like an invoice reference number.
   * @param s - String to test
   * @returns True if s matches an invoice reference pattern
   */
  const isRef = (s: string): boolean => /^[A-Z]+-[\d-]+$/i.test(s);
  /**
   * Returns true if the word is a valid name token (capitalised, not a label, not a ref).
   * @param w - Word to test
   * @returns True if w is a valid name word
   */
  const nameWord = (w: string): boolean =>
    w.length > 1 &&
    /^[A-Z]/.test(w) &&
    !LABEL_LOWER.has(w.toLowerCase()) &&
    !/^\d/.test(w) &&
    !isRef(w);
  /**
   * Returns true if the string is a known template placeholder rather than a real name.
   * @param s - String to test
   * @returns True if s is a placeholder like "Client Name"
   */
  const isPlaceholder = (s: string): boolean => /^(client(\s+name)?|due[a-z]*)$/i.test(s.trim());
  let clientName = "";

  const billToPos = text.search(/bill\s+to\s+/i);

  // Primary: "Bill To" appears before the email (row-by-row PDF ordering).
  if (billToPos >= 0 && clientEmail) {
    const emailPos = text.indexOf(clientEmail);
    if (emailPos > billToPos) {
      const segment = text.slice(billToPos, emailPos).replace(/^bill\s+to\s+/i, "");
      const words = segment.split(/\s+/).filter(nameWord);
      if (words.length > 0) {
        const candidate = words.map(fixWordCase).join(" ");
        if (!isPlaceholder(candidate)) clientName = candidate;
      }
    }
  }

  // Secondary: stop-word regex — works when no email anchor is available.
  if (!clientName && billToPos >= 0) {
    const m = text.match(
      /bill\s+to\s+(.+?)(?=\s+(?:due\s+)?date\b|\s+email\b|\s+phone\b|\s+from\b)/i,
    );
    if (m) {
      const name = m[1].trim().replace(/\s+/g, " ");
      if (
        !isRef(name) &&
        !isPlaceholder(name) &&
        !name.split(" ").every((w) => LABEL_LOWER.has(w.toLowerCase()))
      ) {
        clientName = name.split(" ").map(fixWordCase).join(" ");
      }
    }
  }

  // Tertiary: column-by-column PDF ordering — email is extracted before the "Bill To" label.
  // In this layout the client name sits immediately before the email in the text stream.
  if (!clientName && clientEmail) {
    const emailPos = text.indexOf(clientEmail);
    if (emailPos > 0 && (billToPos < 0 || emailPos < billToPos)) {
      const pre = text.slice(Math.max(0, emailPos - 60), emailPos);
      const words = pre.split(/\s+/).filter(nameWord);
      if (words.length > 0) {
        const candidate = words.slice(-4).map(fixWordCase).join(" ");
        if (!isPlaceholder(candidate)) clientName = candidate;
      }
    }
  }

  // Fourth: collect consecutive name-words directly after "Bill To", stopping at the first
  // non-name token. "To" (from "To The Point") acts as the natural stop in these PDFs.
  if (!clientName && billToPos >= 0) {
    const afterBillTo = text.slice(billToPos).replace(/^bill\s+to\s+/i, "");
    const tokens = afterBillTo.split(/\s+/);
    const nameWords: string[] = [];
    for (const tok of tokens) {
      if (!tok || tok.length < 2) {
        if (nameWords.length > 0) break;
        continue;
      }
      if (
        /^\d/.test(tok) ||
        !/^[A-Z]/i.test(tok) ||
        LABEL_LOWER.has(tok.toLowerCase()) ||
        isRef(tok)
      ) {
        if (nameWords.length > 0) break;
        continue;
      }
      nameWords.push(fixWordCase(tok));
      if (nameWords.length >= 5) break;
    }
    if (nameWords.length > 0) {
      const candidate = nameWords.join(" ");
      if (!isPlaceholder(candidate)) clientName = candidate;
    }
  }

  if (!clientName) {
    const snippet = billToPos >= 0 ? text.slice(billToPos, billToPos + 300) : "(Bill To not found)";
    console.log(
      "[import-drive] name miss. billToPos=%d email=%j snippet=%j",
      billToPos,
      clientEmail,
      snippet,
    );
  }

  let issueDate: Date | null = null;
  const issueDateMatch = text.match(/Invoice\s*#?\s+\S+\s+Date\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  if (issueDateMatch) {
    const [, d, mo, y] = issueDateMatch;
    issueDate = new Date(`${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`);
  }

  let dueDate: Date | null = null;
  const dueDateMatch = text.match(/Due\s+Date\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  if (dueDateMatch) {
    const [, d, mo, y] = dueDateMatch;
    dueDate = new Date(`${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`);
  }

  return { clientName, clientEmail, issueDate, dueDate, total, subtotal };
}

/**
 * Downloads a PDF from Google Drive and parses its invoice data.
 * @param fileId - Google Drive file ID to download
 * @returns Object with parsed invoice data, or null if parsing failed
 */
async function downloadAndParse(fileId: string): Promise<{ data: ParsedInvoiceData | null }> {
  try {
    const pdfBuffer = await downloadDriveFile(fileId);
    const text = extractPdfText(pdfBuffer);
    return { data: parseLegacyInvoiceText(text) };
  } catch {
    return { data: null };
  }
}

/**
 * POST /api/business/invoices/import-drive
 * Creates invoice records for Drive PDFs with no matching DB entry.
 * Downloads each PDF, decodes the 2-byte shifted font encoding, and extracts
 * total, client name, email, and dates. Existing stubs (total=0, no line items)
 * are re-parsed and updated in-place.
 * @param request - Incoming Next.js request.
 * @returns JSON with counts of created, updated, skipped, and errored records.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const files = await searchAllInvoicePdfs();
    let created = 0;
    let skipped = 0;
    let updated = 0;
    let errors = 0;
    const seen = new Set<string>();

    for (const file of files) {
      const candidates = extractCandidates(file.name);
      if (candidates.length === 0) continue;

      const dedupeKey = candidates[0];
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      let existing = null;
      for (const number of candidates) {
        existing = await prisma.invoice.findFirst({ where: { number } });
        if (existing) break;
      }

      if (existing) {
        const BAD_NAMES = new Set(["bill to", "client name", "client", "due", "duye"]);
        const nameLC = existing.clientName?.toLowerCase().trim() ?? "";
        const hasYArtifact = /[A-Z]y[A-Z]/.test(existing.clientName ?? "");
        const isLabelWord = BAD_NAMES.has(nameLC) || /^due[a-z]*$/.test(nameLC);
        const isStub =
          (existing.total === 0 ||
            !existing.clientName ||
            isLabelWord ||
            nameLC.startsWith("bill to ") ||
            /^[a-z]+-[\d-]+$/.test(nameLC) || // stored as invoice number (e.g. "TTP-0004")
            hasYArtifact) && // name has uppercase-y-uppercase encoding artifact
          (existing.lineItems as unknown[]).length === 0;
        if (isStub || !existing.driveWebUrl) {
          const { data: parsed } = isStub ? await downloadAndParse(file.fileId) : { data: null };
          await prisma.invoice.update({
            where: { id: existing.id },
            data: {
              driveFileId: file.fileId,
              driveWebUrl: file.webUrl,
              // When re-parsing a stub, always write clientName (even empty) to clear garbled values.
              // For driveUrl-only updates (parsed=null), leave clientName untouched.
              ...(parsed && {
                clientName: parsed.clientName,
                ...(parsed.clientEmail && { clientEmail: parsed.clientEmail }),
                ...(parsed.issueDate && { issueDate: parsed.issueDate }),
                ...(parsed.dueDate && { dueDate: parsed.dueDate }),
                total: parsed.total,
                subtotal: parsed.subtotal,
              }),
            },
          });
          if (isStub) updated++;
        }
        skipped++;
        continue;
      }

      const number = candidates[0];
      const { data: parsed } = await downloadAndParse(file.fileId);
      const issueDate = parsed?.issueDate ?? estimateIssueDate(number);
      const dueDate = parsed?.dueDate ?? new Date(issueDate.getTime() + 14 * 24 * 60 * 60 * 1000);

      try {
        await prisma.invoice.create({
          data: {
            number,
            clientName: parsed?.clientName ?? "",
            clientEmail: parsed?.clientEmail ?? "",
            issueDate,
            dueDate,
            lineItems: [],
            gst: false,
            subtotal: parsed?.subtotal ?? 0,
            gstAmount: 0,
            total: parsed?.total ?? 0,
            status: "PAID",
            driveFileId: file.fileId,
            driveWebUrl: file.webUrl,
          },
        });
        created++;
      } catch {
        errors++;
      }
    }

    return NextResponse.json({ ok: true, created, skipped, updated, errors });
  } catch (err) {
    console.error("[import-drive] failed:", err);
    return NextResponse.json({ error: "Import failed" }, { status: 503 });
  }
}
