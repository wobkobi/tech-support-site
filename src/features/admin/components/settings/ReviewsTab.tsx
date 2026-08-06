"use client";
// src/features/admin/components/settings/ReviewsTab.tsx
/**
 * @description Editor for the reviews & reputation group: how many reviews
 * feature on the home page, whether verified reviews auto-approve, and the
 * review-request cooldown. Saves through the shared settings form hook.
 */

import {
  NumberField,
  SettingsTabBody,
  ToggleField,
} from "@/features/admin/components/settings/SettingsFields";
import { SettingsFooter } from "@/features/admin/components/settings/SettingsFooter";
import { SettingsHistory } from "@/features/admin/components/settings/SettingsHistory";
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
  const { draft, setDraft, fieldErrors } = form;
  const m = REVIEWS_FIELD_META;

  /**
   * Merges a reviews patch into the draft.
   * @param patch - Partial reviews fields.
   * @returns void
   */
  const set = (patch: Partial<ReviewsSettings>): void => setDraft((p) => ({ ...p, ...patch }));

  return (
    <SettingsTabBody changed={form.changedPaths}>
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

      <SettingsFooter form={form} />

      <SettingsHistory group="reviews" onRestore={(v: ReviewsSettings) => setDraft(v)} />
    </SettingsTabBody>
  );
}
