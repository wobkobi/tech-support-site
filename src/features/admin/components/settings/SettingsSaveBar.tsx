"use client";
// src/features/admin/components/settings/SettingsSaveBar.tsx
/**
 * @description Shared save/reset bar for every settings tab: "Save changes",
 * "Reset to defaults", and the dirty / saved indicators. High-impact
 * confirmations live on the individual controls that cause them, so a
 * cancelled confirm leaves the switch where it was rather than after a save.
 */

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import type React from "react";

/** Props for {@link SettingsSaveBar}. */
interface SettingsSaveBarProps {
  /** Whether the draft differs from the last-saved baseline. */
  dirty: boolean;
  /** Whether a save is in flight. */
  saving: boolean;
  /** Epoch ms of the last successful save, or null. */
  savedAt: number | null;
  /** Runs the save (already bound to the tab's form). */
  onSave: () => void;
  /** Resets the draft back to defaults. */
  onReset: () => void;
}

/**
 * Save / reset controls shared by every settings tab.
 * @param props - Component props.
 * @param props.dirty - Whether the draft is dirty.
 * @param props.saving - Whether a save is in flight.
 * @param props.savedAt - Epoch ms of the last successful save, or null.
 * @param props.onSave - Save handler.
 * @param props.onReset - Reset-to-defaults handler.
 * @returns The save bar element.
 */
export function SettingsSaveBar({
  dirty,
  saving,
  savedAt,
  onSave,
  onReset,
}: SettingsSaveBarProps): React.ReactElement {
  return (
    // Sticky + full-bleed within the card padding so the actions stay reachable
    // on long tabs without scrolling to the very bottom.
    <div className="sticky bottom-0 z-10 -mx-5 mt-6 flex items-center gap-3 border-t border-admin-border bg-admin-surface/95 px-5 py-3 backdrop-blur sm:-mx-6 sm:px-6">
      <AdminButton variant="primary" busy={saving} disabled={!dirty || saving} onClick={onSave}>
        Save changes
      </AdminButton>
      <AdminButton variant="secondary" disabled={saving} onClick={onReset}>
        Reset to defaults
      </AdminButton>
      {dirty && !saving && <span className="text-sm text-admin-faint">Unsaved changes</span>}
      {!dirty && savedAt && <span className="text-sm font-medium text-emerald-600">Saved</span>}
    </div>
  );
}
