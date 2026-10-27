"use client";
// src/features/admin/components/settings/SocialTab.tsx
// Editor for the social group: the brand profile every AI writer reads, the defaults for Write
// with AI's hashtag and emoji choices, the logo on photos, and how schedules line up posts,
// beside a sample post and photo.

import {
  FieldShell,
  NumberField,
  SettingsTabBody,
  TextField,
  ToggleField,
} from "@/features/admin/components/settings/SettingsFields";
import { SettingsFooter } from "@/features/admin/components/settings/SettingsFooter";
import { SettingsHistory } from "@/features/admin/components/settings/SettingsHistory";
import { SettingsWithPreview } from "@/features/admin/components/settings/SettingsWithPreview";
import { SocialPreview } from "@/features/admin/components/settings/SocialPreview";
import { useSettingsForm } from "@/features/admin/components/settings/useSettingsForm";
import { WatermarkPreview } from "@/features/admin/components/settings/WatermarkPreview";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { AdminSelect } from "@/features/admin/components/ui/AdminSelect";
import { ADMIN_EYEBROW_CLS } from "@/features/admin/components/ui/field-classes";
import { minuteLabel, slotMinutes } from "@/features/social/lib/queue-slots";
import { cn } from "@/shared/lib/cn";
import { formatHashtags, parseHashtags } from "@/shared/lib/hashtags";
import {
  HASHTAGS_DEFAULT_LABELS,
  QUEUE_FILL_DAYS_RANGE,
  SOCIAL_FIELD_META,
  WATERMARK_CORNER_LABELS,
  WATERMARK_LOGO_LABELS,
  WATERMARK_OPACITY_RANGE,
  WATERMARK_SIZE_RANGE,
} from "@/shared/lib/settings/field-meta";
import type {
  BrandProfile,
  HashtagsDefault,
  ScheduleSettings,
  SocialSettings,
  WatermarkCorner,
  WatermarkLogo,
  WatermarkSettings,
} from "@/shared/lib/settings/types";
import type React from "react";

interface Props {
  initial: SocialSettings;
  defaults: SocialSettings;
}

/** The brand profile's free-text fields, in the order they show. */
const TEXT_FIELDS = ["notes", "audience", "tone", "avoid"] as const;

/**
 * Social & brand settings tab.
 * @param props - Component props.
 * @param props.initial - Server-resolved current social settings.
 * @param props.defaults - Code default social settings.
 * @returns Social tab element.
 */
