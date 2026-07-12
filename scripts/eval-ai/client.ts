// scripts/eval-ai/client.ts
// Thin HTTP client for the two AI routes. Sends the admin secret on both:
// parse-job requires it for auth, and estimate-duration uses it to trigger the
// dev-only rate-limit bypass so the harness can batch calls.

/** estimate-duration success payload (the `result` field). */
export interface EstimateResult {
  estimatedMins: number;
  confidence: "high" | "medium" | "low";
  explanation: string;
  tasks: { label: string; mins: number }[];
}

/** A single parse-job task (only the fields the harness inspects). */
export interface ParseTask {
  qty?: number;
  modifierIds?: string[];
  baseRateId?: string | null;
  device?: string | null;
  action?: string | null;
  description?: string;
  isExplicit?: boolean;
}

/** parse-job success payload (the `result` field), or a clarify request. */
export interface ParseJobResult {
  durationMins?: number;
  tasks?: ParseTask[];
  warnings?: string[];
  ranges?: { startTime: string; endTime: string }[];
  clarify?: unknown[];
}

/**
 * POSTs JSON and throws on any non-ok response or `{ ok: false }` body.
 * @param url - Absolute route URL.
 * @param body - JSON request body.
 * @param adminSecret - Value sent as the `x-admin-secret` header.
 * @returns Parsed JSON typed as T.
 */
async function postJson<T>(url: string, body: unknown, adminSecret: string): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-secret": adminSecret },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as { ok?: boolean } | null;
  if (!res.ok || json?.ok === false || json === null) {
    throw new Error(`${url} -> HTTP ${res.status}: ${JSON.stringify(json)}`);
  }
  return json as T;
}

/**
 * Calls the public estimate-duration route.
 * @param baseUrl - Server base URL (no trailing slash).
 * @param adminSecret - Admin secret for the dev rate-limit bypass.
 * @param description - Plain-English job description.
 * @returns The estimate result.
 */
export async function callEstimate(
  baseUrl: string,
  adminSecret: string,
  description: string,
): Promise<EstimateResult> {
  const json = await postJson<{ ok: true; result: EstimateResult }>(
    `${baseUrl}/api/pricing/estimate-duration`,
    { description },
    adminSecret,
  );
  return json.result;
}

/**
 * Calls the admin parse-job route.
 * @param baseUrl - Server base URL (no trailing slash).
 * @param adminSecret - Admin secret for auth.
 * @param input - Operator job notes (may include time ranges).
 * @returns The parsed result, or `{ clarify }` when the route asks for clarification.
 */
export async function callParseJob(
  baseUrl: string,
  adminSecret: string,
  input: string,
): Promise<ParseJobResult> {
  const json = await postJson<{ ok: true; result?: ParseJobResult; clarify?: unknown[] }>(
    `${baseUrl}/api/business/parse-job`,
    { input },
    adminSecret,
  );
  return json.result ?? { clarify: json.clarify };
}
