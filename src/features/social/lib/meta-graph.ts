// src/features/social/lib/meta-graph.ts
// Small fetch wrapper for Meta's Graph API, shared by the Facebook and Instagram
// adapters. Every call uses the Page access token: a Page token derived from a
// long-lived user token has no expiry date, but a password change, removing the app
// or losing the Page role revokes it, and that surfaces here as error code 190.

// Pinned so a Meta release can't change behaviour underneath. v26.0 is supported
// until at least mid-2028; bump it here alone.
const GRAPH_VERSION = "v26.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** Env-backed Meta settings; null fields mean that part isn't set up. */
export interface MetaConfig {
  pageId: string | null;
  igAccountId: string | null;
  token: string | null;
}

/**
 * Reads the Meta env vars.
 * @returns Page id, Instagram account id and Page token, each null when unset.
 */
export function metaConfig(): MetaConfig {
  return {
    pageId: process.env.META_PAGE_ID?.trim() || null,
    igAccountId: process.env.INSTAGRAM_ACCOUNT_ID?.trim() || null,
    token: process.env.META_PAGE_ACCESS_TOKEN?.trim() || null,
  };
}

/** A Graph API failure, with the message rewritten for the operator. */
export class GraphError extends Error {
  /** Meta's numeric error code, when it sent one. */
  readonly code: number | null;
  /**
   * Creates the error.
   * @param message - Operator-readable message.
   * @param code - Meta's error code, or null.
   */
  constructor(message: string, code: number | null) {
    super(message);
    this.name = "GraphError";
    this.code = code;
  }
}

interface GraphErrorBody {
  error?: { message?: string; code?: number; error_user_msg?: string };
}

/**
 * Turns Meta's error into something the operator can act on. Codes from the Graph
 * API error reference: 190 bad or revoked token, 10/200-299 missing permission,
 * 4/17/32/613 rate limits.
 * @param body - Parsed error response.
 * @param status - HTTP status.
 * @returns A readable error.
 */
function toGraphError(body: GraphErrorBody | null, status: number): GraphError {
  const code = body?.error?.code ?? null;
  if (code === 190) {
    return new GraphError("Facebook connection expired - regenerate the Page token.", code);
  }
  if (code === 10 || (code !== null && code >= 200 && code < 300)) {
    return new GraphError(
      "The Facebook app is missing a permission - check the token's permissions.",
      code,
    );
  }
  if (code === 4 || code === 17 || code === 32 || code === 613) {
    return new GraphError("Meta's rate limit was hit. Try again in an hour.", code);
  }
  const detail = body?.error?.error_user_msg || body?.error?.message;
  return new GraphError(detail ? `Meta said: ${detail}` : `Meta request failed (${status}).`, code);
}

/**
 * Calls the Graph API with the Page token. GET and DELETE send params in the query
 * string; POST sends them form-encoded, the way the Graph API documents its examples.
 * @param path - Path after the version, like "/123/feed".
 * @param method - HTTP method.
 * @param params - Request parameters, without the token.
 * @returns The parsed JSON response.
 */
export async function graph<T>(
  path: string,
  method: "GET" | "POST" | "DELETE" = "GET",
  params: Record<string, string> = {},
): Promise<T> {
  const { token } = metaConfig();
  if (!token) throw new GraphError("META_PAGE_ACCESS_TOKEN isn't set.", null);
  const all = new URLSearchParams({ ...params, access_token: token });
  const url = method === "POST" ? `${GRAPH_BASE}${path}` : `${GRAPH_BASE}${path}?${all}`;
  const res = await fetch(url, {
    method,
    body: method === "POST" ? all : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => null)) as (T & GraphErrorBody) | null;
  if (!res.ok || !body || body.error) throw toGraphError(body, res.status);
  return body;
}

/**
 * Deletes a Page post or Instagram media. Deleting something that's already gone
 * fails with error 100 ("does not exist, cannot be loaded due to missing
 * permissions"), and so does deleting with a token that has lost sight of the
 * account. It only counts as already deleted (so pressing Take down twice is safe)
 * when the object can't be read either AND the token can still see the account that
 * owns it; otherwise the original error stands and the post stays marked as up.
 * @param id - Post or media id.
 * @param ownerVisible - Resolves true when the token can still see the owning Page or
 *   Instagram account.
 */
export async function deleteObject(
  id: string,
  ownerVisible: () => Promise<boolean>,
): Promise<void> {
  try {
    await graph(`/${id}`, "DELETE");
  } catch (error) {
    if (!(error instanceof GraphError) || error.code !== 100) throw error;
    const unreadable = await graph(`/${id}`, "GET", { fields: "id" }).then(
      () => false,
      (readError: unknown) => readError instanceof GraphError && readError.code === 100,
    );
    if (!unreadable || !(await ownerVisible().catch(() => false))) throw error;
  }
}
