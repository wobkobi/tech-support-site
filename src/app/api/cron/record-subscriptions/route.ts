import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isCronAuthorized } from "@/shared/lib/auth";
import {
  advanceNextDue,
  calcGstFromInclusive,
  formatUTCDDMMYYYY,
} from "@/features/business/lib/business";
import { getSheetsClient, getSheetId } from "@/features/business/lib/google-sheets";

/**
 * GET /api/cron/record-subscriptions
 * Records all active subscriptions due today or earlier (NZ time).
 * Run daily at 8am NZ time via cron-job.org.
 * @param request - Incoming cron request.
 * @returns JSON with count of recorded subscriptions and any errors.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get start of today in NZ time as a UTC timestamp for comparison
  const nzDateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const todayNZ = new Date(nzDateStr + "T00:00:00.000Z");

  const due = await prisma.subscription.findMany({
    where: { isActive: true, nextDue: { lte: todayNZ } },
  });

  const recorded: string[] = [];
  const errors: string[] = [];

  for (const sub of due) {
    try {
      const today = new Date();
      const rate = sub.gstRate;
      const inclNum = sub.amountIncl;
      const gstAmount = calcGstFromInclusive(inclNum, rate);
      const amountExcl = Math.round((inclNum - gstAmount) * 100) / 100;

      await prisma.expenseEntry.create({
        data: {
          date: today,
          supplier: sub.supplier,
          description: sub.description,
          category: sub.category,
          amountIncl: inclNum,
          gstAmount,
          amountExcl,
          method: sub.method,
          receipt: false,
          notes: sub.notes,
        },
      });

      const nextDue = advanceNextDue(sub.nextDue, sub.frequency);
      await prisma.subscription.update({ where: { id: sub.id }, data: { nextDue } });

      try {
        const sheets = getSheetsClient();
        const spreadsheetId = getSheetId();
        const gstPct = `${Math.round(rate * 100)}%`;
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: "Expenses!A:K",
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [
              [
                formatUTCDDMMYYYY(today),
                sub.supplier,
                sub.description,
                sub.category,
                sub.method,
                "No",
                inclNum,
                gstPct,
                gstAmount,
                amountExcl,
                sub.notes ?? "",
              ],
            ],
          },
        });
      } catch (sheetErr) {
        console.error(`[cron/record-subscriptions] Sheet append failed for ${sub.id}:`, sheetErr);
      }

      recorded.push(sub.id);
    } catch (err) {
      console.error(`[cron/record-subscriptions] Failed to record ${sub.id}:`, err);
      errors.push(`${sub.description}: ${String(err)}`);
    }
  }

  return NextResponse.json({ ok: true, recorded: recorded.length, errors });
}
