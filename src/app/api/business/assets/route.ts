// src/app/api/business/assets/route.ts
// Admin asset register collection. GET lists every asset, newest in-service date first;
// POST validates the body with parseAssetBody, checks any expense link, then creates the
// asset. Site-only: nothing is written to the Google Sheet.

import { expenseLinkProblem } from "@/features/business/lib/asset-links.server";
import { parseAssetBody } from "@/features/business/lib/assets";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * Marks a response as never cacheable: the register changes with every save.
 * @param res - Response to mark.
 * @returns The same response.
 */
function noStore<T>(res: NextResponse<T>): NextResponse<T> {
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/**
 * GET /api/business/assets - Returns every asset, newest in-service date first.
 * @param request - Incoming Next.js request.
 * @returns JSON `{ ok: true, assets }`.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return noStore(errorResponse("Unauthorized", 401));
  const assets = await prisma.asset.findMany({ orderBy: { inServiceDate: "desc" } });
  return noStore(NextResponse.json({ ok: true, assets }));
}

/**
 * POST /api/business/assets - Creates an asset.
 * @param request - Incoming Next.js request with the asset fields in the body.
 * @returns JSON `{ ok: true, asset }` with 201, or `{ ok: false, error }`.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return noStore(errorResponse("Unauthorized", 401));

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noStore(errorResponse("Body must be JSON", 400));
  }
  const parsed = parseAssetBody(body);
  if (!parsed.ok) return noStore(errorResponse(parsed.error, 400));

  if (parsed.data.expenseId) {
    const problem = await expenseLinkProblem(parsed.data.expenseId, null);
    if (problem) return noStore(errorResponse(problem.error, problem.status));
  }

  const asset = await prisma.asset.create({ data: parsed.data });
  return noStore(NextResponse.json({ ok: true, asset }, { status: 201 }));
}
