"use client";
// src/features/admin/components/settings/SocialTab.tsx
// Editor for the social group: the brand profile every AI writer reads, and the defaults
// for Write with AI's hashtag and emoji choices, beside a sample post.

import {
  FieldShell,
  SettingsTabBody,
  TextField,
  ToggleField,
} from "@/features/admin/components/settings/SettingsFields";
import { SettingsFooter } from "@/features/admin/components/settings/SettingsFooter";
import { SettingsHistory } from "@/features/admin/components/settings/SettingsHistory";
import { SettingsWithPreview } from "@/features/admin/components/settings/SettingsWithPreview";
import { SocialPreview } from "@/features/admin/components/settings/SocialPreview";
import { useSettingsForm } from "@/features/admin/components/settings/useSettingsForm";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { AdminSelect } from "@/features/admin/components/ui/AdminSelect";
import { ADMIN_EYEBROW_CLS } from "@/features/admin/components/ui/field-classes";
import { cn } from "@/shared/lib/cn";
import { formatHashtags, parseHashtags } from "@/shared/lib/hashtags";
import { HASHTAGS_DEFAULT_LABELS, SOCIAL_FIELD_META } from "@/shared/lib/settings/field-meta";
import type { BrandProfile, HashtagsDefault, SocialSettings } from "@/shared/lib/settings/types";
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

  return (
    <SettingsTabBody changed={form.changedPaths}>
      <SettingsWithPreview preview={<SocialPreview brand={brand} />}>
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
      </SettingsWithPreview>

      <SettingsFooter form={form} />
      <SettingsHistory group="social" onRestore={(v: SocialSettings) => setDraft(v)} />
    </SettingsTabBody>
  );
}
