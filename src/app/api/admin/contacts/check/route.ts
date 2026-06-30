// src/app/api/admin/contacts/check/route.ts
/**
 * @description Lightweight existence check by email, used by the post-save
 * "Add to contacts?" popup to decide whether to prompt the operator.
 */

import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/admin/contacts/check?email=...
 * Returns { exists } for the given email (case-insensitive). Empty / invalid
 * email returns exists=false so callers can fail-quiet.
 * @param request - Incoming request.
 * @returns JSON { ok, exists }.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const email = request.nextUrl.searchParams.get("email")?.trim().toLowerCase() ?? "";
  if (!email || !email.includes("@")) {
    return NextResponse.json({ ok: true, exists: false });
  }

  const hit = await prisma.contact.findFirst({ where: { email }, select: { id: true } });
  return NextResponse.json({ ok: true, exists: Boolean(hit) });
}
