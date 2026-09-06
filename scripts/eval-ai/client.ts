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
interface ParseTask {
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
  /** The one trip the job bills, or null when it bills none. */
  destination?: string | null;
  /** True only when the operator STATED a trip that is not chargeable. */
  noTravelCharge?: boolean;
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
      return "Rate limited - if the body says retryable, the upstream OpenAI limit persisted through every backoff retry; otherwise the dev-only bypass is not active (the server must run in dev with the same ADMIN_SECRET the harness sends).";
    case 422:
      return "The route rejected the request (its own validation or parse error). Check the description / input.";
    case 500:
      return "The route threw a server error - check the dev server terminal for the real stack trace. Common causes: a missing or invalid OPENAI_API_KEY on the server, or an OpenAI API failure.";
    default:
      return "Unexpected response - check the dev server terminal for details.";
  }
}

/** Max retries after an upstream (retryable) 429 before the case gives up. */
const RATE_LIMIT_RETRIES = 5;
/** First backoff wait; doubles after each subsequent rate-limited attempt. */
const RATE_LIMIT_BASE_DELAY_MS = 5_000;

/**
 * POSTs JSON and throws a diagnostic Error on a network failure, any non-ok
 * response, or an `{ ok: false }` body. An upstream OpenAI rate limit (429
 * with `retryable: true`) is retried with exponential backoff first, so one
 * throttled call doesn't abort a paid multi-case run. The thrown message
 * names the route, the status, and a hint for what to check - it is meant to
 * be printed to the operator verbatim, without a stack trace.
 * @param url - Absolute route URL.
 * @param body - JSON request body.
 * @param adminSecret - Value sent as the `x-admin-secret` header.
 * @returns Parsed JSON typed as T.
 */
async function postJson<T>(url: string, body: unknown, adminSecret: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
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
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean;
      retryable?: boolean;
      retryAfterMs?: number;
    } | null;
    // Upstream OpenAI rate limit: hold off and retry. The route passes OpenAI's
    // own reset time through as retryAfterMs - prefer it, since the limit that
    // bites here is tokens-per-minute and only OpenAI knows when that window
    // reopens. Doubling from 5s is the fallback when no hint came back, and it
    // burns its early retries failing again against a window measured in minutes.
    if (res.status === 429 && json?.retryable === true && attempt < RATE_LIMIT_RETRIES) {
      const hinted =
        typeof json.retryAfterMs === "number" && json.retryAfterMs > 0 ? json.retryAfterMs : null;
      // A second past the stated reset, so a clock skew of a few ms does not
      // spend a whole retry landing back in the same closed window.
      const delayMs = hinted !== null ? hinted + 1_000 : RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt;
      console.log(
        `    AI rate limited - waiting ${Math.round(delayMs / 1000)}s${
          hinted !== null ? " (OpenAI's stated reset)" : ""
        } (retry ${attempt + 1}/${RATE_LIMIT_RETRIES})`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }
    if (!res.ok || json?.ok === false || json === null) {
      const bodyText = json === null ? "(no JSON body)" : JSON.stringify(json);
      throw new Error(
        `${url} returned HTTP ${res.status}. ${statusHint(res.status)}\n  Response body: ${bodyText}`,
      );
    }
    return json as T;
  }
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
