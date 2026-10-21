"use client";
// src/features/admin/components/settings/SettingsSaveBar.tsx
// Shared save/reset bar with dirty/saved indicators. High-impact confirmations live on the
// controls that cause them, so a cancelled confirm just reverts that switch.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { StickyActionBar } from "@/features/admin/components/ui/StickyActionBar";
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
    // Pinned at every width so the actions stay reachable on long tabs.
    <StickyActionBar stickOnPhone>
      <AdminButton variant="primary" busy={saving} disabled={!dirty || saving} onClick={onSave}>
        Save changes
      </AdminButton>
      <AdminButton variant="secondary" disabled={saving} onClick={onReset}>
        Reset to defaults
      </AdminButton>
      {dirty && !saving && (
        <span className="basis-full text-sm text-admin-faint sm:basis-auto">Unsaved changes</span>
      )}
      {!dirty && savedAt && (
        <span className="basis-full text-sm font-medium text-green-700 sm:basis-auto">Saved</span>
      )}
    </StickyActionBar>
  );
}
