"use client";
// src/features/admin/components/settings/SettingsFooter.tsx
// Guardrail banners plus the save/reset bar, as one footer so no tab renders the save bar
// without the banners that explain a refused save.

import { SettingsSaveBar } from "@/features/admin/components/settings/SettingsSaveBar";
import type { SettingsFormApi } from "@/features/admin/components/settings/useSettingsForm";
import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import type { SettingsGroup } from "@/shared/lib/settings/types";
import type React from "react";

/**
 * Footer for a settings tab: BLOCK banner, WARN banner with its confirm action, and the
 * save/reset bar. Guardrails span every group, so any tab can get another group's WARN
 * (a 409 on save); without the banner the tab would be silently unsaveable.
 * @param props - Component props.
 * @param props.form - The tab's form api from useSettingsForm.
 * @returns The footer element.
 */
export function SettingsFooter<G extends SettingsGroup>({
  form,
}: {
  form: SettingsFormApi<G>;
}): React.ReactElement {
  const { blocks, warns, dirty, saving, savedAt } = form;

  return (
    <>
      {/* Guardrail blocks - save was refused. */}
      {blocks.length > 0 && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-semibold text-red-700">Can&apos;t save yet:</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-red-700">
            {blocks.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Guardrail warnings - allowed, but confirm. */}
      {warns.length > 0 && (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-800">Heads up:</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-amber-800">
            {warns.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          {/* Amber tint so the save bar's Save stays the tab's one primary. */}
          <AdminButton
            variant="secondary"
            onClick={() => void form.save(true)}
            disabled={saving}
            className="mt-3 border-amber-300 bg-amber-100 text-amber-900 hover:border-amber-500 hover:bg-amber-200"
          >
            Save anyway
          </AdminButton>
        </div>
      )}

      <SettingsSaveBar
        dirty={dirty}
        saving={saving}
        savedAt={savedAt}
        onSave={() => void form.save()}
        onReset={form.resetToDefault}
      />
    </>
  );
}
