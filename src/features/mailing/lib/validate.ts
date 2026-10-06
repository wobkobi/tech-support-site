// src/features/mailing/lib/validate.ts
// Request-body parsing for the mailing API. Sparse: only fields present in the body are
// returned, so a PATCH writes exactly what the editor changed.

import { parseObjectId } from "@/features/business/lib/validation";
import { parseAudience, type CampaignAudience } from "@/features/mailing/lib/audience";

const MAX_NAME = 120;
const MAX_SUBJECT = 200;
const MAX_PREHEADER = 200;
const MAX_BODY = 50_000;

/** Editable campaign fields. */
export interface CampaignPatch {
  name?: string;
  subject?: string;
  preheader?: string | null;
  body?: string;
  promoId?: string | null;
  audience?: CampaignAudience;
}

/**
 * Checks one optional text field.
 * @param value - Raw value.
 * @param label - Field name for the error.
 * @param max - Maximum length.
 * @returns The string, or an error message.
 */
function text(value: unknown, label: string, max: number): string | { error: string } {
  if (typeof value !== "string") return { error: `${label} must be text.` };
  if (value.length > max) return { error: `${label} is too long (max ${max} characters).` };
  return value;
}

/**
 * Parses a campaign create or edit body.
 * @param raw - Request JSON.
 * @returns The fields present, or the first problem found.
 */
export function parseCampaignPatch(raw: unknown): { patch: CampaignPatch } | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "Expected a JSON object." };
  const body = raw as Record<string, unknown>;
  const patch: CampaignPatch = {};

  if (body.name !== undefined) {
    const v = text(body.name, "Name", MAX_NAME);
    if (typeof v !== "string") return v;
    patch.name = v.trim() || "Untitled email";
  }
  if (body.subject !== undefined) {
    const v = text(body.subject, "Subject", MAX_SUBJECT);
    if (typeof v !== "string") return v;
    patch.subject = v;
  }
  if (body.preheader !== undefined) {
    if (body.preheader === null) patch.preheader = null;
    else {
      const v = text(body.preheader, "Preview line", MAX_PREHEADER);
      if (typeof v !== "string") return v;
      patch.preheader = v.trim() || null;
    }
  }
  if (body.body !== undefined) {
    const v = text(body.body, "Body", MAX_BODY);
    if (typeof v !== "string") return v;
    patch.body = v;
  }
  if (body.promoId !== undefined) {
    if (body.promoId === null) patch.promoId = null;
    else {
      const id = parseObjectId(body.promoId);
      if (!id) return { error: "promoId isn't a valid id." };
      patch.promoId = id;
    }
  }
  if (body.audience !== undefined) {
    const audience = parseAudience(body.audience);
    if (!audience) return { error: 'audience must be "everyone" or "site_reviewers".' };
    patch.audience = audience;
  }
  return { patch };
}

/**
 * Parses the unticked-contacts list from a send or schedule body.
 * @param value - Raw value.
 * @returns Valid ids, or null when the value isn't an array of ids.
 */
export function parseExcludedIds(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const ids = value.map(parseObjectId);
  return ids.every((id): id is string => id !== null) ? ids : null;
}
