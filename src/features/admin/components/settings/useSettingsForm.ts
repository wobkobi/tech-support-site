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

export interface SettingsFormApi<G extends SettingsGroup> {
  draft: Settings[G];
  setDraft: React.Dispatch<React.SetStateAction<Settings[G]>>;
  /** Last-saved value (advances on each successful save). The revert target. */
  baseline: Settings[G];
  dirty: boolean;
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
    const proposed = { ...all, [group]: draft } as Settings;
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
    saving,
    fieldErrors,
    blocks,
    warns,
    savedAt,
    save,
    resetToDefault,
  };
}
