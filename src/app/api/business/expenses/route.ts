import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";
import { parseAmount, parseRate } from "@/features/business/lib/validation";

/**
 * GET /api/business/expenses - Returns all expense entries ordered by date descending.
 * @param request - Incoming Next.js request
 * @returns JSON with entries array
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const entries = await prisma.expenseEntry.findMany({ orderBy: { date: "desc" } });
  return NextResponse.json({ ok: true, entries });
}

/**
 * POST /api/business/expenses - Creates a new expense entry with server-side GST calculation.
 * @param request - Incoming Next.js request with expense data in body
 * @returns JSON with the created entry including calculated GST and excl amounts
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { date, supplier, description, category, amountIncl, gstRate, method, receipt, notes } =
    body;

  if (!date || !supplier || !description || !category || amountIncl === undefined || !method) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const inclNum = parseAmount(amountIncl);
  if (inclNum === null) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }

  const rate = gstRate === undefined ? 0.15 : parseRate(gstRate);
  if (rate === null) {
    return NextResponse.json({ error: "Invalid GST rate" }, { status: 400 });
  }

  const gstAmount = Math.round(((inclNum * rate) / (1 + rate)) * 100) / 100;
  const amountExcl = Math.round((inclNum - gstAmount) * 100) / 100;

  const entry = await prisma.expenseEntry.create({
    data: {
      date: new Date(date),
      supplier,
      description,
      category,
      amountIncl: inclNum,
      gstAmount,
      amountExcl,
      method,
      receipt: receipt ?? false,
      notes: notes ?? null,
    },
  });

  return NextResponse.json({ ok: true, entry }, { status: 201 });
}
