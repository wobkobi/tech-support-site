import { aggregateByFinancialYear } from "@/features/business/lib/financial-year";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/business/summary - Returns aggregated income, expense, profit, and tax reserve stats,
 * plus per-NZ-financial-year breakdowns.
 * @param request - Incoming Next.js request
 * @returns JSON with summary object and financialYears array (most recent first)
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
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

  const { incomeTax } = (await getSettings()).tax;
  const startDate = new Date((await getIdentity()).startDateIso);
  const fyTotals = aggregateByFinancialYear(
    incomeEntries,
    expenseEntries,
    now,
    incomeTax,
    startDate,
  );

  return NextResponse.json({
    ok: true,
    summary: {
      totalIncome,
      totalExpensesExcl,
      totalGstClaimable,
      taxReserve: Math.round(totalIncome * incomeTax * 100) / 100,
      profit: Math.round((totalIncome - totalExpensesExcl) * 100) / 100,
      currentMonthIncome,
      currentMonthExpenses,
      incomeCount: incomeEntries.length,
      expenseCount: expenseEntries.length,
    },
    financialYears: fyTotals.map((row) => ({
      label: row.fy.label,
      start: row.fy.start.toISOString(),
      end: row.fy.end.toISOString(),
      current: row.fy.current,
      partial: row.fy.partial,
      income: row.income,
      expensesExcl: row.expensesExcl,
      gstClaimable: row.gstClaimable,
      profit: row.profit,
      taxReserve: row.taxReserve,
      incomeCount: row.incomeCount,
      expenseCount: row.expenseCount,
    })),
  });
}
