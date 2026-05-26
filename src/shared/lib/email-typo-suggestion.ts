// src/shared/lib/email-typo-suggestion.ts
/**
 * @file email-typo-suggestion.ts
 * @description Suggests a corrected email when the domain looks like a typo of
 * a popular one (gmail / hotmail / yahoo / etc.). Pure function, no deps; used
 * by EmailInput's blur handler.
 */

/** Common consumer email domains, including NZ variants. */
const COMMON_DOMAINS: ReadonlyArray<string> = [
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.nz",
  "hotmail.com",
  "hotmail.co.nz",
  "outlook.com",
  "outlook.co.nz",
  "live.com",
  "live.co.nz",
  "xtra.co.nz",
  "icloud.com",
  "me.com",
  "protonmail.com",
  "proton.me",
];

/** Common TLDs we'll consider as part of a near-match. */
const COMMON_TLDS = new Set([".com", ".co.nz", ".net", ".org", ".nz"]);

/**
 * Damerau-Levenshtein distance with a small fast bail-out at >2.
 * @param a - First string.
 * @param b - Second string.
 * @returns Edit distance, or 99 once it's clearly past our threshold.
 */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 99;

  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
      }
    }
  }
  return dp[m][n];
}

/**
 * Suggest a corrected email if the local part is fine but the domain is one
 * edit away from a common provider. Returns null when there's no good match,
 * the input is empty, or the input is already exactly a common domain.
 * @param email - Raw user input.
 * @returns Suggested email or null.
 */
export function suggestEmailCorrection(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed.includes("@")) return null;

  const atIdx = trimmed.lastIndexOf("@");
  const local = trimmed.slice(0, atIdx);
  const domain = trimmed.slice(atIdx + 1);

  if (!local || !domain || !domain.includes(".")) return null;

  // Exact match: nothing to suggest.
  if (COMMON_DOMAINS.includes(domain)) return null;

  // Skip suggestions for domains using uncommon TLDs - we'd be guessing.
  const hasCommonTld = [...COMMON_TLDS].some((tld) => domain.endsWith(tld));
  if (!hasCommonTld && !domain.endsWith(".com") && !domain.endsWith(".nz")) return null;

  let best: { domain: string; distance: number } | null = null;
  for (const candidate of COMMON_DOMAINS) {
    const dist = editDistance(domain, candidate);
    // Distance 1 is a confident suggestion; 2 only if both domains are long
    // enough that two edits are still likely a typo (avoids "aol.com" ->
    // "icloud.com" style false positives).
    const threshold = candidate.length >= 9 ? 2 : 1;
    if (dist <= threshold && (!best || dist < best.distance)) {
      best = { domain: candidate, distance: dist };
    }
  }

  if (!best) return null;
  return `${local}@${best.domain}`;
}
