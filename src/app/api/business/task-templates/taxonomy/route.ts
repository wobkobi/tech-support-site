// src/app/api/business/task-templates/taxonomy/route.ts
// Admin task-template taxonomy endpoint. GET returns the device and action tags in use
// across all templates - one entry per case-insensitive tag, sorted alphabetically - to
// power the manage-tags modal.
//
// Casing does not make a second tag: everything downstream matches tags
// case-insensitively, so listing "PC" and "Pc" as two rows would offer two handles on one
// tag and let a Clear aimed at either take both. Rival casings ride along in `variants`
// so a split spelling stays visible and the operator can rename it away.

import { collectTaxonomyTags } from "@/features/business/lib/task-taxonomy";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/business/task-templates/taxonomy
 * Returns the device + action tags currently in use across all task templates,
 * collapsed to one entry per case-insensitive tag and sorted alphabetically.
 * Powers the manage-tags modal.
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
