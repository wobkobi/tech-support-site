// src/app/api/admin/mailing/route.ts
// Mailing-list emails: list them, or create one - blank, from a preset, as a copy of
// another (including "save as preset"), or from a promo via "Email this promo".

import { findAdvertisablePromo } from "@/features/business/lib/promos";
import { parseObjectId } from "@/features/business/lib/validation";
import { toCampaignRow } from "@/features/mailing/lib/campaign-row";
import { PROMO_PRESET_KEY, starterPresets } from "@/features/mailing/lib/presets";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { getSiteUrl } from "@/shared/lib/site-url";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/admin/mailing - every campaign and preset, newest first.
 * @param request - Incoming request.
 * @returns JSON `{ campaigns }`.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const rows = await prisma.campaign.findMany({ orderBy: { updatedAt: "desc" } });
  return okResponse({ campaigns: rows.map(toCampaignRow) });
}

/**
 * POST /api/admin/mailing - creates a campaign.
 * Body: `{ source: "blank" | "copy" | "promo", sourceId?, promoId?, asPreset? }`.
 * "copy" covers starting from a preset, duplicating, and saving as a preset.
 * @param request - Incoming request.
 * @returns JSON `{ campaign }`.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const body = (await request.json().catch(() => null)) as {
    source?: string;
    sourceId?: unknown;
    promoId?: unknown;
    asPreset?: unknown;
  } | null;
  const asPreset = body?.asPreset === true;

  try {
    if (body?.source === "blank") {
      const created = await prisma.campaign.create({
        data: {
          name: asPreset ? "New preset" : "Untitled email",
          subject: "",
          body: "Hi {firstName},\n\n",
          isPreset: asPreset,
        },
      });
      return okResponse({ campaign: toCampaignRow(created) }, 201);
    }

    if (body?.source === "copy") {
      const sourceId = parseObjectId(body.sourceId);
      if (!sourceId) return errorResponse("sourceId isn't a valid id.", 400);
      const source = await prisma.campaign.findUnique({ where: { id: sourceId } });
      if (!source) return errorResponse("That email no longer exists.", 404);
      // Starting a draft from a preset keeps its name; any other copy says it's one.
      const name = source.isPreset && !asPreset ? source.name : `${source.name} (copy)`;
      const created = await prisma.campaign.create({
        data: {
          name,
          subject: source.subject,
          preheader: source.preheader,
          body: source.body,
          promoId: source.promoId,
          isPreset: asPreset,
        },
      });
      return okResponse({ campaign: toCampaignRow(created) }, 201);
    }

    if (body?.source === "promo") {
      const promoId = parseObjectId(body.promoId);
      if (!promoId) return errorResponse("promoId isn't a valid id.", 400);
      const promo = await findAdvertisablePromo(promoId);
      if (!promo) {
        return errorResponse(
          "Only an automatic promo that's running right now can be emailed.",
          400,
        );
      }
      // The operator may have reworded or deleted the promo preset; fall back to the
      // starter wording only when it's gone.
      const preset =
        (await prisma.campaign.findFirst({
          where: { isPreset: true, presetKey: PROMO_PRESET_KEY },
        })) ?? starterPresets(getSiteUrl()).find((p) => p.presetKey === PROMO_PRESET_KEY)!;
      const created = await prisma.campaign.create({
        data: {
          name: `Promo: ${promo.title}`,
          subject: preset.subject,
          preheader: preset.preheader || null,
          body: preset.body,
          promoId,
        },
      });
      return okResponse({ campaign: toCampaignRow(created) }, 201);
    }

    return errorResponse('source must be "blank", "copy" or "promo".', 400);
  } catch (error) {
    console.error("[admin/mailing] Create failed:", error);
    return errorResponse("Couldn't create the email.", 500);
  }
}
