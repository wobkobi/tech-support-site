// src/app/api/admin/social/tags/route.ts
// Post tags: list them with their post counts, or add one (or get the one that has the name).

import { addTag, listTags } from "@/features/social/lib/tags.server";
import { errorResponse, noStore, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/admin/social/tags
 * @param request - Incoming request.
 * @returns JSON `{ tags }`, A-Z.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  return noStore(okResponse({ tags: await listTags() }));
}

/**
 * POST /api/admin/social/tags
 * Body: `{ name, colour? }`. A name an existing tag has hands that tag back.
 * @param request - Incoming request.
 * @returns JSON `{ tag }`, 201 when it's new.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    colour?: unknown;
  } | null;
  try {
    const result = await addTag({ name: body?.name, colour: body?.colour });
    if (!result.ok) return errorResponse(result.error, result.status);
    return okResponse({ tag: result.tag }, result.created ? 201 : 200);
  } catch (error) {
    console.error("[admin/social/tags] Add failed:", error);
    return errorResponse("Couldn't add the tag.", 500);
  }
}
