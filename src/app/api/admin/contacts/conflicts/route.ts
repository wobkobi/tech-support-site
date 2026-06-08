// src/app/api/admin/contacts/conflicts/route.ts
/**
 * @file route.ts
 * @description Admin endpoint listing pending Google Contacts sync conflicts.
 */

import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/admin/contacts/conflicts
 * Returns unresolved ContactConflict rows joined with their contact name/email.
 * Requires X-Admin-Secret header.
 * @param request - Incoming request.
 * @returns JSON `{ ok, conflicts }` or an error.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const conflicts = await prisma.contactConflict.findMany({
      where: { resolvedAt: null },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    const contactIds = Array.from(new Set(conflicts.map((c) => c.contactId)));
    const contacts =
      contactIds.length > 0
        ? await prisma.contact.findMany({
            where: { id: { in: contactIds } },
            select: { id: true, name: true, email: true },
          })
        : [];
    const contactById = new Map(contacts.map((c) => [c.id, c]));

    return NextResponse.json({
      ok: true,
      conflicts: conflicts.map((c) => ({
        id: c.id,
        contactId: c.contactId,
        contactName: contactById.get(c.contactId)?.name ?? "Unknown",
        contactEmail: contactById.get(c.contactId)?.email ?? null,
        field: c.field,
        siteValue: c.siteValue,
        googleValue: c.googleValue,
        createdAt: c.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("[admin/contacts/conflicts] GET error:", err);
    return NextResponse.json({ error: "Failed to load conflicts" }, { status: 500 });
  }
}
