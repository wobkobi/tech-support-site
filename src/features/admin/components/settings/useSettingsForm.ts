"use client";
// src/features/admin/components/settings/useSettingsForm.ts
/**
 * @file useSettingsForm.ts
 * @description Shared client state for one settings tab: holds the draft, tracks
 * dirty state, and saves to `/api/admin/settings/[group]`, mapping the route's
 * responses (400 field errors, 409 warnings, 422 blocks) into UI state. Reused
 * by every settings tab so the save/validation flow stays consistent.
 */

import { useCallback, useState } from "react";
import type React from "react";
import type { Settings, SettingsGroup } from "@/shared/lib/settings/types";
import type { FieldError } from "@/shared/lib/settings/validate";

export interface SettingsFormApi<G extends SettingsGroup> {
  draft: Settings[G];
  setDraft: React.Dispatch<React.SetStateAction<Settings[G]>>;
  dirty: boolean;
  saving: boolean;
  /** Field path -> message for inline errors. */
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
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [blocks, setBlocks] = useState<string[]>([]);
  const [warns, setWarns] = useState<string[]>([]);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  const save = useCallback(
    async (confirmWarnings = false): Promise<boolean> => {
      setSaving(true);
      setFieldErrors({});
      setBlocks([]);
      if (!confirmWarnings) setWarns([]);
      try {
        const res = await fetch(`/api/admin/settings/${group}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ value: draft, confirmWarnings }),
        });
        if (res.ok) {
          setSavedAt(Date.now());
          setWarns([]);
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
          setBlocks(data.blocks ?? [data.error ?? "Save blocked."]);
        } else if (res.status === 409) {
          setWarns(data.warns ?? []);
        } else {
          setBlocks([data.error ?? "Save failed."]);
        }
        return false;
      } catch {
        setBlocks(["Network error - please try again."]);
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