export function SocialTab({ initial, defaults }: Props): React.ReactElement {
  const form = useSettingsForm("social", initial, defaults);
  const { draft, setDraft, fieldErrors } = form;
  const brand = draft.brand;
  const base = defaults.brand;
  const mark = draft.watermark;
  const baseMark = defaults.watermark;
  const sched = draft.schedules;
  const baseSched = defaults.schedules;
  const m = SOCIAL_FIELD_META;
  const tags = parseHashtags(brand.hashtags).tags;
  const tagsError = fieldErrors["brand.hashtags"];

  /**
   * Merges a patch into the brand profile draft.
   * @param patch - Partial brand profile fields.
   */
  const set = (patch: Partial<BrandProfile>): void => {
    setDraft((p) => ({ ...p, brand: { ...p.brand, ...patch } }));
  };

  /**
   * Merges a patch into the watermark draft.
   * @param patch - Partial watermark fields.
   */
  const setMark = (patch: Partial<WatermarkSettings>): void => {
    setDraft((p) => ({ ...p, watermark: { ...p.watermark, ...patch } }));
  };

  /**
   * Merges a patch into the schedules draft.
   * @param patch - Partial schedule fields.
   */
  const setSched = (patch: Partial<ScheduleSettings>): void => {
    setDraft((p) => ({ ...p, schedules: { ...p.schedules, ...patch } }));
  };

  return (
    <SettingsTabBody changed={form.changedPaths}>
      <SettingsWithPreview
        preview={
          <div className="mt-8 flex flex-col gap-4">
            <SocialPreview brand={brand} />
            <WatermarkPreview watermark={mark} />
          </div>
        }
      >
        <h3 className={cn("mt-4", ADMIN_EYEBROW_CLS)}>Brand profile</h3>
        <div className="divide-y divide-admin-border">
          {TEXT_FIELDS.map((key) => (
            <TextField
              key={key}
              id={`brand.${key}`}
              meta={m[`brand.${key}`]}
              value={brand[key]}
              multiline
              error={fieldErrors[`brand.${key}`]}
              customised={brand[key] !== base[key]}
              onChange={(v) => set({ [key]: v })}
            />
          ))}
          <FieldShell
            id="brand.hashtags"
            meta={m["brand.hashtags"]}
            error={tagsError}
            customised={brand.hashtags !== base.hashtags}
          >
            <AdminInput
              id="brand.hashtags"
              value={brand.hashtags}
              placeholder="#AucklandTech #ComputerHelp"
              onChange={(e) => set({ hashtags: e.target.value })}
              aria-invalid={tagsError ? true : undefined}
              className={cn(tagsError && "border-coquelicot-600 focus:border-coquelicot-600")}
            />
            {tags.length > 0 && (
              <p className="mt-1 text-sm text-admin-muted">Shows as: {formatHashtags(tags)}</p>
            )}
          </FieldShell>
        </div>

        <h3 className={cn("mt-6", ADMIN_EYEBROW_CLS)}>Write with AI defaults</h3>
        <div className="divide-y divide-admin-border">
          <FieldShell
            id="brand.hashtagsOn"
            meta={m["brand.hashtagsOn"]}
            error={fieldErrors["brand.hashtagsOn"]}
            customised={brand.hashtagsOn !== base.hashtagsOn}
          >
            <AdminSelect
              id="brand.hashtagsOn"
              value={brand.hashtagsOn}
              onChange={(e) => set({ hashtagsOn: e.target.value as HashtagsDefault })}
              className="sm:w-80"
            >
              {(Object.keys(HASHTAGS_DEFAULT_LABELS) as HashtagsDefault[]).map((key) => (
                <option key={key} value={key}>
                  {HASHTAGS_DEFAULT_LABELS[key]}
                </option>
              ))}
            </AdminSelect>
          </FieldShell>
          <ToggleField
            id="brand.emojiOn"
            meta={m["brand.emojiOn"]}
            value={brand.emojiOn}
            customised={brand.emojiOn !== base.emojiOn}
            onChange={(v) => set({ emojiOn: v })}
          />
        </div>

        <h3 className={cn("mt-6", ADMIN_EYEBROW_CLS)}>Your logo on photos</h3>
        <div className="divide-y divide-admin-border">
          <ToggleField
            id="watermark.on"
            meta={m["watermark.on"]}
            value={mark.on}
            customised={mark.on !== baseMark.on}
            onChange={(v) => setMark({ on: v })}
          />
          <FieldShell
            id="watermark.logo"
            meta={m["watermark.logo"]}
            error={fieldErrors["watermark.logo"]}
            customised={mark.logo !== baseMark.logo}
          >
            <AdminSelect
              id="watermark.logo"
              value={mark.logo}
              onChange={(e) => setMark({ logo: e.target.value as WatermarkLogo })}
              className="sm:w-80"
            >
              {(Object.keys(WATERMARK_LOGO_LABELS) as WatermarkLogo[]).map((key) => (
                <option key={key} value={key}>
                  {WATERMARK_LOGO_LABELS[key]}
                </option>
              ))}
            </AdminSelect>
          </FieldShell>
          <FieldShell
            id="watermark.corner"
            meta={m["watermark.corner"]}
            error={fieldErrors["watermark.corner"]}
            customised={mark.corner !== baseMark.corner}
          >
            <AdminSelect
              id="watermark.corner"
              value={mark.corner}
              onChange={(e) => setMark({ corner: e.target.value as WatermarkCorner })}
              className="sm:w-80"
            >
              {(Object.keys(WATERMARK_CORNER_LABELS) as WatermarkCorner[]).map((key) => (
                <option key={key} value={key}>
                  {WATERMARK_CORNER_LABELS[key]}
                </option>
              ))}
            </AdminSelect>
          </FieldShell>
          <NumberField
            id="watermark.size"
            meta={m["watermark.size"]}
            value={mark.size}
            min={WATERMARK_SIZE_RANGE.min}
            max={WATERMARK_SIZE_RANGE.max}
            step={1}
            error={fieldErrors["watermark.size"]}
            customised={mark.size !== baseMark.size}
            onChange={(v) => setMark({ size: v ?? baseMark.size })}
          />
          <NumberField
            id="watermark.opacity"
            meta={m["watermark.opacity"]}
            value={mark.opacity}
            min={WATERMARK_OPACITY_RANGE.min}
            max={WATERMARK_OPACITY_RANGE.max}
            step={5}
            error={fieldErrors["watermark.opacity"]}
            customised={mark.opacity !== baseMark.opacity}
            onChange={(v) => setMark({ opacity: v ?? baseMark.opacity })}
          />
        </div>

        <h3 className={cn("mt-6", ADMIN_EYEBROW_CLS)}>Schedules</h3>
        <div className="divide-y divide-admin-border">
          <NumberField
            id="schedules.fillDays"
            meta={m["schedules.fillDays"]}
            value={sched.fillDays}
            min={QUEUE_FILL_DAYS_RANGE.min}
            max={QUEUE_FILL_DAYS_RANGE.max}
            step={1}
            error={fieldErrors["schedules.fillDays"]}
            customised={sched.fillDays !== baseSched.fillDays}
            onChange={(v) => setSched({ fillDays: v ?? baseSched.fillDays })}
          />
          <FieldShell
            id="schedules.defaultMinute"
            meta={m["schedules.defaultMinute"]}
            error={fieldErrors["schedules.defaultMinute"]}
            customised={sched.defaultMinute !== baseSched.defaultMinute}
          >
            <AdminSelect
              id="schedules.defaultMinute"
              value={sched.defaultMinute}
              onChange={(e) => setSched({ defaultMinute: Number(e.target.value) })}
              className="sm:w-48"
            >
              {slotMinutes().map((min) => (
                <option key={min} value={min}>
                  {minuteLabel(min)}
                </option>
              ))}
            </AdminSelect>
          </FieldShell>
        </div>
      </SettingsWithPreview>

      <SettingsFooter form={form} />
      <SettingsHistory
        key={form.savedAt ?? 0}
        group="social"
        onRestore={(v: SocialSettings) => setDraft(v)}
      />
    </SettingsTabBody>
  );
}
