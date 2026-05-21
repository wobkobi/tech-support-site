// src/app/api/admin/contacts/check/route.ts
/**
 * @file route.ts
 * @description Lightweight existence check by email, used by the post-save
 * "Add to contacts?" popup to decide whether to prompt the operator.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";

/**
 * GET /api/admin/contacts/check?email=...
 * Returns { exists } for the given email (case-insensitive). Empty / invalid
 * email returns exists=false so callers can fail-quiet.
 * @param request - Incoming request.
 * @returns JSON { ok, exists }.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const email = request.nextUrl.searchParams.get("email")?.trim().toLowerCase() ?? "";
  if (!email || !email.includes("@")) {
    return NextResponse.json({ ok: true, exists: false });
  }

  const hit = await prisma.contact.findFirst({ where: { email }, select: { id: true } });
  return NextResponse.json({ ok: true, exists: Boolean(hit) });
}
