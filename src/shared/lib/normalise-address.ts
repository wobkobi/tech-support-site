// src/shared/lib/normalise-address.ts
// Server-side address canonicalisation via the Google Geocoding API. Covers
// paths that bypass the Places autocomplete (hand-typed Google Contacts
// imports, legacy rows). Callers normalise at write time so steady-state API
// usage stays near zero.

/** Result types precise enough to overwrite a stored address with. */
const PRECISE_TYPES = new Set(["street_address", "premise", "subpremise"]);
const PRECISE_LOCATION_TYPES = new Set(["ROOFTOP", "RANGE_INTERPOLATED"]);

/**
 * Outcome of one Geocoding attempt. `ok: false` means the lookup never ran or
 * failed (blank input, missing key, HTTP or network error, non-OK API status),
 * which is deliberately distinct from a call that succeeded and matched
 * nothing - that is `ok: true` with an empty list. Callers that flag addresses
 * for review depend on the distinction: treating an outage as "no such
 * address" would flag every contact in a sync pass.
 */
type GeocodeOutcome = { ok: true; candidates: string[] } | { ok: false };

/**
 * How a free-text address resolved against the geocoder.
 * - `resolved` - exactly one confident candidate, safe to store
 * - `ambiguous` - two or more, so the operator has to choose
 * - `unresolved` - the lookup ran and matched nothing precise in Auckland
 * - `skipped` - the lookup never ran or failed, so nothing can be concluded
 */
export type AddressResolution =
  | { status: "resolved"; address: string }
  | { status: "ambiguous"; candidates: string[] }
  | { status: "unresolved" }
  | { status: "skipped" };

/**
 * Geocodes a free-text address (Auckland, NZ constrained) and returns every
 * confident, precise NZ candidate in Google's formatted form, deduped. A
 * leading unit like "2/15" is preserved when Google drops it. Never throws.
 * @param raw - Free-text address to geocode.
 * @returns The candidates on a successful call, or `{ ok: false }` when the
 *   lookup could not be made or failed.
 */
async function geocode(raw: string | null | undefined): Promise<GeocodeOutcome> {
  const trimmed = raw?.trim();
  if (!trimmed) return { ok: false };

  // Server-only key, deliberately with no fallback to GOOGLE_MAPS_API_KEY: that
  // one is published to the browser by the `env` block in next.config.ts for
  // Places autocomplete, so falling back would put a publicly readable key on
  // server-side quota. Better to do nothing than to spend a leaked key.
  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!apiKey) {
    console.warn("[normalise-address] No GOOGLE_MAPS_SERVER_KEY set - skipping geocode.");
    return { ok: false };
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
      return { ok: false };
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

    // ZERO_RESULTS is a successful lookup that matched nothing - a real answer
    // about the address. Any other non-OK status is a fault on Google's side
    // and must not be read as one.
    if (data.status === "ZERO_RESULTS") return { ok: true, candidates: [] };
    if (data.status !== "OK") {
      console.warn(
        `[normalise-address] Geocoding API status: ${data.status}` +
          (data.error_message ? ` - ${data.error_message}` : ""),
      );
      return { ok: false };
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

    return { ok: true, candidates };
  } catch (err) {
    console.error("[normalise-address] Geocoding lookup failed:", err);
    return { ok: false };
  }
}

/**
 * Geocodes a free-text address and returns every confident, precise NZ
 * candidate in Google's formatted form, deduped. Empty on blank input, missing
 * key, failure, or nothing precise in NZ - so callers can tell "not found" (0),
 * "unambiguous" (1), and "ambiguous" (>1) apart. Never throws.
 * @param raw - Free-text address to geocode.
 * @returns Confident candidate addresses; empty when none resolve.
 */
export async function geocodeAddressCandidates(raw: string | null | undefined): Promise<string[]> {
  const outcome = await geocode(raw);
  return outcome.ok ? outcome.candidates : [];
}

/**
 * Resolves a free-text address, reporting why it did not produce a canonical
 * value so callers can flag it for operator review. Use this over
 * {@link normaliseAddress} when the difference between "matched nothing" and
 * "the lookup failed" matters. Never throws.
 * @param raw - Free-text address to resolve.
 * @returns The resolution status and, where relevant, the address or candidates.
 */
export async function resolveAddress(raw: string | null | undefined): Promise<AddressResolution> {
  const outcome = await geocode(raw);
  if (!outcome.ok) return { status: "skipped" };

  const [only] = outcome.candidates;
  if (outcome.candidates.length === 1 && only) return { status: "resolved", address: only };
  if (outcome.candidates.length > 1) return { status: "ambiguous", candidates: outcome.candidates };
  return { status: "unresolved" };
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
  const resolution = await resolveAddress(raw);
  return resolution.status === "resolved" ? resolution.address : null;
}

/** NZ street-type abbreviations Google Contacts commonly holds in typed addresses. */
const STREET_ABBREVIATIONS: Record<string, string> = {
  st: "street",
  str: "street",
  rd: "road",
  ave: "avenue",
  av: "avenue",
  cres: "crescent",
  cr: "crescent",
  dr: "drive",
  pl: "place",
  tce: "terrace",
  ln: "lane",
  hwy: "highway",
  pde: "parade",
  cl: "close",
  ct: "court",
  gr: "grove",
  gdns: "gardens",
  blvd: "boulevard",
  mt: "mount",
  pt: "point",
};

/** Words that carry no addressing information when comparing two forms of one address. */
const ADDRESS_NOISE = new Set([
  "new",
  "zealand",
  "nz",
  "apartment",
  "apt",
  "unit",
  "flat",
  "level",
]);

/**
 * Reduces an address to the set of words that actually identify it, so two
 * spellings of one place compare equal.
 *
 * A unit number is kept welded to its street number: `x/y` means unit x AT
 * number y, so the two halves must never become interchangeable tokens - split
 * them and "12/160 Kepa Rd" would read as the same place as plain "160 Kepa
 * Rd". Google Contacts often puts the unit on its own first line instead, so
 * that shape is rejoined into `x/y` before anything else happens.
 * @param value - Address in any format.
 * @returns Identifying words, or null when there is no address.
 */
function addressTokens(value: string | null): Set<string> | null {
  if (!value) return null;
  const rejoined = value.toLowerCase().replace(/^\s*(\d+[a-z]?)\s*[\n\r]+\s*(?=\d)/, "$1/");
  const flattened = rejoined
    .replace(/[\n\r,.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = flattened
    .split(" ")
    .map((word) => STREET_ABBREVIATIONS[word] ?? word)
    .filter((word) => word && !ADDRESS_NOISE.has(word));
  return words.length > 0 ? new Set(words) : null;
}

/**
 * Whether `canonical` is the same address as `other`, only more completely
 * stated. True when every identifying word in `other` appears in `canonical`.
 *
 * The site stores the Geocoding API's canonical form, which spells out the
 * street type and adds the suburb and postcode; Google Contacts keeps whatever
 * was typed. Comparing those as raw strings made every canonicalised address
 * look like a two-sided disagreement. Subsumption is deliberately one-way: an
 * address carrying detail the canonical form lacks (a unit number, a different
 * street) is NOT a match and stays a real conflict.
 * @param canonical - The richer, canonicalised address (the site's).
 * @param other - The other form to test against it (Google's).
 * @returns True when `other` says nothing `canonical` doesn't already say.
 */
export function addressCovers(canonical: string | null, other: string | null): boolean {
  const a = addressTokens(canonical);
  const b = addressTokens(other);
  if (!a || !b) return false;
  for (const word of b) if (!a.has(word)) return false;
  return true;
}
