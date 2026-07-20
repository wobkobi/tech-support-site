"use client";
// src/features/admin/components/settings/ReviewsTab.tsx
/**
 * @description Editor for the reviews & reputation group: how many reviews
 * feature on the home page, whether verified reviews auto-approve, and the
 * review-request cooldown. Saves through the shared settings form hook.
 */

import { NumberField, ToggleField } from "@/features/admin/components/settings/SettingsFields";
import { SettingsHistory } from "@/features/admin/components/settings/SettingsHistory";
import { SettingsSaveBar } from "@/features/admin/components/settings/SettingsSaveBar";
import { useSettingsForm } from "@/features/admin/components/settings/useSettingsForm";
import { REVIEWS_FIELD_META } from "@/shared/lib/settings/field-meta";
import type { ReviewsSettings } from "@/shared/lib/settings/types";
import type React from "react";

interface Props {
  initial: ReviewsSettings;
  defaults: ReviewsSettings;
}

/**
 * Reviews & reputation settings tab.
 * @param props - Component props.
 * @param props.initial - Server-resolved current reviews settings.
 * @param props.defaults - Code default reviews settings.
 * @returns Reviews tab element.
 */
export function ReviewsTab({ initial, defaults }: Props): React.ReactElement {
  const form = useSettingsForm("reviews", initial, defaults);
  const { draft, setDraft, dirty, saving, fieldErrors, blocks, savedAt } = form;
  const m = REVIEWS_FIELD_META;

  /**
   * Merges a reviews patch into the draft.
   * @param patch - Partial reviews fields.
   * @returns void
   */
  const set = (patch: Partial<ReviewsSettings>): void => setDraft((p) => ({ ...p, ...patch }));

  return (
    <div>
      <div className="divide-y divide-admin-border">
        <NumberField
          id="homepageFeaturedCount"
          meta={m.homepageFeaturedCount}
          value={draft.homepageFeaturedCount}
          min={0}
          max={50}
          error={fieldErrors.homepageFeaturedCount}
          customised={draft.homepageFeaturedCount !== defaults.homepageFeaturedCount}
          onChange={(v) => set({ homepageFeaturedCount: v ?? 0 })}
        />
        <ToggleField
          id="autoApproveVerified"
          meta={m.autoApproveVerified}
          value={draft.autoApproveVerified}
          customised={draft.autoApproveVerified !== defaults.autoApproveVerified}
          onChange={(v) => set({ autoApproveVerified: v })}
        />
        <NumberField
          id="invoiceReviewCooldownDays"
          meta={m.invoiceReviewCooldownDays}
          value={draft.invoiceReviewCooldownDays}
          min={1}
          error={fieldErrors.invoiceReviewCooldownDays}
          customised={draft.invoiceReviewCooldownDays !== defaults.invoiceReviewCooldownDays}
          onChange={(v) => set({ invoiceReviewCooldownDays: v ?? 1 })}
        />
      </div>

      {/* Guardrail blocks */}
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

      <SettingsSaveBar
        dirty={dirty}
        saving={saving}
        savedAt={savedAt}
        onSave={() => void form.save()}
        onReset={form.resetToDefault}
      />

      <SettingsHistory group="reviews" onRestore={(v: ReviewsSettings) => setDraft(v)} />
    </div>
  );
}
