// src/app/api/admin/settings/[group]/route.ts
/**
 * @file route.ts
 * @description Admin read/write for one settings group. GET returns the resolved
 * group (defaults + DB override); PUT validates the payload, runs cross-setting
 * guardrails on the full proposed settings, then persists. Guardrail BLOCKs
 * always reject; WARNs reject unless the client confirms.
 */

import { isAdminRequest } from "@/shared/lib/auth";
import { DEFAULT_SETTINGS } from "@/shared/lib/settings/defaults";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { saveSettingsGroup } from "@/shared/lib/settings/set-settings";
import type { Settings, SettingsGroup } from "@/shared/lib/settings/types";
import { checkGuardrails, validateGroup } from "@/shared/lib/settings/validate";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GROUPS = Object.keys(DEFAULT_SETTINGS) as SettingsGroup[];

/**
 * Narrows a raw route param to a known settings group.
 * @param value - Raw `[group]` path segment.
 * @returns The group when valid, else null.
 */
function asGroup(value: string): SettingsGroup | null {
  return (GROUPS as string[]).includes(value) ? (value as SettingsGroup) : null;
}

/**
 * GET /api/admin/settings/[group] - returns the resolved value for one group.
 * @param request - Incoming request (admin-gated).
 * @param ctx - Route context carrying the `[group]` param.
 * @param ctx.params - Promised route params.
 * @returns JSON `{ ok, value }` or an error.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ group: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const group = asGroup((await params).group);
  if (!group) return NextResponse.json({ error: "Unknown settings group" }, { status: 404 });

  const settings = await getSettings();
  return NextResponse.json({ ok: true, value: settings[group] });
}

/**
 * PUT /api/admin/settings/[group] - validates + saves one group.
 *
 * Body: `{ value: Settings[group], confirmWarnings?: boolean }`.
 * Responses: 400 field errors, 409 guardrail warnings (resend with
 * `confirmWarnings`), 422 guardrail blocks, 200 on success.
 * @param request - Incoming request (admin-gated).
 * @param ctx - Route context carrying the `[group]` param.
 * @param ctx.params - Promised route params.
 * @returns JSON describing the outcome.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ group: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const group = asGroup((await params).group);
  if (!group) return NextResponse.json({ error: "Unknown settings group" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as {
    value?: unknown;
    confirmWarnings?: boolean;
  } | null;
  if (!body || typeof body.value !== "object" || body.value === null) {
    return NextResponse.json({ error: "Missing value" }, { status: 400 });
  }

  const value = body.value as Settings[typeof group];

  // 1. Per-field shape + bounds.
  const fieldErrors = validateGroup(group, value);
  if (fieldErrors.length > 0) {
    return NextResponse.json({ error: "Invalid", fieldErrors }, { status: 400 });
  }

  // 2. Cross-setting coherence on the full proposed settings. Assign via a
  // widening cast - a computed-key object literal trips the union-key rule.
  const proposed: Settings = { ...(await getSettings()) };
  (proposed as Record<SettingsGroup, unknown>)[group] = value;
  const issues = checkGuardrails(proposed);
  const blocks = issues.filter((i) => i.level === "block").map((i) => i.message);
  const warns = issues.filter((i) => i.level === "warn").map((i) => i.message);
  if (blocks.length > 0) {
    return NextResponse.json({ error: "Blocked", blocks }, { status: 422 });
  }
  if (warns.length > 0 && !body.confirmWarnings) {
    return NextResponse.json({ error: "Confirm", warns }, { status: 409 });
  }

  await saveSettingsGroup(group, value);
  return NextResponse.json({ ok: true, value });
}
