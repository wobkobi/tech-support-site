"use client";
// src/features/admin/components/settings/SocialPreview.tsx
// Live sample post for the social settings: how the brand hashtags and Write with AI's
// starting choices come out, using the same default rule the composer's dialog uses.

import { Card } from "@/features/admin/components/ui/Card";
import { ADMIN_EYEBROW_CLS } from "@/features/admin/components/ui/field-classes";
import { hashtagsOnByDefault } from "@/features/social/lib/caption-ai";
import type { SocialPlatformKey } from "@/features/social/lib/validate";
import { formatHashtags, MAX_BRAND_HASHTAGS, parseHashtags } from "@/shared/lib/hashtags";
import type { BrandProfile } from "@/shared/lib/settings/types";
import type React from "react";

/** Made-up words for the sample; the writer's own come from the brief. */
const SAMPLE_WORDS =
  "Fake parcel texts are going round again. If one asks for a small fee to release a parcel, don't tap the link: check the courier's own app instead.";
/** Tags the writer might add after the brand ones for this sample. */
const SAMPLE_TAGS = ["ScamAlert", "TechTips"];

/** Where a post can go, and whether its Hashtags tickbox starts ticked there. */
const CASES: { label: string; platforms: SocialPlatformKey[] }[] = [
  { label: "Facebook only", platforms: ["facebook"] },
  { label: "Going to Instagram", platforms: ["facebook", "instagram"] },
  { label: "Google only", platforms: ["google"] },
];

/**
 * Sample post for the current brand profile draft.
 * @param props - Component props.
 * @param props.brand - The brand profile being edited.
 * @returns Preview element.
 */
export function SocialPreview({ brand }: { brand: BrandProfile }): React.ReactElement {
  const own = parseHashtags(brand.hashtags).tags;
  const extra = SAMPLE_TAGS.filter((t) => !own.some((o) => o.toLowerCase() === t.toLowerCase()));
  const line = formatHashtags([...own, ...extra].slice(0, MAX_BRAND_HASHTAGS));
  const withTags = hashtagsOnByDefault(brand.hashtagsOn, ["facebook", "instagram"]);

  return (
    <Card className="bg-admin-bg">
      <h3 className={ADMIN_EYEBROW_CLS}>Sample post</h3>
      <p className="mt-1 text-sm text-admin-muted">
        A post for Facebook and Instagram as Write with AI starts it. The words are made up; yours
        come from what you ask for.
      </p>
      <div className="mt-3 rounded-lg border border-admin-border bg-admin-surface p-3 text-base text-admin-text">
        <p>
          {SAMPLE_WORDS}
          {brand.emojiOn && " 📦"}
        </p>
        {withTags && <p className="mt-3 font-semibold text-moonstone-700">{line}</p>}
      </div>
      <h4 className="mt-4 text-sm font-semibold text-admin-text">Hashtags tickbox starts</h4>
      <dl className="mt-1 divide-y divide-admin-border text-sm">
        {CASES.map(({ label, platforms }) => (
          <div key={label} className="flex justify-between gap-3 py-1.5">
            <dt className="text-admin-text-secondary">{label}</dt>
            <dd className="font-semibold text-admin-text">
              {hashtagsOnByDefault(brand.hashtagsOn, platforms) ? "Ticked" : "Not ticked"}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
