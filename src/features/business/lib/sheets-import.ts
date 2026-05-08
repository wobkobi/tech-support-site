import { prisma } from "@/shared/lib/prisma";
import { getSheetsClient, getSheetId } from "@/features/business/lib/google-sheets";
import { listSpreadsheetsInFolder } from "@/features/business/lib/google-drive";
import { calcGstFromInclusive } from "@/features/business/lib/business";

/**
 * Parses a raw date string in DD/MM/YYYY, YYYY-MM-DD, or JS Date format.
 * @param raw - Raw cell value from the sheet.
 * @returns Parsed Date, or null if not a valid date.
 */
function parseDate(raw: string): Date | null {
  const t = raw.trim();
  const dmy = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const d = new Date(`${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`);
    return isNaN(d.getTime()) ? null : d;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const d = new Date(t);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Strips currency symbols and commas, returning a float or null.
 * @param raw - Raw cell value.
 * @returns Parsed number or null.
 */
function parseAmount(raw: string): number | null {
  const n = parseFloat(raw.replace(/[$,\s]/g, ""));
  return isNaN(n) ? null : n;
}

/**
 * Parses a GST rate string like "15%" or "0.15" into a decimal fraction.
 * @param raw - Raw cell value.
 * @returns GST rate as a decimal (e.g. 0.15).
 */
function parseGstRate(raw: string): number {
  const t = raw.trim();
  if (t.endsWith("%")) {
    const n = parseFloat(t);
    return isNaN(n) ? 0.15 : n / 100;
  }
  const n = parseFloat(t);
  return isNaN(n) ? 0.15 : n > 1 ? n / 100 : n;
}

export interface PerSheetCounts {
  /** Drive file ID of the spreadsheet that was imported. */
  fileId: string;
  /** Display name of the spreadsheet. */
  name: string;
  incomeImported: number;
  incomeSkipped: number;
  expensesImported: number;
  expensesSkipped: number;
  errors: string[];
}

export interface ImportResult {
  ok: boolean;
  /** Aggregated counts across every spreadsheet processed. */
  incomeImported: number;
  incomeSkipped: number;
  expensesImported: number;
  expensesSkipped: number;
  errors: string[];
  /** Per-spreadsheet breakdown when scanning a Drive folder. */
  perSheet?: PerSheetCounts[];
  /** Source mode used: "folder" when scanning, "single" when falling back to GOOGLE_SHEET_ID. */
  source?: "folder" | "single";
}

/**
 * Reads the Cashbook and Expenses tabs of a single spreadsheet and imports
 * (or previews) rows. Dedup is by date + amount + description so re-running
 * is a no-op. Errors on individual rows are captured and do not abort the run.
 * @param spreadsheetId - The Google Sheet ID to read.
 * @param dryRun - When true, counts rows without writing to the database.
 * @returns Counts and any row-level errors.
 */
async function importFromSheet(
  spreadsheetId: string,
  dryRun: boolean,
): Promise<{
  incomeImported: number;
  incomeSkipped: number;
  expensesImported: number;
  expensesSkipped: number;
  errors: string[];
}> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: ["Cashbook!A:H", "Expenses!A:K"],
  });

  const [cashbookRange, expensesRange] = res.data.valueRanges ?? [];
  const cashRows: string[][] = (cashbookRange?.values ?? []) as string[][];
  const expRows: string[][] = (expensesRange?.values ?? []) as string[][];

  let incomeImported = 0;
  let incomeSkipped = 0;
  let expensesImported = 0;
  let expensesSkipped = 0;
  const errors: string[] = [];

  for (let i = 0; i < cashRows.length; i++) {
    const row = cashRows[i];
    const date = parseDate(row[0] ?? "");
    if (!date) {
      incomeSkipped++;
      continue;
    }
    const customer = (row[1] ?? "").trim();
    const description = (row[2] ?? "").trim();
    const method = (row[3] ?? "").trim();
    const amount = parseAmount(row[4] ?? "");
    const notes = (row[7] ?? "").trim() || null;

    if (!customer || !description || amount === null || amount <= 0) {
      incomeSkipped++;
      continue;
    }

    const existing = await prisma.incomeEntry.findFirst({ where: { date, amount, description } });
    if (existing) {
      incomeSkipped++;
      continue;
    }
    if (!dryRun) {
      try {
        await prisma.incomeEntry.create({
          data: { date, customer, description, amount, method: method || "Unknown", notes },
        });
        incomeImported++;
      } catch (err) {
        errors.push(`Income row ${i + 1}: ${String(err)}`);
        incomeSkipped++;
      }
    } else {
      incomeImported++;
    }
  }

  for (let i = 0; i < expRows.length; i++) {
    const row = expRows[i];
    const date = parseDate(row[0] ?? "");
    if (!date) {
      expensesSkipped++;
      continue;
    }
    const supplier = (row[1] ?? "").trim();
    const description = (row[2] ?? "").trim();
    const category = (row[3] ?? "Other").trim();
    const method = (row[4] ?? "").trim();
    const receiptRaw = (row[5] ?? "").trim().toLowerCase();
    const receipt = receiptRaw === "yes" || receiptRaw === "true";
    const amountIncl = parseAmount(row[6] ?? "");
    const gstRate = parseGstRate(row[7] ?? "15%");
    const notes = (row[10] ?? "").trim() || null;

    if (!supplier || !description || amountIncl === null || amountIncl <= 0) {
      expensesSkipped++;
      continue;
    }

    const gstAmount = calcGstFromInclusive(amountIncl, gstRate);
    const amountExcl = Math.round((amountIncl - gstAmount) * 100) / 100;

    const existing = await prisma.expenseEntry.findFirst({
      where: { date, amountIncl, description },
    });
    if (existing) {
      expensesSkipped++;
      continue;
    }
    if (!dryRun) {
      try {
        await prisma.expenseEntry.create({
          data: {
            date,
            supplier,
            description,
            category: category || "Other",
            amountIncl,
            gstAmount,
            amountExcl,
            method: method || "Unknown",
            receipt,
            notes,
          },
        });
        expensesImported++;
      } catch (err) {
        errors.push(`Expense row ${i + 1}: ${String(err)}`);
        expensesSkipped++;
      }
    } else {
      expensesImported++;
    }
  }

  return { incomeImported, incomeSkipped, expensesImported, expensesSkipped, errors };
}

