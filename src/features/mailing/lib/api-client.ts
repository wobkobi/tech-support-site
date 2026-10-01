// src/features/mailing/lib/api-client.ts
// Fetch wrapper for the mailing admin screens. Every mailing route answers
// `{ ok, ...data }` or `{ ok: false, error }`, so callers branch on `ok` and show
// `error` as-is; a network failure or a non-JSON reply becomes the same shape.

/** A mailing route's reply. */
export type ApiResult<T> = ({ ok: true } & T) | { ok: false; error: string };

/**
 * Calls a mailing route. A plain object body is sent as JSON; FormData as-is.
 * @param url - Route path.
 * @param method - HTTP method.
 * @param body - Optional request body.
 * @returns The parsed reply.
 */
export async function callApi<T = Record<string, never>>(
  url: string,
  method: "GET" | "POST" | "PATCH" | "DELETE" = "GET",
  body?: Record<string, unknown> | FormData,
): Promise<ApiResult<T>> {
  try {
    const isForm = body instanceof FormData;
    const res = await fetch(url, {
      method,
      headers: body && !isForm ? { "Content-Type": "application/json" } : undefined,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as ApiResult<T> | null;
    if (!data) return { ok: false, error: `Request failed (${res.status}).` };
    return data;
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection." };
  }
}
