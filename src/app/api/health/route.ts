// src/app/api/health/route.ts
/**
 * @description Deployment health probe. Public callers get `{ ok, version }` so
 * a post-deploy check can confirm the app serves and which version is live.
 * Admin- or cron-authenticated callers additionally get per-dependency checks -
 * database connectivity and required-env presence (never the values) - and the
 * response flips to HTTP 503 when a critical dependency or required env var is
 * missing. Consumed by the post-deploy smoke workflow.
 */

import { isAdminRequest, isCronAuthorized } from "@/shared/lib/auth";
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
 * Runs a cheap `Setting` read to confirm database connectivity. Imports the
 * Prisma client lazily and catches any error, so a database or init problem is
 * reported here as a failed check rather than crashing the route.
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
 * GET /api/health
 * Public: `{ ok, version }`. Authenticated (admin cookie / X-Admin-Secret /
 * cron Bearer): adds `{ checks: { db, env } }` and returns HTTP 503 when the
 * database is unreachable or a required env var is blank.
 * @param request - The incoming request.
 * @returns Health JSON.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const version = pkg.version;

  const authed = (await isAdminRequest(request)) || isCronAuthorized(request);
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
