// src/app/api/health/route.ts
// Deployment health probe: public `{ ok, version }`; admin/cron callers also get DB and
// required-env checks (never values), with HTTP 503 when either fails.

import { isAdminRequest, isCronAuthorised } from "@/shared/lib/auth";
import { getEnvReport } from "@/shared/lib/env";
import { NextRequest, NextResponse } from "next/server";
import pkg from "../../../../package.json";

// Health must reflect live state, never a cached render.
export const dynamic = "force-dynamic";

/** Result of the database connectivity probe. */
interface DbCheck {
  /** True when the database answered the probe query. */
  ok: boolean;
  /** Error message when the probe failed; absent on success. */
  error?: string;
}

/**
 * Probe the database with a cheap `Setting` read; lazy Prisma import so init errors
 * report as a failed check instead of crashing the route.
 * @returns Whether the database answered, with the error message on failure.
 */
async function checkDatabase(): Promise<DbCheck> {
  try {
    const { prisma } = await import("@/shared/lib/prisma");
    await prisma.setting.findFirst({ select: { id: true } });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * GET /api/health - authenticated callers also get `{ checks: { db, env } }` and a 503 on failure.
 * @param request - The incoming request.
 * @returns Health JSON.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const version = pkg.version;

  const authed = (await isAdminRequest(request)) || isCronAuthorised(request);
  if (!authed) {
    return NextResponse.json({ ok: true, version });
  }

  const db = await checkDatabase();
  const env = getEnvReport();
  const missingRequired = env.filter((e) => e.required && !e.present).map((e) => e.name);
  const ok = db.ok && missingRequired.length === 0;

  return NextResponse.json(
    {
      ok,
      version,
      checks: {
        db,
        env: { ok: missingRequired.length === 0, missingRequired, vars: env },
      },
    },
    { status: ok ? 200 : 503 },
  );
}
