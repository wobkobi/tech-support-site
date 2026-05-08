import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/shared/lib/auth";
import { getInvoiceCounter, setInvoiceCounter } from "@/features/business/lib/google-sheets";

/**
 * GET /api/business/sheets/invoice-counter - Reads the next invoice number from the Google Sheet.
 * @param request - Incoming Next.js request
 * @returns JSON with lastNumber, nextNumber, yearCode, nextFormatted, and prefix
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const data = await getInvoiceCounter();
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    console.error("[sheets/invoice-counter] GET failed:", err);
    return NextResponse.json({ error: "Sheet unavailable" }, { status: 503 });
  }
}

/**
 * POST /api/business/sheets/invoice-counter - Writes the new invoice count back to the Google Sheet.
 * @param request - Incoming Next.js request with newCount in body
 * @returns JSON confirmation with the written count
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await request.json();
    const newCount = Number(body.newCount);
    if (!Number.isInteger(newCount) || newCount < 0) {
      return NextResponse.json(
        { error: "newCount must be a non-negative integer" },
        { status: 400 },
      );
    }
    await setInvoiceCounter(newCount);
    return NextResponse.json({ ok: true, written: newCount });
  } catch (err) {
    console.error("[sheets/invoice-counter] POST failed:", err);
    return NextResponse.json({ error: "Sheet write failed" }, { status: 503 });
  }
}
