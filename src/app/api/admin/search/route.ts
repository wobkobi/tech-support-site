// src/app/api/admin/search/route.ts
// Admin global search: returns contacts, bookings, invoices and reviews matching `q`,
// grouped by kind, for the search dialog in the admin top bar.

import {
  MAX_QUERY_LENGTH,
  MIN_QUERY_LENGTH,
  searchAdmin,
  type SearchGroups,
} from "@/features/admin/lib/global-search";
import { errorResponse, noStore } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/admin/search?q=<text>
 * Trims `q` and cuts it to {@link MAX_QUERY_LENGTH} characters. Under
 * {@link MIN_QUERY_LENGTH} it returns four empty groups without touching the
 * database.
 * @param request - Incoming Next.js request.
 * @returns JSON `{ ok: true, groups }`, or `{ ok: false, error }` on failure.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  if (q.length < MIN_QUERY_LENGTH) {
    const groups: SearchGroups = { contacts: [], bookings: [], invoices: [], reviews: [] };
    return noStore(NextResponse.json({ ok: true, groups }));
  }

  try {
    return noStore(NextResponse.json({ ok: true, groups: await searchAdmin(q) }));
  } catch (err) {
    console.error("[admin/search] failed:", err);
    return noStore(errorResponse("Search failed.", 500));
  }
}
