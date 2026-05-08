import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";

/**
 * GET /api/business/summary - Returns aggregated income, expense, profit, and tax reserve stats.
 * @param request - Incoming Next.js request
 * @returns JSON with summary object
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const [incomeEntries, expenseEntries] = await Promise.all([
    prisma.incomeEntry.findMany({ select: { amount: true, date: true } }),
    prisma.expenseEntry.findMany({ select: { amountExcl: true, gstAmount: true, date: true } }),
  ]);

  const totalIncome = incomeEntries.reduce((s, e) => s + e.amount, 0);
  const totalExpensesExcl = expenseEntries.reduce((s, e) => s + e.amountExcl, 0);
  const totalGstClaimable = expenseEntries.reduce((s, e) => s + e.gstAmount, 0);

  const currentMonthIncome = incomeEntries
    .filter((e) => e.date >= monthStart && e.date < monthEnd)
    .reduce((s, e) => s + e.amount, 0);

  const currentMonthExpenses = expenseEntries
    .filter((e) => e.date >= monthStart && e.date < monthEnd)
    .reduce((s, e) => s + e.amountExcl, 0);

  return NextResponse.json({
    ok: true,
    summary: {
      totalIncome,
      totalExpensesExcl,
      totalGstClaimable,
      taxReserve: Math.round(totalIncome * 0.2 * 100) / 100,
      profit: Math.round((totalIncome - totalExpensesExcl) * 100) / 100,
      currentMonthIncome,
      currentMonthExpenses,
      incomeCount: incomeEntries.length,
      expenseCount: expenseEntries.length,
    },
  });
}
