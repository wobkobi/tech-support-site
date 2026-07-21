"use client";
// src/features/business/components/TaxonomyManageModal.tsx
/**
 * @description Lightweight modal for the Calculator that lists every distinct
 * device + category currently in use and lets the operator RENAME a tag (the
 * safe fix for a drifted or misspelt one - every task using it follows, and
 * colliding rows merge) or CLEAR it.
 *
 * Clearing is permanent. The AI may only reuse tags from the live vocabulary,
 * and that vocabulary is built from these tags, so a cleared tag is never
 * offered back to the model and its rows go inert. The copy below says so
 * plainly - it previously promised the next parse would retag them, which is
 * not something the system can do.
 */

import { Modal } from "@/features/admin/components/ui/Modal";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useEffect, useState } from "react";

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

interface RenameResponse {
  ok: boolean;
  renamed?: number;
  merged?: number;
  error?: string;
}

interface Props {
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
 * @param props.onClose - Dismiss handler.
 * @param props.onChanged - Optional callback fired after a successful delete.
 * @returns Modal element.
 */
export function TaxonomyManageModal({ onClose, onChanged }: Props): React.ReactElement {
  const headers: Record<string, string> = {};

  const [devices, setDevices] = useState<string[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Two-step confirm baked into the row instead of native window.confirm(),
  // because Firefox's "stop showing this dialog" option permanently suppresses it.
  const [pendingClear, setPendingClear] = useState<string | null>(null);
  // `kind:name` currently being renamed, plus the draft value for its input.
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

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

  /**
   * Clears a tag from every task tagged with it. Caller must have confirmed
   * via the inline two-step (no window.confirm, Firefox suppresses it).
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

  /**
   * Renames a tag across every task using it. Colliding rows merge server-side,
   * so this is safe to use for fixing a drifted spelling.
   * @param kind - Whether to rename a device or an action.
   * @param name - The current tag value.
   * @param to - The replacement value.
   */
  async function renameTag(kind: "devices" | "actions", name: string, to: string): Promise<void> {
    const target = to.trim();
    if (!target || target === name) {
      setRenaming(null);
      return;
    }
    setBusy(`${kind}:${name}`);
    setError(null);
    try {
      const res = await fetch(`/api/business/task-templates/${kind}/${encodeURIComponent(name)}`, {
        method: "PATCH",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ to: target }),
      });
      const data = (await res.json()) as RenameResponse;
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Rename failed");
      setRenaming(null);
      await reload();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rename failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Manage tags"
      size="lg"
      description={
        <>
          <strong>Rename</strong> to fix a spelling - every task using the tag follows, and
          duplicates merge. <strong>Clear</strong> only when that work is gone for good: it removes
          the tag from the AI&apos;s vocabulary, so those tasks are not retagged later.
        </>
      }
    >
      <div className="space-y-6">
        {loading && <p className="text-sm text-admin-muted">Loading...</p>}
        {error && <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}

        {!loading &&
          (["devices", "actions"] as const).map((kind) => (
            <TagSection
              key={kind}
              title={kind === "devices" ? "Devices" : "Actions"}
              tags={kind === "devices" ? devices : actions}
              kind={kind}
              busyKey={busy}
              pendingKey={pendingClear}
              renamingKey={renaming}
              renameValue={renameValue}
              onRenameValue={setRenameValue}
              onRequestRename={(name) => {
                setPendingClear(null);
                setRenaming(`${kind}:${name}`);
                setRenameValue(name);
              }}
              onSubmitRename={(name) => void renameTag(kind, name, renameValue)}
              onCancelRename={() => setRenaming(null)}
              onRequestClear={(name) => {
                setRenaming(null);
                setPendingClear(`${kind}:${name}`);
              }}
              onConfirmClear={(name) => void clearTag(kind, name)}
              onCancelClear={() => setPendingClear(null)}
            />
          ))}
      </div>
    </Modal>
  );
}

/**
 * Taxonomy axis list. Rename is inline; clear uses a two-step inline confirm
 * (Firefox suppresses native confirm dialogs once the user opts out).
 * @param props - Component props.
 * @param props.title - Section heading (e.g. "Devices").
 * @param props.tags - Tag values to render.
 * @param props.busyKey - Currently-busy `kind:name` key.
 * @param props.pendingKey - `kind:name` staged for clear confirmation.
 * @param props.renamingKey - `kind:name` currently being renamed.
 * @param props.renameValue - Draft value for the rename input.
 * @param props.onRenameValue - Updates the rename draft.
 * @param props.kind - Whether this section renders devices or actions.
 * @param props.onRequestRename - Open the inline rename editor for a row.
 * @param props.onSubmitRename - Commit the rename.
 * @param props.onCancelRename - Abandon the rename.
 * @param props.onRequestClear - First click: stage the row for confirmation.
 * @param props.onConfirmClear - Second click: fire the delete.
 * @param props.onCancelClear - Cancel the pending confirmation.
 * @returns Tag list section.
 */
function TagSection({
  title,
  tags,
  busyKey,
  pendingKey,
  renamingKey,
  renameValue,
  onRenameValue,
  kind,
  onRequestRename,
  onSubmitRename,
  onCancelRename,
  onRequestClear,
  onConfirmClear,
  onCancelClear,
}: {
  title: string;
  tags: string[];
  busyKey: string | null;
  pendingKey: string | null;
  renamingKey: string | null;
  renameValue: string;
  onRenameValue: (v: string) => void;
  kind: "devices" | "actions";
  onRequestRename: (name: string) => void;
  onSubmitRename: (name: string) => void;
  onCancelRename: () => void;
  onRequestClear: (name: string) => void;
  onConfirmClear: (name: string) => void;
  onCancelClear: () => void;
}): React.ReactElement {
  return (
    <section>
      <h3 className="mb-2 text-xs font-bold tracking-wider text-russian-violet uppercase">
        {title}
      </h3>
      {tags.length === 0 ? (
        <p className="text-xs text-admin-faint italic">None yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {tags.map((tag) => {
            const rowKey = `${kind}:${tag}`;
            const isBusy = busyKey === rowKey;
            const isPending = pendingKey === rowKey;
            const isRenaming = renamingKey === rowKey;
            return (
              <li
                key={tag}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-lg border px-3 py-2",
                  isPending
                    ? "border-red-300 bg-red-50"
                    : isRenaming
                      ? "border-admin-border-strong bg-admin-bg"
                      : "border-admin-border",
                )}
              >
                {isRenaming ? (
                  <>
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => onRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") onSubmitRename(tag);
                        if (e.key === "Escape") onCancelRename();
                      }}
                      aria-label={`Rename ${tag}`}
                      className="min-w-0 flex-1 rounded border border-admin-border-strong px-2 py-1 text-sm text-admin-text"
                    />
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onSubmitRename(tag)}
                        className="rounded bg-russian-violet px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        {isBusy ? "Saving..." : "Save"}
                      </button>
                      <button
                        type="button"
                        onClick={onCancelRename}
                        className="rounded text-xs font-semibold text-admin-muted hover:text-admin-text"
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="truncate text-sm text-admin-text">{tag}</span>
                    {isPending ? (
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-xs text-red-700">Clear for good?</span>
                        <button
                          type="button"
                          onClick={() => onConfirmClear(tag)}
                          className="rounded bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-700"
                        >
                          Yes, clear
                        </button>
                        <button
                          type="button"
                          onClick={onCancelClear}
                          className="rounded text-xs font-semibold text-admin-muted hover:text-admin-text"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex shrink-0 items-center gap-3">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => onRequestRename(tag)}
                          className="rounded text-xs font-semibold text-admin-muted hover:text-russian-violet disabled:opacity-50"
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => onRequestClear(tag)}
                          className="rounded text-xs font-semibold text-red-500 hover:text-red-700 disabled:opacity-50"
                        >
                          {isBusy ? "Clearing..." : "Clear"}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
