// src/shared/lib/normalise-address.ts
// Server-side address canonicalisation via the Google Geocoding API. Covers
// paths that bypass the Places autocomplete (hand-typed Google Contacts
// imports, legacy rows). Callers normalise at write time so steady-state API
// usage stays near zero.

/** Result types precise enough to overwrite a stored address with. */
const PRECISE_TYPES = new Set(["street_address", "premise", "subpremise"]);
const PRECISE_LOCATION_TYPES = new Set(["ROOFTOP", "RANGE_INTERPOLATED"]);

/**
 * Geocodes a free-text address (Auckland, NZ constrained) and returns every
 * confident, precise NZ candidate in Google's formatted form, deduped. Empty
 * on blank input, missing key, failure, or nothing precise in NZ - so callers
 * can tell "not found" (0), "unambiguous" (1), and "ambiguous" (>1) apart. A
 * leading unit like "2/15" is preserved when Google drops it. Never throws.
 * @param raw - Free-text address to geocode.
 * @returns Confident candidate addresses; empty when none resolve.
 */
export async function geocodeAddressCandidates(raw: string | null | undefined): Promise<string[]> {
  const trimmed = raw?.trim();
  if (!trimmed) return [];

  // Server-only key (no referrer restriction) is preferred; falls back to the
  // client key when running in dev without the split.
  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY ?? process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.warn("[normalise-address] No GOOGLE_MAPS_SERVER_KEY or GOOGLE_MAPS_API_KEY set.");
    return [];
  }

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", trimmed);
  // Hard component filter (unlike `region`, which only biases): results must be
  // in the Auckland region, NZ. Ambiguous inputs resolve to the Auckland matches;
  // genuinely non-Auckland inputs return ZERO_RESULTS and the caller gets [].
  url.searchParams.set("components", "country:NZ|administrative_area:Auckland");
  url.searchParams.set("key", apiKey);

  try {
    // 8s ceiling so a hung Geocoding call can't block a sync pass.
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      console.error(`[normalise-address] Geocoding API HTTP error: ${res.status}`);
      return [];
    }

    const data = (await res.json()) as {
      status: string;
      error_message?: string;
      results: Array<{
        formatted_address?: string;
        types?: string[];
        partial_match?: boolean;
        geometry?: { location_type?: string };
        address_components?: Array<{ short_name?: string; types?: string[] }>;
      }>;
    };
    if (data.status !== "OK" || data.results.length === 0) {
      if (data.status !== "ZERO_RESULTS") {
        console.warn(
          `[normalise-address] Geocoding API status: ${data.status}` +
            (data.error_message ? ` - ${data.error_message}` : ""),
        );
      }
      return [];
    }

    // Preserve a leading "unit/number" prefix (e.g. "2/15 Foo St") when the
    // geocoder resolved to the base street number and dropped the unit.
    const unitMatch = trimmed.match(/^\s*(\w+)\s*\/\s*(\d+)/);

    const candidates: string[] = [];
    for (const result of data.results) {
      const formatted = result.formatted_address?.trim();
      if (!formatted) continue;

      // Only trust precise matches: a coarse result (suburb/locality) would
      // replace a real street address with something less specific.
      const precise =
        PRECISE_LOCATION_TYPES.has(result.geometry?.location_type ?? "") ||
        (result.types ?? []).some((t) => PRECISE_TYPES.has(t));
      if (!precise || result.partial_match) continue;

      // Hard NZ guard: region=nz only BIASES the geocoder - a bare street name
      // with no suburb can jump countries (e.g. "27 maryland street" resolved to
      // Houston, Texas). Reject anything not resolved inside New Zealand.
      const country = result.address_components?.find((c) => c.types?.includes("country"));
      if (country?.short_name !== "NZ") continue;

      const withUnit =
        unitMatch && formatted.startsWith(`${unitMatch[2]} `)
          ? `${unitMatch[1]}/${formatted}`
          : formatted;
      if (!candidates.includes(withUnit)) candidates.push(withUnit);
    }

    return candidates;
  } catch (err) {
    console.error("[normalise-address] Geocoding lookup failed:", err);
    return [];
  }
}

/**
 * Canonicalises a free-text address to Google's formatted form, but only when
 * the match is UNAMBIGUOUS: null on zero candidates OR more than one, so it
 * never guesses between two same-named streets. Callers keep their original
 * value on null. Never throws.
 * @param raw - Free-text address to normalise.
 * @returns Canonical formatted address, or null when no single confident match exists.
 */
export async function normaliseAddress(raw: string | null | undefined): Promise<string | null> {
  const candidates = await geocodeAddressCandidates(raw);
  return candidates.length === 1 ? candidates[0] : null;
}
