// src/app/api/admin/social/route.ts
// Social posts: list them, or create one - blank, as a copy of another (starting from a
// preset, duplicating, or "save as preset"), from a promo via "Post this promo", or from
// a mailing-list email via "Share to social".

import { findAdvertisablePromo } from "@/features/business/lib/promos";
import { parseObjectId } from "@/features/business/lib/validation";
import { postFromEmail } from "@/features/social/lib/from-email";
import { fetchJpegSize } from "@/features/social/lib/jpeg-size";
import { toPostRow } from "@/features/social/lib/post-row";
import { PROMO_POST_PRESET_KEY, starterPostPresets } from "@/features/social/lib/presets";
import { defaultTargets } from "@/features/social/lib/targets";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { getSiteUrl } from "@/shared/lib/site-url";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/admin/social - every post and preset, newest first.
 * @param request - Incoming request.
 * @returns JSON `{ posts }`.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const rows = await prisma.socialPost.findMany({ orderBy: { updatedAt: "desc" } });
  return okResponse({ posts: rows.map(toPostRow) });
}

/**
 * POST /api/admin/social - creates a post.
 * Body: `{ source: "blank" | "copy" | "promo" | "campaign", sourceId?, promoId?, campaignId?, asPreset? }`.
 * @param request - Incoming request.
 * @returns JSON `{ post }`.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const body = (await request.json().catch(() => null)) as {
    source?: string;
    sourceId?: unknown;
    promoId?: unknown;
    campaignId?: unknown;
    asPreset?: unknown;
  } | null;
  const asPreset = body?.asPreset === true;

  try {
    if (body?.source === "blank") {
      const created = await prisma.socialPost.create({
        data: {
          name: asPreset ? "New preset" : "New post",
          body: "",
          isPreset: asPreset,
          targets: defaultTargets(),
        },
      });
      return okResponse({ post: toPostRow(created) }, 201);
    }

    if (body?.source === "copy") {
      const sourceId = parseObjectId(body.sourceId);
      if (!sourceId) return errorResponse("sourceId isn't a valid id.", 400);
      const source = await prisma.socialPost.findUnique({ where: { id: sourceId } });
      if (!source) return errorResponse("That post no longer exists.", 404);
      // Starting a draft from a preset keeps its name; any other copy says it's one.
      const name = source.isPreset && !asPreset ? source.name : `${source.name} (copy)`;
      // Toggles and per-platform text carry over; past outcomes don't.
      const targets = defaultTargets().map((t) => {
        const from = source.targets.find((s) => s.platform === t.platform);
        return from ? { ...t, enabled: from.enabled, textOverride: from.textOverride } : t;
      });
      const created = await prisma.socialPost.create({
        data: {
          name,
          body: source.body,
          imageUrl: source.imageUrl,
          imageAlt: source.imageAlt,
          imageWidth: source.imageWidth,
          imageHeight: source.imageHeight,
          linkUrl: source.linkUrl,
          promoId: source.promoId,
          isPreset: asPreset,
          targets,
        },
      });
      return okResponse({ post: toPostRow(created) }, 201);
    }

    if (body?.source === "promo") {
      const promoId = parseObjectId(body.promoId);
      if (!promoId) return errorResponse("promoId isn't a valid id.", 400);
      const promo = await findAdvertisablePromo(promoId);
      if (!promo) {
        return errorResponse(
          "Only an automatic promo that's running right now can be posted.",
          400,
        );
      }
      // The operator may have reworded or deleted the promo preset; fall back to the
      // starter wording only when it's gone.
      const preset =
        (await prisma.socialPost.findFirst({
          where: { isPreset: true, presetKey: PROMO_POST_PRESET_KEY },
        })) ?? starterPostPresets(getSiteUrl()).find((p) => p.presetKey === PROMO_POST_PRESET_KEY)!;
      const created = await prisma.socialPost.create({
        data: {
          name: `Promo: ${promo.title}`,
          body: preset.body,
          linkUrl: preset.linkUrl,
          promoId,
          targets: defaultTargets(),
        },
      });
      return okResponse({ post: toPostRow(created) }, 201);
    }

    if (body?.source === "campaign") {
      const campaignId = parseObjectId(body.campaignId);
      if (!campaignId) return errorResponse("campaignId isn't a valid id.", 400);
      const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
      if (!campaign) return errorResponse("That email no longer exists.", 404);
      const converted = postFromEmail(campaign.body);
      const size = converted.imageUrl ? await fetchJpegSize(converted.imageUrl) : null;
      const created = await prisma.socialPost.create({
        data: {
          name: campaign.name,
          ...converted,
          imageWidth: size?.width ?? null,
          imageHeight: size?.height ?? null,
          promoId: campaign.promoId,
          campaignId,
          targets: defaultTargets(),
        },
      });
      return okResponse({ post: toPostRow(created) }, 201);
    }

    return errorResponse('source must be "blank", "copy", "promo" or "campaign".', 400);
  } catch (error) {
    console.error("[admin/social] Create failed:", error);
    return errorResponse("Couldn't create the post.", 500);
  }
}
