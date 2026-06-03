"use client";
// src/features/admin/components/settings/ReviewsTab.tsx
/**
 * @file ReviewsTab.tsx
 * @description Editor for the reviews & reputation group: how many reviews
 * feature on the home page, whether verified reviews auto-approve, and the
 * review-request cooldown. Saves through the shared settings form hook.
 */

import type React from "react";
import { cn } from "@/shared/lib/cn";
import { REVIEWS_FIELD_META } from "@/shared/lib/settings/field-meta";
import type { ReviewsSettings } from "@/shared/lib/settings/types";
import { NumberField, ToggleField } from "@/features/admin/components/settings/SettingsFields";
import { useSettingsForm } from "@/features/admin/components/settings/useSettingsForm";

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
      <div className={cn("divide-y divide-slate-100")}>
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
        <div className={cn("mt-6 rounded-lg border border-red-200 bg-red-50 p-4")}>
          <p className={cn("text-sm font-semibold text-red-700")}>Can&apos;t save yet:</p>
          <ul className={cn("mt-1 list-disc space-y-1 pl-5 text-sm text-red-700")}>
            {blocks.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Save bar */}
      <div className={cn("mt-6 flex items-center gap-3")}>
        <button
          type="button"
          onClick={() => void form.save()}
          disabled={!dirty || saving}
          className={cn(
            "bg-russian-violet rounded-lg px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50",
          )}
        >
          {saving ? "Saving..." : "Save changes"}
        </button>
        <button
          type="button"
          onClick={form.resetToDefault}
          disabled={saving}
          className={cn(
            "rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50",
          )}
        >
          Reset to defaults
        </button>
        {dirty && !saving && <span className={cn("text-sm text-slate-400")}>Unsaved changes</span>}
        {!dirty && savedAt && (
          <span className={cn("text-sm font-medium text-emerald-600")}>Saved</span>
        )}
      </div>
    </div>
  );
}
