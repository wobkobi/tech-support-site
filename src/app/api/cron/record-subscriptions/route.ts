// src/app/api/cron/record-subscriptions/route.ts
/**
 * @description Cron endpoint (Bearer-authorised) that records every active
 * subscription due today or earlier in NZ time. GET creates an ExpenseEntry per
 * subscription, advances nextDue with a CAS guard so concurrent runs stay
 * idempotent, and appends each row to the Expenses Google Sheet. Run daily at
 * 8am NZ time via cron-job.org.
 */

import {
  advanceNextDue,
  calcGstFromInclusive,
  formatUTCDDMMYYYY,
} from "@/features/business/lib/business";
import { getSheetId, getSheetsClient } from "@/features/business/lib/google-sheets";
import { errorResponse } from "@/shared/lib/api-response";
import { isCronAuthorized } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * GET /api/cron/record-subscriptions
 * Records all active subscriptions due today or earlier (NZ time).
 * Run daily at 8am NZ time via cron-job.org.
 * @param request - Incoming cron request.
 * @returns JSON with count of recorded subscriptions and any errors.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(request)) {
    return errorResponse("Unauthorized", 401);
  }

  // nextDue is stored as UTC midnight (admin form + advanceNextDue), so UTC
  // midnight of today's NZ date is the correct ceiling for `nextDue <=`.
  const nzDateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const todayNZ = new Date(nzDateStr + "T00:00:00.000Z");

  // Find subscriptions due today
  const due = await prisma.subscription.findMany({
    where: { isActive: true, nextDue: { lte: todayNZ } },
  });

  const recorded: string[] = [];
  const errors: string[] = [];

  const skipped: string[] = [];

  for (const sub of due) {
    try {
      // Compute GST split and next due date
      const today = new Date();
      const rate = sub.gstRate;
      const inclNum = sub.amountIncl;
      const gstAmount = calcGstFromInclusive(inclNum, rate);
      const amountExcl = Math.round((inclNum - gstAmount) * 100) / 100;
      const nextDue = advanceNextDue(sub.nextDue, sub.frequency);

      // CAS on nextDue makes concurrent runs idempotent. Post-CAS errors leave
      // admin to re-record manually - safer than risking a duplicate.
      const claim = await prisma.subscription.updateMany({
        where: { id: sub.id, nextDue: sub.nextDue },
        data: { nextDue },
      });
      if (claim.count === 0) {
        skipped.push(sub.id);
        continue;
      }

      // Record the expense entry
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

      // Append to the expenses sheet
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

  return NextResponse.json({
    ok: true,
    recorded: recorded.length,
    skipped: skipped.length,
    errors,
  });
}
