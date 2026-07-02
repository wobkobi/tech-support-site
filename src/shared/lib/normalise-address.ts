// src/shared/lib/normalise-address.ts
// Server-side address canonicalisation via the Google Geocoding API. Manual
// entry points (booking form, contact edit) already produce Places-formatted
// addresses via autocomplete; this helper covers the paths that bypass it -
// Google Contacts imports typed by hand on a phone, and legacy rows. Callers
// normalise at write time so steady-state API usage stays near zero.

/** Result types precise enough to overwrite a stored address with. */
const PRECISE_TYPES = new Set(["street_address", "premise", "subpremise"]);
const PRECISE_LOCATION_TYPES = new Set(["ROOFTOP", "RANGE_INTERPOLATED"]);

/**
 * Canonicalises a free-text address to Google's formatted form (the same shape
 * the Places autocomplete stores), constrained to Auckland, New Zealand (the
 * service area) - so a bare street name like "27 maryland street" resolves to
 * the Auckland street instead of a same-named one overseas. Returns null when
 * the input is blank, no API key is configured, the lookup fails, or the match
 * is too coarse to trust (e.g. Google only matched a suburb) - callers keep
 * their original value on null. A leading unit like "2/15" is preserved when
 * Google's formatted address drops it. Never throws.
 * @param raw - Free-text address to normalise.
 * @returns Canonical formatted address, or null when no confident match exists.
 */
export async function normaliseAddress(raw: string | null | undefined): Promise<string | null> {
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  // Server-only key (no referrer restriction) is preferred; falls back to the
  // client key when running in dev without the split.
  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY ?? process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.warn("[normalise-address] No GOOGLE_MAPS_SERVER_KEY or GOOGLE_MAPS_API_KEY set.");
    return null;
  }

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", trimmed);
  // Hard component filter (unlike `region`, which only biases): results must be
  // in the Auckland region, NZ. Ambiguous inputs resolve to the Auckland match;
  // genuinely non-Auckland inputs return ZERO_RESULTS and the caller keeps the
  // original string.
  url.searchParams.set("components", "country:NZ|administrative_area:Auckland");
  url.searchParams.set("key", apiKey);

  try {
    // 8s ceiling so a hung Geocoding call can't block a sync pass.
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      console.error(`[normalise-address] Geocoding API HTTP error: ${res.status}`);
      return null;
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
      return null;
    }

    const top = data.results[0];
    const formatted = top.formatted_address?.trim();
    if (!formatted) return null;

    // Only trust precise matches: a coarse result (suburb/locality) would
    // replace a real street address with something less specific.
    const precise =
      PRECISE_LOCATION_TYPES.has(top.geometry?.location_type ?? "") ||
      (top.types ?? []).some((t) => PRECISE_TYPES.has(t));
    if (!precise || top.partial_match) return null;

    // Hard NZ guard: region=nz only BIASES the geocoder - a bare street name
    // with no suburb can jump countries (e.g. "27 maryland street" resolved to
    // Houston, Texas). Reject anything not resolved inside New Zealand.
    const country = top.address_components?.find((c) => c.types?.includes("country"));
    if (country?.short_name !== "NZ") return null;

    // Preserve a leading "unit/number" prefix (e.g. "2/15 Foo St") when the
    // geocoder resolved to the base street number and dropped the unit.
    const unitMatch = trimmed.match(/^\s*(\w+)\s*\/\s*(\d+)/);
    if (unitMatch && formatted.startsWith(`${unitMatch[2]} `)) {
      return `${unitMatch[1]}/${formatted}`;
    }

    return formatted;
  } catch (err) {
    console.error("[normalise-address] Geocoding lookup failed:", err);
    return null;
  }
}
