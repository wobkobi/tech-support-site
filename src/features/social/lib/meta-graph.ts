// src/features/social/lib/meta-graph.ts
// Graph API fetch wrapper for the Facebook and Instagram adapters. The Page token doesn't expire,
// but a password change or lost Page role revokes it (error 190).

// Pinned so a Meta release can't change behaviour underneath. v26.0 is supported
// until at least mid-2028; bump it here alone.
const GRAPH_VERSION = "v26.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** Env-backed Meta settings; null fields mean that part isn't set up. */
export interface MetaConfig {
  pageId: string | null;
  igAccountId: string | null;
  token: string | null;
  /** "{app id}|{app secret}" for debug_token, when both are set. */
  appToken: string | null;
}

/**
 * Reads the Meta env vars.
 * @returns Page id, Instagram account id, Page token and app token, each null when unset.
 */
export function metaConfig(): MetaConfig {
  const appId = process.env.META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  return {
    pageId: process.env.META_PAGE_ID?.trim() || null,
    igAccountId: process.env.INSTAGRAM_ACCOUNT_ID?.trim() || null,
    token: process.env.META_PAGE_ACCESS_TOKEN?.trim() || null,
    appToken: appId && appSecret ? `${appId}|${appSecret}` : null,
  };
}

/** A Graph API failure, with the message rewritten for the operator. */
export class GraphError extends Error {
  /** Meta's numeric error code, when it sent one. */
  readonly code: number | null;
  /** Meta's own message, which tells apart errors that share a code. */
  readonly raw: string | null;
  /** A POST Meta may still have acted on: it never answered, or answered with a server error. */
  readonly unsure: boolean;
  /**
   * Creates the error.
   * @param message - Operator-readable message.
   * @param code - Meta's error code, or null.
   * @param raw - Meta's own message, or null.
   * @param unsure - True when the request may have gone through anyway.
   */
  constructor(message: string, code: number | null, raw: string | null = null, unsure = false) {
    super(message);
    this.name = "GraphError";
    this.code = code;
    this.raw = raw;
    this.unsure = unsure;
  }
}

/**
 * Whether a failed POST may have gone through, so sending it again could make a second copy.
 * @param error - What the call threw.
 * @returns True for an unanswered or server-error POST.
 */
export function isUnsure(error: unknown): boolean {
  return error instanceof GraphError && error.unsure;
}

interface GraphErrorBody {
  error?: { message?: string; code?: number; error_user_msg?: string };
}

/**
 * Turns Meta's error into an actionable one: 190 bad token, 10/200-299 permission,
 * 4/17/32/613 rate limits.
 * @param body - Parsed error response.
 * @param status - HTTP status.
 * @returns A readable error.
 */
function toGraphError(body: GraphErrorBody | null, status: number): GraphError {
  const code = body?.error?.code ?? null;
  const raw = body?.error?.message ?? null;
  if (code === 190) {
    return new GraphError("Facebook connection expired - regenerate the Page token.", code, raw);
  }
  if (code === 10 || (code !== null && code >= 200 && code < 300)) {
    return new GraphError(
      "The Facebook app is missing a permission - check the token's permissions.",
      code,
      raw,
    );
  }
  if (code === 4 || code === 17 || code === 32 || code === 613) {
    return new GraphError("Meta's rate limit was hit. Try again in an hour.", code, raw);
  }
  const detail = body?.error?.error_user_msg || raw;
  return new GraphError(
    detail ? `Meta said: ${detail}` : `Meta request failed (${status}).`,
    code,
    raw,
  );
}

/**
 * Calls the Graph API: GET/DELETE params in the query, POST form-encoded.
 * @param path - Path after the version, like "/123/feed".
 * @param method - HTTP method.
 * @param params - Request parameters, without the token.
 * @param token - Access token; the Page token unless given (debug_token can take the app's).
 * @returns The parsed JSON response.
 */
export async function graph<T>(
  path: string,
  method: "GET" | "POST" | "DELETE" = "GET",
  params: Record<string, string> = {},
  token: string | null = metaConfig().token,
): Promise<T> {
  if (!token) throw new GraphError("META_PAGE_ACCESS_TOKEN isn't set.", null);
  const all = new URLSearchParams({ ...params, access_token: token });
  const url = method === "POST" ? `${GRAPH_BASE}${path}` : `${GRAPH_BASE}${path}?${all}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      body: method === "POST" ? all : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    // Timed out or cut off: Meta may have acted on a POST before the answer was lost.
    if (method !== "POST") throw error;
    throw new GraphError("Meta didn't answer in time.", null, null, true);
  }
  const body = (await res.json().catch(() => null)) as (T & GraphErrorBody) | null;
  if (!res.ok || !body || body.error) {
    const error = toGraphError(body, res.status);
    const unsure = method === "POST" && (res.status >= 500 || (res.ok && !body));
    throw unsure ? new GraphError(error.message, error.code, error.raw, true) : error;
  }
  return body;
}

/**
 * Whether the token can still see the Page or Instagram account. Meta's error 100 reads "does
 * not exist, cannot be loaded due to missing permissions", so a missing object only counts as
 * deleted while its owner is still readable.
 * @param platform - Which account.
 * @returns True when the account answers as itself.
 */
export async function accountVisible(platform: "facebook" | "instagram"): Promise<boolean> {
  const { pageId, igAccountId } = metaConfig();
  const id = platform === "facebook" ? pageId : igAccountId;
  if (!id) return false;
  try {
    // A Page token's /me is the Page itself; a user token answers with the person.
    const me = await graph<{ id: string }>(platform === "facebook" ? "/me" : `/${id}`, "GET", {
      fields: "id",
    });
    return me.id === id;
  } catch {
    return false;
  }
}

/**
 * Deletes a Page post or Instagram media. Error 100 means gone OR lost access, so it counts as
 * already deleted only when the object is unreadable AND the owner is still visible.
 * @param id - Post or media id.
 * @param ownerVisible - Resolves true when the token can still see the owning account.
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

/**
 * Hands Meta a video to fetch for an upload session it opened (a reel or video story). Meta
 * downloads the file from the URL itself, so nothing large passes through this function.
 * @param videoId - The id the session's start call returned.
 * @param fileUrl - Public address of the video.
 */
export async function rupload(videoId: string, fileUrl: string): Promise<void> {
  const token = metaConfig().token;
  if (!token) throw new GraphError("META_PAGE_ACCESS_TOKEN isn't set.", null);
  const res = await fetch(`https://rupload.facebook.com/video-upload/${GRAPH_VERSION}/${videoId}`, {
    method: "POST",
    headers: { Authorization: `OAuth ${token}`, file_url: fileUrl },
    signal: AbortSignal.timeout(60_000),
  });
  const body = (await res.json().catch(() => null)) as
    ({ success?: boolean } & GraphErrorBody) | null;
  if (!res.ok || !body?.success) throw toGraphError(body, res.status);
}
