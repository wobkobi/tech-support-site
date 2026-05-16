"use client";
// src/features/business/components/TaxonomyManageModal.tsx
/**
 * @file TaxonomyManageModal.tsx
 * @description Lightweight modal for the Calculator that lists every distinct
 * device + category currently in use and lets the operator clear individual
 * tags via the bulk-delete API. Tasks themselves stay; only the tag is unset.
 * Future parse-job runs will retag them.
 */

import { useEffect, useState } from "react";
import type React from "react";
import { cn } from "@/shared/lib/cn";

interface TaxonomyResponse {
  ok: boolean;
  devices?: string[];
  actions?: string[];
  error?: string;
}

interface DeleteResponse {
  ok: boolean;
  cleared?: number;
  error?: string;
}

interface Props {
  /** Admin token for the X-Admin-Secret header. */
  token: string;
  /** Called when the user dismisses the modal. */
  onClose: () => void;
  /** Called after a tag is cleared so the parent can refresh its template list. */
  onChanged?: () => void;
}

/**
 * Lists every distinct device and category in use across saved task templates,
 * with a per-row "clear" button. Clicking clear sets that tag to null on every
 * task row currently using it - the tasks remain, just untagged.
 * @param props - Component props.
 * @param props.token - Admin token forwarded as X-Admin-Secret.
 * @param props.onClose - Dismiss handler.
 * @param props.onChanged - Optional callback fired after a successful delete.
 * @returns Modal element.
 */
