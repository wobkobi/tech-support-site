// src/app/api/admin/social/designs/route.ts
// Post maker designs: list them, or create one - blank, or as a copy of another
// design or template (opening a template, duplicating, "save as template").

import { parseObjectId } from "@/features/business/lib/validation";
import {
  blankDoc,
  DESIGN_KINDS,
  toDesignSummary,
  toKind,
  type DesignKind,
} from "@/features/social-design/lib/design-row";
import { errorResponse, noStore, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import type { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/admin/social/designs - every design and template, last edited first.
 * @param request - Incoming request.
 * @returns JSON `{ designs }`.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const rows = await prisma.socialDesign.findMany({ orderBy: { updatedAt: "desc" } });
  return noStore(okResponse({ designs: rows.map(toDesignSummary) }));
}

/**
 * POST /api/admin/social/designs - creates a design.
 * Body: `{ source: "blank" | "copy", sourceId?, kind?, asTemplate? }`.
 * @param request - Incoming request.
 * @returns JSON `{ design }` (summary), 201.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const body = (await request.json().catch(() => null)) as {
    source?: string;
    sourceId?: unknown;
    kind?: unknown;
    asTemplate?: unknown;
  } | null;
  const asTemplate = body?.asTemplate === true;

  if (body?.source === "blank") {
    const kind: DesignKind =
      typeof body.kind === "string" && (DESIGN_KINDS as readonly string[]).includes(body.kind)
        ? toKind(body.kind)
        : "blank";
    const created = await prisma.socialDesign.create({
      data: {
        name: asTemplate ? "New template" : "New design",
        kind,
        isTemplate: asTemplate,
        doc: blankDoc() as unknown as Prisma.InputJsonValue,
      },
    });
    return okResponse({ design: toDesignSummary(created) }, 201);
  }

  if (body?.source === "copy") {
    const sourceId = parseObjectId(body.sourceId);
    if (!sourceId) return errorResponse("sourceId isn't a valid id.", 400);
    const source = await prisma.socialDesign.findUnique({ where: { id: sourceId } });
    if (!source) return errorResponse("That design no longer exists.", 404);
    // Starting a design from a template keeps its name; any other copy says it's one.
    const name = source.isTemplate && !asTemplate ? source.name : `${source.name} (copy)`;
    // Exports aren't copied: they belong to the source, and its clean-up may delete them.
    const created = await prisma.socialDesign.create({
      data: {
        name,
        kind: source.kind,
        isTemplate: asTemplate,
        doc: source.doc as Prisma.InputJsonValue,
      },
    });
    return okResponse({ design: toDesignSummary(created) }, 201);
  }

  return errorResponse("source must be blank or copy.", 400);
}
