"use client";
// src/features/admin/components/settings/SettingsHistory.tsx
/**
 * @file SettingsHistory.tsx
 * @description Collapsible per-group change-history panel shared by every
 * settings tab. Lazily fetches the recent SettingAudit rows on first open and
 * lets the operator load a prior version back into the editor draft (via
 * onRestore) to review and re-save - the re-save records its own audit row, so
 * a revert is just another tracked change.
 */

import { useState } from "react";
import type React from "react";
import { cn } from "@/shared/lib/cn";
import { formatDateTimeLong } from "@/shared/lib/date-format";
import type { SettingsGroup } from "@/shared/lib/settings/types";

/** One history row as returned by the history route. */
interface HistoryEntry {
  id: string;
  changedAt: string;
  isInitial: boolean;
  changedKeys: string[];
  /** Raw JSON of the group value after this change (for restore). */
  value: string;
}

interface Props<T> {
  /** Which settings group's history to show. */
  group: SettingsGroup;
  /** Loads a restored value into the tab's editor draft. */
  onRestore: (value: T) => void;
}

/**
 * Per-group change-history + restore panel.
 * @param props - Component props.
 * @param props.group - Settings group whose history to load.
 * @param props.onRestore - Called with a prior value to load into the draft.
 * @returns History panel element.
 */
export function SettingsHistory<T>({ group, onRestore }: Props<T>): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoredId, setRestoredId] = useState<string | null>(null);

  /**
   * Fetches the group's history rows from the API.
   * @returns Resolves once the rows are loaded (or an error is set).
   */
  const load = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/settings/${group}/history`);
      const data = (await res.json()) as { ok?: boolean; error?: string; entries?: HistoryEntry[] };
      if (!res.ok || !data.ok || !data.entries) throw new Error(data.error ?? "Failed to load");
      setEntries(data.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  };

  /**
   * Toggles the panel, lazily loading rows the first time it opens.
   */
  const toggle = (): void => {
    const next = !open;
    setOpen(next);
    if (next && entries === null) void load();
  };

  /**
   * Loads a history row's value into the editor draft for review.
   * @param entry - The history row to restore.
   */
  const restore = (entry: HistoryEntry): void => {
    try {
      onRestore(JSON.parse(entry.value) as T);
      setRestoredId(entry.id);
    } catch {
      setError("Couldn't read that version.");
    }
  };

  return (
    <div className={cn("mt-6 border-t border-slate-100 pt-4")}>
      <button
        type="button"
        onClick={toggle}
        className={cn("text-russian-violet text-sm font-medium hover:underline")}
      >
        {open ? "Hide change history" : "Change history"}
      </button>

      {open && (
        <div className={cn("mt-3")}>
          {loading && <p className={cn("text-sm text-slate-400")}>Loading...</p>}
          {error && <p className={cn("text-sm text-red-600")}>{error}</p>}
          {entries && entries.length === 0 && (
            <p className={cn("text-sm text-slate-400")}>No changes recorded yet.</p>
          )}
          {entries && entries.length > 0 && (
            <ul className={cn("divide-y divide-slate-100")}>
              {entries.map((e, i) => (
                <li key={e.id} className={cn("flex items-center justify-between gap-3 py-2")}>
                  <div className={cn("min-w-0")}>
                    <p className={cn("text-sm text-slate-700")}>
                      {formatDateTimeLong(new Date(e.changedAt))}
                      {i === 0 && <span className={cn("text-slate-400")}> - current</span>}
                    </p>
                    <p className={cn("truncate text-xs text-slate-500")}>
                      {e.isInitial
                        ? "First saved"
                        : e.changedKeys.length > 0
                          ? `Changed: ${e.changedKeys.join(", ")}`
                          : "No field changes"}
                    </p>
                  </div>
                  {i !== 0 && (
                    <button
                      type="button"
                      onClick={() => restore(e)}
                      className={cn(
                        "shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50",
                      )}
                    >
                      {restoredId === e.id ? "Loaded" : "Restore"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {restoredId && (
            <p className={cn("mt-2 text-xs text-emerald-600")}>
              Loaded into the form above - review the values and Save to apply.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
