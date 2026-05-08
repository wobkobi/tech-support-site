import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";
import { parseAmount } from "@/features/business/lib/validation";

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

  const entry = await prisma.incomeEntry.create({
    data: {
      date: new Date(date),
      customer,
      description,
      amount: safeAmount,
      method,
      notes: notes ?? null,
      invoiceId: invoiceId ?? null,
    },
  });

  return NextResponse.json({ ok: true, entry }, { status: 201 });
}