/**
 * Imports Cashbook and Expenses rows. When `GOOGLE_BUSINESS_SHEETS_FOLDER_ID`
 * is set, scans that Drive folder and imports every spreadsheet inside; this
 * is the path you want for one-sheet-per-financial-year. Otherwise falls back
 * to importing from `GOOGLE_SHEET_ID` only.
 * @param dryRun - When true, counts rows without writing to the database.
 * @returns Aggregate counts plus a per-spreadsheet breakdown.
 */
export async function runSheetsImport(dryRun: boolean): Promise<ImportResult> {
  const folderId = process.env.GOOGLE_BUSINESS_SHEETS_FOLDER_ID?.trim();

  if (folderId) {
    const sheetsToImport = await listSpreadsheetsInFolder(folderId);
    const aggregate: Omit<ImportResult, "ok" | "perSheet" | "source"> = {
      incomeImported: 0,
      incomeSkipped: 0,
      expensesImported: 0,
      expensesSkipped: 0,
      errors: [],
    };
    const perSheet: PerSheetCounts[] = [];

    for (const sheet of sheetsToImport) {
      try {
        const counts = await importFromSheet(sheet.fileId, dryRun);
        aggregate.incomeImported += counts.incomeImported;
        aggregate.incomeSkipped += counts.incomeSkipped;
        aggregate.expensesImported += counts.expensesImported;
        aggregate.expensesSkipped += counts.expensesSkipped;
        aggregate.errors.push(...counts.errors.map((e) => `[${sheet.name}] ${e}`));
        perSheet.push({ fileId: sheet.fileId, name: sheet.name, ...counts });
      } catch (err) {
        const message = `[${sheet.name}] ${String(err)}`;
        aggregate.errors.push(message);
        perSheet.push({
          fileId: sheet.fileId,
          name: sheet.name,
          incomeImported: 0,
          incomeSkipped: 0,
          expensesImported: 0,
          expensesSkipped: 0,
          errors: [message],
        });
      }
    }

    return { ok: true, source: "folder", perSheet, ...aggregate };
  }

  const counts = await importFromSheet(getSheetId(), dryRun);
  return { ok: true, source: "single", ...counts };
}
