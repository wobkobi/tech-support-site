// scripts/check-address-resolution.ts
// Feeds fixture Geocoding API responses through resolveAddress and asserts each of the
// four statuses. fetch is stubbed per case, so this costs no network and no quota.
// Run with: npm run check:addresses

import { resolveAddress, type AddressResolution } from "@/shared/lib/normalise-address";

// normalise-address reads the key inside the request function, not at module
// load, so setting it here still takes effect despite import hoisting.
process.env.GOOGLE_MAPS_SERVER_KEY ??= "fixture-key";

/** Shape of one Geocoding API result, trimmed to the fields the parser reads. */
interface GeocodeResult {
  formatted_address?: string;
  types?: string[];
  partial_match?: boolean;
  geometry?: { location_type?: string };
  address_components?: Array<{ short_name?: string; types?: string[] }>;
}

/**
 * Builds a precise, NZ-resolved result - the shape that counts as a candidate.
 * @param formatted - Formatted address the geocoder would return.
 * @returns A Geocoding result that passes every precision and country guard.
 */
function preciseNZ(formatted: string): GeocodeResult {
  return {
    formatted_address: formatted,
    types: ["street_address"],
    geometry: { location_type: "ROOFTOP" },
    address_components: [{ short_name: "NZ", types: ["country"] }],
  };
}

/**
 * Replaces global fetch with one canned Geocoding response.
 * @param body - JSON body the stubbed response resolves with.
 * @param init - Optional HTTP status overrides.
 * @param init.ok - Whether the response reports success (defaults true).
 * @param init.status - HTTP status code (defaults 200).
 */
function stubFetch(body: unknown, init: { ok?: boolean; status?: number } = {}): void {
  globalThis.fetch = (async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    /**
     * Stands in for Response.json().
     * @returns The canned JSON body.
     */
    json: async () => body,
  })) as unknown as typeof fetch;
}

/** Replaces global fetch with a rejecting call, standing in for a network failure. */
function stubFetchThrows(): void {
  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
}

let failures = 0;

/**
 * Compares a resolution against the expected status, recording rather than
 * throwing so every fixture runs even after one fails.
 * @param label - Human-readable case name.
 * @param actual - Resolution returned by resolveAddress.
 * @param expected - Status the case should produce.
 */
function expectStatus(
  label: string,
  actual: AddressResolution,
  expected: AddressResolution["status"],
): void {
  if (actual.status === expected) {
    console.log(`  PASS  ${label} > ${actual.status}`);
  } else {
    console.error(`  FAIL  ${label} > expected ${expected}, got ${actual.status}`);
    failures++;
  }
}

/**
 * Runs every fixture case and exits non-zero if any failed.
 * @returns Promise that resolves once all cases have run.
 */
async function main(): Promise<void> {
  console.log("resolveAddress fixtures\n");

  stubFetch({
    status: "OK",
    results: [preciseNZ("4 Name Street, Onehunga, Auckland 1061, New Zealand")],
  });
  expectStatus("single precise NZ match", await resolveAddress("4 name street"), "resolved");

  stubFetch({
    status: "OK",
    results: [
      preciseNZ("4 Name Street, Onehunga, Auckland 1061, New Zealand"),
      preciseNZ("4 Name Street, Glenfield, Auckland 0629, New Zealand"),
    ],
  });
  expectStatus("two precise NZ matches", await resolveAddress("4 name street"), "ambiguous");

  stubFetch({ status: "ZERO_RESULTS", results: [] });
  expectStatus("no matches at all", await resolveAddress("not a real place"), "unresolved");

  // Google matched something, but only at locality precision - storing it would
  // replace a street address with a suburb.
  stubFetch({
    status: "OK",
    results: [
      {
        formatted_address: "Onehunga, Auckland, New Zealand",
        types: ["locality"],
        geometry: { location_type: "APPROXIMATE" },
        address_components: [{ short_name: "NZ", types: ["country"] }],
      },
    ],
  });
  expectStatus("matched but nothing precise", await resolveAddress("onehunga"), "unresolved");

  // A precise match that resolved outside NZ must not count - "27 maryland
  // street" resolving to Houston is the case the country guard exists for.
  stubFetch({
    status: "OK",
    results: [
      {
        formatted_address: "27 Maryland St, Houston, TX 77006, USA",
        types: ["street_address"],
        geometry: { location_type: "ROOFTOP" },
        address_components: [{ short_name: "US", types: ["country"] }],
      },
    ],
  });
  expectStatus(
    "precise match outside NZ",
    await resolveAddress("27 maryland street"),
    "unresolved",
  );

  // The outage cases. An API failure must never look like "no such address",
  // or one bad sync pass would flag every contact in the database for review.
  stubFetch({ status: "OVER_QUERY_LIMIT", results: [] });
  expectStatus("API over quota", await resolveAddress("4 name street"), "skipped");

  stubFetch({}, { ok: false, status: 500 });
  expectStatus("HTTP 500", await resolveAddress("4 name street"), "skipped");

  stubFetchThrows();
  expectStatus("network failure", await resolveAddress("4 name street"), "skipped");

  expectStatus("blank input", await resolveAddress("   "), "skipped");

  console.log(failures === 0 ? "\nAll fixtures passed." : `\n${failures} fixture(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