export function TaxonomyManageModal({ token, onClose, onChanged }: Props): React.ReactElement {
  const headers: Record<string, string> = { "X-Admin-Secret": token };

  const [devices, setDevices] = useState<string[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Two-step confirm baked into the row instead of native window.confirm(),
  // because Firefox's "stop showing this dialog" option permanently suppresses it.
  const [pendingClear, setPendingClear] = useState<string | null>(null);

  /**
   * Fetches the current taxonomy from the API and returns it.
   * Pure data fetcher - the caller applies the result via setState so this
   * never triggers a synchronous setState inside an effect.
   * @param signal - Optional AbortController signal.
   * @returns Devices + actions, or null if the request was aborted.
   */
  async function fetchTaxonomy(
    signal?: AbortSignal,
  ): Promise<{ devices: string[]; actions: string[] } | null> {
    const res = await fetch("/api/business/task-templates/taxonomy", { headers, signal });
    if (signal?.aborted) return null;
    const data = (await res.json()) as TaxonomyResponse;
    if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to load taxonomy");
    return { devices: data.devices ?? [], actions: data.actions ?? [] };
  }

  /**
   * Refreshes state from the API; used after a delete so the list re-syncs.
   */
  async function reload(): Promise<void> {
    try {
      const data = await fetchTaxonomy();
      if (data) {
        setDevices(data.devices);
        setActions(data.actions);
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reload failed");
    }
  }

  useEffect(() => {
    const ac = new AbortController();
    fetchTaxonomy(ac.signal)
      .then((data) => {
        if (!data) return;
        setDevices(data.devices);
        setActions(data.actions);
        setLoading(false);
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Load failed");
        setLoading(false);
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close on Escape.
  useEffect(() => {
    /**
     * Closes the modal when Escape is pressed.
     * @param e - Keyboard event.
     */
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  /**
   * Clears a tag from every task tagged with it. Caller must have confirmed
   * via the inline two-step (no window.confirm — Firefox suppresses it).
   * @param kind - Whether to clear a device or an action.
   * @param name - The tag value to clear.
   */
  async function clearTag(kind: "devices" | "actions", name: string): Promise<void> {
    setBusy(`${kind}:${name}`);
    setPendingClear(null);
    setError(null);
    try {
      const res = await fetch(`/api/business/task-templates/${kind}/${encodeURIComponent(name)}`, {
        method: "DELETE",
        headers,
      });
      const data = (await res.json()) as DeleteResponse;
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Delete failed");
      await reload();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Manage task taxonomy"
      onClick={onClose}
      className={cn(
        "fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-12 backdrop-blur-sm",
      )}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "w-full max-w-xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl",
        )}
      >
        <div
          className={cn("flex items-center justify-between border-b border-slate-200 px-5 py-4")}
        >
          <div>
            <h2 className={cn("text-russian-violet text-base font-bold")}>Manage tags</h2>
            <p className={cn("mt-0.5 text-xs text-slate-500")}>
              Clear devices or actions you no longer want; tasks tagged with them keep their other
              fields and get retagged on the next AI parse.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={cn(
              "h-9 w-9 shrink-0 rounded-lg text-2xl leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700",
            )}
          >
            ×
          </button>
        </div>

        <div className={cn("max-h-[60vh] space-y-6 overflow-y-auto px-5 py-4")}>
          {loading && <p className={cn("text-sm text-slate-500")}>Loading...</p>}
          {error && (
            <p className={cn("rounded bg-red-50 px-3 py-2 text-xs text-red-600")}>{error}</p>
          )}

          {!loading && (
            <>
              <TagSection
                title="Devices"
                tags={devices}
                busyKey={busy}
                pendingKey={pendingClear}
                onRequestClear={(name) => setPendingClear(`devices:${name}`)}
                onConfirmClear={(name) => void clearTag("devices", name)}
                onCancelClear={() => setPendingClear(null)}
                kind="devices"
              />
              <TagSection
                title="Actions"
                tags={actions}
                busyKey={busy}
                pendingKey={pendingClear}
                onRequestClear={(name) => setPendingClear(`actions:${name}`)}
                onConfirmClear={(name) => void clearTag("actions", name)}
                onCancelClear={() => setPendingClear(null)}
                kind="actions"
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Small list section for one of the taxonomy axes. Each row uses a two-step
 * inline confirmation rather than window.confirm() (Firefox suppresses native
 * confirm dialogs once the user opts out for the origin).
 * @param props - Component props.
 * @param props.title - Section heading (e.g. "Devices").
 * @param props.tags - Tag values to render.
 * @param props.busyKey - Currently-busy `kind:name` key to disable the matching button.
 * @param props.pendingKey - Currently-staged `kind:name` row awaiting confirm.
 * @param props.kind - Whether this section renders devices or categories.
 * @param props.onRequestClear - First click: stage the row for confirmation.
 * @param props.onConfirmClear - Second click: actually fire the delete.
 * @param props.onCancelClear - Cancel the pending confirmation.
 * @returns Tag list section.
 */
function TagSection({
  title,
  tags,
  busyKey,
  pendingKey,
  kind,
  onRequestClear,
  onConfirmClear,
  onCancelClear,
}: {
  title: string;
  tags: string[];
  busyKey: string | null;
  pendingKey: string | null;
  kind: "devices" | "actions";
  onRequestClear: (name: string) => void;
  onConfirmClear: (name: string) => void;
  onCancelClear: () => void;
}): React.ReactElement {
  return (
    <section>
      <h3 className={cn("text-russian-violet mb-2 text-xs font-bold uppercase tracking-wider")}>
        {title}
      </h3>
      {tags.length === 0 ? (
        <p className={cn("text-xs italic text-slate-400")}>None yet.</p>
      ) : (
        <ul className={cn("flex flex-col gap-1")}>
          {tags.map((tag) => {
            const rowKey = `${kind}:${tag}`;
            const isBusy = busyKey === rowKey;
            const isPending = pendingKey === rowKey;
            return (
              <li
                key={tag}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-lg border px-3 py-2",
                  isPending ? "border-red-300 bg-red-50" : "border-slate-200",
                )}
              >
                <span className={cn("truncate text-sm text-slate-700")}>{tag}</span>
                {isPending ? (
                  <div className={cn("flex shrink-0 items-center gap-2")}>
                    <span className={cn("text-xs text-red-700")}>Clear this tag?</span>
                    <button
                      type="button"
                      onClick={() => onConfirmClear(tag)}
                      className={cn(
                        "rounded bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-700",
                      )}
                    >
                      Yes, clear
                    </button>
                    <button
                      type="button"
                      onClick={onCancelClear}
                      className={cn(
                        "rounded text-xs font-semibold text-slate-500 hover:text-slate-700",
                      )}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => onRequestClear(tag)}
                    className={cn(
                      "shrink-0 rounded text-xs font-semibold text-red-500 hover:text-red-700 disabled:opacity-50",
                    )}
                  >
                    {isBusy ? "Clearing..." : "Clear"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
