import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";
import { parseAmount } from "@/features/business/lib/validation";
import {
  appendRowWithSyncId,
  formatDateForSheet,
  getFySheetIdForDate,
} from "@/features/business/lib/sheets-sync";

/**
 * GET /api/business/income - Returns all income entries ordered by date descending.
 * @param request - Incoming Next.js request
 * @returns JSON with entries array
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const entries = await prisma.incomeEntry.findMany({ orderBy: { date: "desc" } });
  return NextResponse.json({ ok: true, entries });
}

/**
 * POST /api/business/income - Creates a new income entry.
 * @param request - Incoming Next.js request with entry data in body
 * @returns JSON with the created entry
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { date, customer, description, amount, method, notes, invoiceId } = body;

  if (!date || !customer || !description || amount === undefined || !method) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const safeAmount = parseAmount(amount);
  if (safeAmount === null) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }

  const entryDate = new Date(date);
  const entry = await prisma.incomeEntry.create({
    data: {
      date: entryDate,
      customer,
      description,
      amount: safeAmount,
      method,
      notes: notes ?? null,
      invoiceId: invoiceId ?? null,
    },
  });

  // Append to the per-FY Cashbook sheet. Synchronous so the row is guaranteed
  // written before the response (Vercel can otherwise terminate the function
  // before a fire-and-forget Promise resolves). Failures are logged and swallowed
  // so a sheet outage never blocks income recording in the DB.
  let sheetRowKey: string | null = null;
  try {
    const spreadsheetId = await getFySheetIdForDate(entryDate);
    if (!spreadsheetId) {
      console.warn(
        `[income] No FY sheet found for ${entryDate.toISOString()} - skipping sheet append`,
      );
    } else {
      // Cashbook columns A..H: Date, Customer, Description, Method, Amount, Cash Deposit Ref, Tax Put-Aside, Notes
      const cells = [
        formatDateForSheet(entryDate),
        customer,
        description,
        method,
        safeAmount,
        "",
        "",
        notes ?? "",
      ];
      sheetRowKey = await appendRowWithSyncId(spreadsheetId, "Cashbook", cells);
      await prisma.incomeEntry.update({ where: { id: entry.id }, data: { sheetRowKey } });
    }
  } catch (err) {
    console.error(`[income] Failed to append to sheet for entry ${entry.id}:`, err);
  }

  return NextResponse.json({ ok: true, entry: { ...entry, sheetRowKey } }, { status: 201 });
}
