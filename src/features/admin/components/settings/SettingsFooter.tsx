"use client";
// src/features/admin/components/settings/SettingsFooter.tsx
/**
 * @description Guardrail banners plus the save/reset bar, composed into the one
 * footer every settings tab ends with. Reads straight off the form api so a tab
 * cannot render the save bar while forgetting the banners that explain why a
 * save was refused.
 */

import { SettingsSaveBar } from "@/features/admin/components/settings/SettingsSaveBar";
import type { SettingsFormApi } from "@/features/admin/components/settings/useSettingsForm";
import type { SettingsGroup } from "@/shared/lib/settings/types";
import type React from "react";

/**
 * Footer for a settings tab: BLOCK banner, WARN banner with its confirm action,
 * and the save/reset bar.
 *
 * The guardrails are computed across the whole settings object rather than per
 * group, so any tab can be handed a warning raised by another group's config. A
 * tab that renders the save bar without the WARN banner goes silently
 * unsaveable when that happens - the save returns a 409 and nothing explains it.
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
          <button
            type="button"
            onClick={() => void form.save(true)}
            disabled={saving}
            className="mt-3 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Save anyway
          </button>
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
