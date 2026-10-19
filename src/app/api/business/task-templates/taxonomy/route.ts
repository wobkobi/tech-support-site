// src/app/api/business/task-templates/taxonomy/route.ts
// Admin task-template taxonomy endpoint for the manage-tags modal. Tags collapse
// case-insensitively (downstream matching is case-insensitive); rival casings ride
// along in `variants` so they can be renamed away.

import { collectTaxonomyTags } from "@/features/business/lib/task-taxonomy";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/business/task-templates/taxonomy
 * Returns the device + action tags in use, one per case-insensitive tag, sorted.
 * @param request - Incoming Next.js request.
 * @returns JSON with `{ ok, devices: TaxonomyTag[], actions: TaxonomyTag[] }`.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  // Pull just the columns needed; usageCount decides which casing is canonical.
  const rows = await prisma.taskTemplate.findMany({
    select: { device: true, action: true, usageCount: true },
  });

  return NextResponse.json({
    ok: true,
    devices: collectTaxonomyTags(rows, "device"),
    actions: collectTaxonomyTags(rows, "action"),
  });
}
