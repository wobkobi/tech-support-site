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
 * Maps an HTTP status from one of the AI routes to an actionable hint, so a
 * failed run tells the operator what to check rather than dumping a raw status.
 * @param status - HTTP status code the route responded with.
 * @returns A one-line diagnostic hint.
 */
function statusHint(status: number): string {
  switch (status) {
    case 401:
      return "Unauthorised - ADMIN_SECRET in .env.local does not match the ADMIN_SECRET on the running dev server.";
    case 429:
      return "Rate limited - the dev-only bypass is not active. The server must run in dev (NODE_ENV is not 'production') with the same ADMIN_SECRET the harness sends.";
    case 422:
      return "The route rejected the request (its own validation or parse error). Check the description / input.";
    case 500:
      return "The route threw a server error - check the dev server terminal for the real stack trace. Common causes: a missing or invalid OPENAI_API_KEY on the server, or an OpenAI API failure.";
    default:
      return "Unexpected response - check the dev server terminal for details.";
  }
}

/**
 * POSTs JSON and throws a diagnostic Error on a network failure, any non-ok
 * response, or an `{ ok: false }` body. The thrown message names the route,
 * the status, and a hint for what to check - it is meant to be printed to the
 * operator verbatim, without a stack trace.
 * @param url - Absolute route URL.
 * @param body - JSON request body.
 * @param adminSecret - Value sent as the `x-admin-secret` header.
 * @returns Parsed JSON typed as T.
 */
async function postJson<T>(url: string, body: unknown, adminSecret: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-secret": adminSecret },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    // fetch rejects only on a network-level failure (server down, bad host,
    // socket reset) - turn that into a clear "is the server up?" message.
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `Could not reach the dev server at ${url} (${reason}). Is \`npm run dev\` running and serving that URL? Pass --url=<addr> if it is on another port.`,
    );
  }
  const json = (await res.json().catch(() => null)) as { ok?: boolean } | null;
  if (!res.ok || json?.ok === false || json === null) {
    const bodyText = json === null ? "(no JSON body)" : JSON.stringify(json);
    throw new Error(
      `${url} returned HTTP ${res.status}. ${statusHint(res.status)}\n  Response body: ${bodyText}`,
    );
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
