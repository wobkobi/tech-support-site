// src/app/api/admin/contacts/route.ts
/**
 * @file route.ts
 * @description Admin API for listing contacts.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";

/**
 * GET /api/admin/contacts
 * Returns all contacts ordered by newest first.
 * Requires X-Admin-Secret header.
 * @param request - Incoming request.
 * @returns JSON with contacts array.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contacts = await prisma.contact.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      address: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ ok: true, contacts });
}
