// scripts/check-address-resolution.ts
// Assert resolveAddress's four statuses against stubbed Geocoding responses (no network).
// Run with: npm test -- address-resolution

import { resolveAddress } from "@/shared/lib/normalise-address";
import { expectEqual, finish } from "./lib/harness.js";

// Read per request, not at load, so this survives import hoisting
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
  expectEqual(
    "single precise NZ match",
    (await resolveAddress("4 name street")).status,
    "resolved",
  );

  stubFetch({
    status: "OK",
    results: [
      preciseNZ("4 Name Street, Onehunga, Auckland 1061, New Zealand"),
      preciseNZ("4 Name Street, Glenfield, Auckland 0629, New Zealand"),
    ],
  });
  expectEqual(
    "two precise NZ matches",
    (await resolveAddress("4 name street")).status,
    "ambiguous",
  );

  stubFetch({ status: "ZERO_RESULTS", results: [] });
  expectEqual("no matches at all", (await resolveAddress("not a real place")).status, "unresolved");

  // Locality precision only: storing it would swap a street address for a suburb
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
  expectEqual(
    "matched but nothing precise",
    (await resolveAddress("onehunga")).status,
    "unresolved",
  );

  // A precise match outside NZ must not count
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
  expectEqual(
    "precise match outside NZ",
    (await resolveAddress("27 maryland street")).status,
    "unresolved",
  );

  // Outages must be "skipped", not "unresolved", or one bad sync flags every contact
  stubFetch({ status: "OVER_QUERY_LIMIT", results: [] });
  expectEqual("API over quota", (await resolveAddress("4 name street")).status, "skipped");

  stubFetch({}, { ok: false, status: 500 });
  expectEqual("HTTP 500", (await resolveAddress("4 name street")).status, "skipped");

  stubFetchThrows();
  expectEqual("network failure", (await resolveAddress("4 name street")).status, "skipped");

  expectEqual("blank input", (await resolveAddress("   ")).status, "skipped");

  finish();
}

void main();
