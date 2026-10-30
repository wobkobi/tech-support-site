// scripts/eval-ai/client.ts
// Thin HTTP client for the AI routes. Sends the admin secret everywhere: auth for most,
// the dev-only rate-limit bypass for estimate-duration.

import type { AiDraft } from "@/features/mailing/lib/ai-draft";
import type { DesignDraft, DraftRoom } from "@/features/social-design/lib/ai-draft";

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
  /** Mid-job drives from the client to a store and back, billed on top of the trip. */
  storeRuns?: string[];
  /** Invoice footer note; "" when none. */
  notes?: string;
  clarify?: unknown[];
}

/**
 * Maps an AI route's HTTP status to an actionable hint.
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
 * POSTs JSON, retrying a retryable 429 with backoff, and throws a printable diagnostic
 * Error on a network failure, non-ok response or `{ ok: false }` body.
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
      // fetch rejects only on a network-level failure.
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
    // Upstream rate limit: prefer OpenAI's retryAfterMs (the TPM window); else double from 5s.
    if (res.status === 429 && json?.retryable === true && attempt < RATE_LIMIT_RETRIES) {
      const hinted =
        typeof json.retryAfterMs === "number" && json.retryAfterMs > 0 ? json.retryAfterMs : null;
      // A second past the reset, to absorb clock skew.
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

/**
 * Reads /llms.txt: the business facts the AI writers are given, so figures from them aren't
 * counted as made up.
 * @param baseUrl - Server base URL (no trailing slash).
 * @returns The facts text.
 */
export async function fetchFacts(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/llms.txt`);
  if (!res.ok) throw new Error(`/llms.txt returned ${res.status}`);
  return res.text();
}

/**
 * Calls the admin mailing ai-draft route.
 * @param baseUrl - Server base URL (no trailing slash).
 * @param adminSecret - Admin secret for auth.
 * @param body - The brief, the kind of email and where its button goes.
 * @param body.brief - What the email is about.
 * @param body.kind - A draft kind key.
 * @param body.buttonUrl - The email's button link, or "" for none.
 * @param body.source - "post" when the brief is a social post's words (Email this too).
 * @returns The draft.
 */
export async function callMailingDraft(
  baseUrl: string,
  adminSecret: string,
  body: { brief: string; kind: string; buttonUrl: string; source?: "post" },
): Promise<AiDraft> {
  const json = await postJson<{ ok: true; draft: AiDraft }>(
    `${baseUrl}/api/admin/mailing/ai-draft`,
    { ...body, promoId: null },
    adminSecret,
  );
  return json.draft;
}

/**
 * Calls the admin post maker ai-draft route.
 * @param baseUrl - Server base URL (no trailing slash).
 * @param adminSecret - Admin secret for auth.
 * @param body - The brief, the kind of post, the design's room and its paid-ad switch.
 * @param body.brief - What the post is about.
 * @param body.kind - A post draft kind key.
 * @param body.room - What the design has room for.
 * @param body.paidAd - Whether the design is a paid ad.
 * @returns The draft, or null when the route refused the brief (a 422).
 */
export async function callPostDraft(
  baseUrl: string,
  adminSecret: string,
  body: { brief: string; kind: string; room: DraftRoom; paidAd: boolean },
): Promise<DesignDraft | null> {
  try {
    const json = await postJson<{ ok: true; draft: DesignDraft }>(
      `${baseUrl}/api/admin/social/designs/ai-draft`,
      body,
      adminSecret,
    );
    return json.draft;
  } catch (error) {
    if (error instanceof Error && error.message.includes("returned HTTP 422")) return null;
    throw error;
  }
}

/**
 * Calls the admin Write with AI route for a post's words.
 * @param baseUrl - Server base URL (no trailing slash).
 * @param adminSecret - Admin secret for auth.
 * @param body - The caption request, as the composer's dialog sends it.
 * @returns The options.
 */
export async function callCaption(
  baseUrl: string,
  adminSecret: string,
  body: Record<string, unknown>,
): Promise<string[]> {
  const json = await postJson<{ ok: true; captions: string[] }>(
    `${baseUrl}/api/admin/social/caption-ai`,
    body,
    adminSecret,
  );
  return json.captions;
}

/**
 * Calls the admin Suggest a reply route for an inbox message.
 * @param baseUrl - Server base URL (no trailing slash).
 * @param adminSecret - Admin secret for auth.
 * @param body - The reply request, as the inbox's thread sends it.
 * @returns The suggestion.
 */
export async function callReplySuggest(
  baseUrl: string,
  adminSecret: string,
  body: Record<string, unknown>,
): Promise<{ reply: string; hide: boolean }> {
  const json = await postJson<{ ok: true; reply: string; hide: boolean }>(
    `${baseUrl}/api/admin/social/inbox/suggest`,
    body,
    adminSecret,
  );
  return { reply: json.reply, hide: json.hide };
}
