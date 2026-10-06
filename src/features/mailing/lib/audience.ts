// src/features/mailing/lib/audience.ts
// Who a mailing-list email goes to. Client-safe: the editor's select and the send dialog
// read the labels, the API parses the value.

/** Mirrors the CampaignAudience enum. */
export type CampaignAudience = "everyone" | "site_reviewers";

/** Select options in display order. */
export const AUDIENCE_OPTIONS: { value: CampaignAudience; label: string }[] = [
  { value: "everyone", label: "Everyone on the list" },
  { value: "site_reviewers", label: "People who left a review on the site" },
];

/**
 * A stored audience as the app uses it; null (rows made before the field) is everyone.
 * @param stored - Campaign.audience.
 * @returns The audience.
 */
export function audienceOf(stored: CampaignAudience | null | undefined): CampaignAudience {
  return stored ?? "everyone";
}

/**
 * Parses an audience from a request body or query string.
 * @param value - Raw value.
 * @returns The audience, or null when it isn't one.
 */
export function parseAudience(value: unknown): CampaignAudience | null {
  return value === "everyone" || value === "site_reviewers" ? value : null;
}
