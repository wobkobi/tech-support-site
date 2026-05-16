import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";

/**
 * GET /api/business/task-templates/taxonomy
 * Returns the distinct device + action values currently in use across all
 * task templates, sorted alphabetically. Powers the Calculator combobox
 * suggestions and the manage-tags modal.
 * @param request - Incoming Next.js request.
 * @returns JSON with `{ ok, devices: string[], actions: string[] }`.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Pull just the two columns we need; cheaper than fetching the whole table.
  const rows = await prisma.taskTemplate.findMany({
    select: { device: true, action: true },
  });

  const devices = Array.from(
    new Set(rows.map((r) => r.device).filter((v): v is string => !!v && v.length > 0)),
  ).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));

  const actions = Array.from(
    new Set(rows.map((r) => r.action).filter((v): v is string => !!v && v.length > 0)),
  ).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));

  return NextResponse.json({ ok: true, devices, actions });
}
