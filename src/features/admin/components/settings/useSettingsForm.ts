"use client";
// src/features/admin/components/settings/useSettingsForm.ts
/**
 * @description Shared client state for one settings tab: holds the draft, tracks
 * dirty state, and saves to `/api/admin/settings/[group]`, mapping the route's
 * responses (400 field errors, 409 warnings, 422 blocks) into UI state. Reused
 * by every settings tab so the save/validation flow stays consistent.
 */

import type { Settings, SettingsGroup } from "@/shared/lib/settings/types";
import { checkGuardrails, type FieldError } from "@/shared/lib/settings/validate";
import type React from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * Full resolved settings, provided by SettingsView so each tab's form can run
 * the cross-setting guardrails live (against the other groups + its own draft).
 * Null when no provider is present - the live banner just stays empty then.
 */
export const SettingsAllContext = createContext<Settings | null>(null);

/**
 * Collects the dotted paths at which two settings values differ. Recurses only
 * into plain objects; an array or primitive that differs reports as its own
 * path rather than being walked, so a list editor reads as one changed field.
 * @param next - The draft value.
 * @param prev - The value to compare against.
 * @param prefix - Path accumulated so far (empty at the root).
 * @returns Dotted paths that differ.
 */
function diffPaths(next: unknown, prev: unknown, prefix = ""): string[] {
  if (Object.is(next, prev)) return [];
  const walkable =
    !!next &&
    !!prev &&
    typeof next === "object" &&
    typeof prev === "object" &&
    !Array.isArray(next) &&
    !Array.isArray(prev);
  if (!walkable) return prefix ? [prefix] : [];

  const a = next as Record<string, unknown>;
  const b = prev as Record<string, unknown>;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((key) =>
    diffPaths(a[key], b[key], prefix ? `${prefix}.${key}` : key),
  );
}

export interface SettingsFormApi<G extends SettingsGroup> {
  draft: Settings[G];
  setDraft: React.Dispatch<React.SetStateAction<Settings[G]>>;
  /** Last-saved value (advances on each successful save). The revert target. */
  baseline: Settings[G];
  dirty: boolean;
  /** Dotted paths edited since the last save, keyed to match field ids. */
  changedPaths: Set<string>;
  saving: boolean;
  /** Field path > message for inline errors. */
  fieldErrors: Record<string, string>;
  /** Guardrail BLOCK messages (save refused). */
  blocks: string[];
  /** Guardrail WARN messages (save needs confirming). */
  warns: string[];
  /** Epoch ms of the last successful save, or null. */
  savedAt: number | null;
  /** Saves the draft. Pass true to confirm past WARN-level guardrails. */
  save: (confirmWarnings?: boolean) => Promise<boolean>;
  /** Resets the draft back to the supplied defaults (does not save). */
  resetToDefault: () => void;
}

/**
 * Manages draft + save lifecycle for one settings group.
 * @param group - Which settings group this tab edits.
 * @param initial - The server-resolved current value for the group.
 * @param defaults - The code default for the group (used by resetToDefault).
 * @returns Form state + actions for the tab.
 */
export function useSettingsForm<G extends SettingsGroup>(
  group: G,
  initial: Settings[G],
  defaults: Settings[G],
): SettingsFormApi<G> {
  const [draft, setDraft] = useState<Settings[G]>(initial);
  // Dirty baseline. Starts at the server value and advances to the just-saved
  // draft after each successful save, so the save bar clears and the "Saved"
  // confirmation can show instead of staying permanently dirty.
  const [baseline, setBaseline] = useState<Settings[G]>(initial);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverBlocks, setServerBlocks] = useState<string[]>([]);
  const [serverWarns, setServerWarns] = useState<string[]>([]);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Live cross-setting guardrails: run the same pure check the save route uses,
  // against the current draft over the other groups, so BLOCK/WARN issues show
  // as the operator types instead of only after a rejected save.
  const all = useContext(SettingsAllContext);
  const live = useMemo(() => {
    if (!all) return { blocks: [] as string[], warns: [] as string[] };
    const proposed = { ...all, [group]: draft };
    const issues = checkGuardrails(proposed);
    return {
      blocks: issues.filter((i) => i.level === "block").map((i) => i.message),
      warns: issues.filter((i) => i.level === "warn").map((i) => i.message),
    };
  }, [all, group, draft]);

  // Merge live findings with anything the server returned (deduped).
  const blocks = useMemo(
    () => [...new Set([...live.blocks, ...serverBlocks])],
    [live.blocks, serverBlocks],
  );
  const warns = useMemo(
    () => [...new Set([...live.warns, ...serverWarns])],
    [live.warns, serverWarns],
  );

  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);

  // Dotted paths of the fields edited since the last save, keyed the same way
  // field ids are, so a field row can recognise itself without every call site
  // threading a prop. Arrays and other non-plain values report as one path
  // (`morningGuards`, `servedSuburbs`) rather than per index, matching the
  // single anchor those composite editors render.
  const changedPaths = useMemo(() => new Set(diffPaths(draft, baseline)), [draft, baseline]);

  // Warn before a full-page unload (reload / close / external nav) with unsaved
  // edits. This does not cover in-app settings tab switches: SettingsView renders
  // only the active tab, so switching tabs unmounts the current draft.
  useEffect(() => {
    if (!dirty) return;
    /**
     * Triggers the browser's native unsaved-changes prompt.
     * @param e - The beforeunload event.
     */
    const handler = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const save = useCallback(
    async (confirmWarnings = false): Promise<boolean> => {
      setSaving(true);
      setFieldErrors({});
      setServerBlocks([]);
      if (!confirmWarnings) setServerWarns([]);
      try {
        const res = await fetch(`/api/admin/settings/${group}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ value: draft, confirmWarnings }),
        });
        if (res.ok) {
          setSavedAt(Date.now());
          setServerWarns([]);
          setBaseline(draft);
          return true;
        }
        const data = (await res.json().catch(() => ({}))) as {
          fieldErrors?: FieldError[];
          blocks?: string[];
          warns?: string[];
          error?: string;
        };
        if (res.status === 400 && data.fieldErrors) {
          const map: Record<string, string> = {};
          for (const fe of data.fieldErrors) map[fe.field] = fe.message;
          setFieldErrors(map);
        } else if (res.status === 422) {
          setServerBlocks(data.blocks ?? [data.error ?? "Save blocked."]);
        } else if (res.status === 409) {
          setServerWarns(data.warns ?? []);
        } else {
          setServerBlocks([data.error ?? "Save failed."]);
        }
        return false;
      } catch {
        setServerBlocks(["Network error - please try again."]);
        return false;
      } finally {
        setSaving(false);
      }
    },
    [group, draft],
  );

  const resetToDefault = useCallback(() => setDraft(defaults), [defaults]);

  return {
    draft,
    setDraft,
    baseline,
    dirty,
    changedPaths,
    saving,
    fieldErrors,
    blocks,
    warns,
    savedAt,
    save,
    resetToDefault,
  };
}
