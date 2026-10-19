// src/shared/lib/api-client.ts
// Client wrapper for the site's JSON API, mirroring api-response.ts's `{ ok, ... }` contract so
// callers branch once.

/** Outcome of an {@link apiFetch} call. */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

/** Init for {@link apiFetch}; `json` serialises a body and sets the content type. */
export type ApiFetchInit = Omit<RequestInit, "body"> & {
  /** Serialised as the JSON request body. */
  json?: unknown;
  /** Raw body, for the rare non-JSON request. */
  body?: BodyInit;
};

/**
 * Status-derived wording for when the server sent no `error` field.
 * @param status - HTTP status of the failed response (0 for a network error).
 * @returns A human-readable message.
 */
function fallbackMessage(status: number): string {
  if (status === 401 || status === 403) return "Not authorised - sign in again.";
  if (status === 404) return "Not found.";
  if (status === 409) return "That conflicts with the current state - reload and retry.";
  if (status >= 500) return "Something went wrong on the server - try again.";
  return `Request failed (${status}).`;
}

/**
 * Calls a site JSON API route. Fails on a non-ok status OR `ok: false`; success returns the
 * whole body as `data`. Network errors become `status: 0`.
 * @param url - Same-origin API path.
 * @param init - Standard fetch init, plus `json` to send a JSON body.
 * @returns The parsed body on success, or an error message and status.
 */
export async function apiFetch<T = Record<string, unknown>>(
  url: string,
  init: ApiFetchInit = {},
): Promise<ApiResult<T>> {
  const { json, headers, ...rest } = init;
  try {
    const res = await fetch(url, {
      ...rest,
      headers:
        json === undefined ? headers : { "Content-Type": "application/json", ...(headers ?? {}) },
      body: json === undefined ? rest.body : JSON.stringify(json),
    });

    const data = (await res.json().catch(() => null)) as
      (T & { ok?: boolean; error?: string }) | null;

    if (!res.ok || data?.ok === false) {
      return {
        ok: false,
        error: data?.error ?? fallbackMessage(res.status),
        status: res.status,
      };
    }
    return { ok: true, data: (data ?? {}) as T };
  } catch {
    return { ok: false, error: "Network error - check your connection.", status: 0 };
  }
}
