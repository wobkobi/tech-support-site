"use client";
// src/features/social/components/PostWriteForm.tsx
// The composer's form card: name, linked promo, which apps it posts to, the post text with
// its Add menu and counter, the picture, the link, Google's post type and button or offer
// details, and per-app text. The composer owns
// every value and handler; this file only lays them out.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { AdminSelect } from "@/features/admin/components/ui/AdminSelect";
import { AdminTextarea } from "@/features/admin/components/ui/AdminTextarea";
import { Card } from "@/features/admin/components/ui/Card";
import { ADMIN_LABEL_CLS } from "@/features/admin/components/ui/field-classes";
import { InsertMenu, type InsertGroup } from "@/features/admin/components/ui/InsertMenu";
import type { PostContent } from "@/features/social/components/PostComposer";
import type { PostDesign } from "@/features/social/lib/open-post";
import {
  PLATFORM_LABEL,
  SOCIAL_PLATFORMS,
  cropOf,
  pictureFor,
  type SocialPlatformKey,
} from "@/features/social/lib/validate";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useId } from "react";
import { FaChevronDown, FaPalette } from "react-icons/fa6";

/**
 * Form card for one post.
 * @param props - Component props.
 * @param props.content - Current field values.
 * @param props.setContent - Updates the field values.
 * @param props.setTarget - Updates one platform's toggle or own text.
 * @param props.editable - Whether the post can still be changed.
 * @param props.isPreset - Whether it's a preset (changes the name label).
 * @param props.promoId - Linked promo, if any.
 * @param props.promoTitle - Title of the linked promo, if any.
 * @param props.unlinking - Whether the promo unlink is running.
 * @param props.onUnlink - Detaches the promo.
 * @param props.insertGroups - What the Add menus offer.
 * @param props.insertAt - Inserts Add-menu text into the post or one app's text.
 * @param props.bodyRef - The post textarea, for inserting at the cursor.
 * @param props.overrideRefs - Each app's own-text textarea.
 * @param props.strictest - Lowest character limit among apps that post the main text.
 * @param props.canUpload - Whether image uploads are configured.
 * @param props.pictureBusy - Which picture is uploading: "main", a platform, or null.
 * @param props.fileRef - Hidden file input behind the picture buttons.
 * @param props.onPickPicture - Opens the file picker for the post's picture or one app's own.
 * @param props.onFile - Uploads a picked picture.
 * @param props.enabled - Apps the post goes to.
 * @param props.overridesOpen - Whether "Different text for one app" starts open.
 * @param props.design - Post maker design the picture came from, or null.
 * @param props.onDesign - Saves and opens the post maker for this post.
 * @returns Form card element.
 */
export function PostWriteForm({
  content,
  setContent,
  setTarget,
  editable,
  isPreset,
  promoId,
  promoTitle,
  unlinking,
  onUnlink,
  insertGroups,
  insertAt,
  bodyRef,
  overrideRefs,
  strictest,
  canUpload,
  pictureBusy,
  fileRef,
  onPickPicture,
  onFile,
  enabled,
  overridesOpen,
  design,
  onDesign,
}: {
  content: PostContent;
  setContent: React.Dispatch<React.SetStateAction<PostContent>>;
  setTarget: (platform: string, patch: Partial<PostContent["targets"][number]>) => void;
  editable: boolean;
  isPreset: boolean;
  promoId: string | null;
  promoTitle: string | null;
  unlinking: boolean;
  onUnlink: () => void;
  insertGroups: InsertGroup[];
  insertAt: (box: "body" | SocialPlatformKey, text: string, line?: boolean) => void;
  bodyRef: React.RefObject<HTMLTextAreaElement | null>;
  overrideRefs: React.RefObject<Partial<Record<SocialPlatformKey, HTMLTextAreaElement | null>>>;
  strictest: number | null;
  canUpload: boolean;
  pictureBusy: string | null;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onPickPicture: (forWhat: "main" | SocialPlatformKey) => void;
  onFile: (file: File) => void;
  enabled: SocialPlatformKey[];
  overridesOpen: boolean;
  design: PostDesign | null;
  onDesign: () => void;
}): React.ReactElement {
  const fieldId = useId();
  return (
    <Card>
      <div className="flex flex-col gap-5">
        <AdminField
          label={isPreset ? "Preset name" : "Name (only you see this)"}
          htmlFor={`${fieldId}-name`}
        >
          <AdminInput
            id={`${fieldId}-name`}
            value={content.name}
            onChange={(e) => setContent((c) => ({ ...c, name: e.target.value }))}
            disabled={!editable}
            maxLength={120}
          />
        </AdminField>

        {promoId && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-admin-border bg-admin-bg px-3 py-2 text-sm">
            <span>
              Promo wording comes from <strong>{promoTitle ?? "a promo"}</strong>. It won&apos;t
              post once that promo has ended.
            </span>
            {editable && (
              <AdminButton size="xs" variant="ghost" busy={unlinking} onClick={onUnlink}>
                Unlink
              </AdminButton>
            )}
          </div>
        )}

        <fieldset className="flex flex-col gap-2">
          <legend className={ADMIN_LABEL_CLS}>Post to</legend>
          <div className="flex flex-wrap gap-2">
            {SOCIAL_PLATFORMS.map((p) => {
              const target = content.targets.find((t) => t.platform === p);
              if (!target) return null;
              return (
                <label
                  key={p}
                  className={cn(
                    "inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors",
                    editable && "cursor-pointer",
                    target.enabled
                      ? "border-russian-violet bg-russian-violet/10 text-russian-violet"
                      : "border-admin-border-strong text-admin-muted hover:border-russian-violet/50",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={target.enabled}
                    disabled={!editable}
                    onChange={(e) => setTarget(p, { enabled: e.target.checked })}
                    className="size-4 accent-russian-violet"
                  />
                  {PLATFORM_LABEL[p]}
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="flex flex-col gap-1">
          <div className="flex items-end justify-between gap-2">
            <label htmlFor="post-body" className={ADMIN_LABEL_CLS}>
              Post
            </label>
            {editable && (
              <InsertMenu
                groups={insertGroups}
                onInsert={(text, line) => insertAt("body", text, line)}
                align="right"
              />
            )}
          </div>
          <AdminTextarea
            ref={bodyRef}
            id="post-body"
            value={content.body}
            onChange={(e) => setContent((c) => ({ ...c, body: e.target.value }))}
            disabled={!editable}
            rows={9}
            className="leading-relaxed"
          />
          <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm">
            <span className="text-admin-muted">
              Plain text: **bold** shows as typed. Add has links, contact details, symbols and promo
              wording.
            </span>
            <span
              className={cn(
                "ml-auto shrink-0 tabular-nums",
                strictest !== null && content.body.length > strictest
                  ? "text-red-700"
                  : "text-admin-muted",
              )}
            >
              {content.body.length.toLocaleString()}
              {strictest !== null && ` / ${strictest.toLocaleString()}`}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={cn(ADMIN_LABEL_CLS, "mb-0")}>Picture</span>
            {editable && !isPreset && (
              <AdminButton
                size="xs"
                variant="outline"
                onClick={onDesign}
                title="Make the picture in the post maker: every app gets its own size, so nothing is cut off"
              >
                <FaPalette aria-hidden className="size-3" />
                {design ? "Edit design" : "Design a picture"}
              </AdminButton>
            )}
          </div>
          {editable && design?.stale && (
            <div
              role="status"
              className="flex flex-wrap items-center gap-2 rounded-lg border border-mustard-400 bg-mustard-50 px-3 py-2 text-sm text-admin-text"
            >
              Pictures are out of date: this post doesn&apos;t show the design as it is now.
              <AdminButton size="xs" variant="outline" onClick={onDesign}>
                Update pictures
              </AdminButton>
            </div>
          )}
          {content.imageUrl ? (
            <div className="flex flex-col gap-3 rounded-lg border border-admin-border p-3 sm:flex-row sm:items-start">
              {/* Blob-hosted and already shrunk, so next/image would add nothing. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={content.imageUrl}
                alt={content.imageAlt}
                className="h-28 w-auto self-start rounded-md border border-admin-border"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <AdminField
                  label="Picture description (read out by screen readers)"
                  htmlFor={`${fieldId}-alt`}
                >
                  <AdminInput
                    id={`${fieldId}-alt`}
                    value={content.imageAlt}
                    onChange={(e) => setContent((c) => ({ ...c, imageAlt: e.target.value }))}
                    disabled={!editable}
                    maxLength={300}
                  />
                </AdminField>
                {editable && (
                  <div className="flex gap-2">
                    <AdminButton
                      size="xs"
                      variant="secondary"
                      busy={pictureBusy === "main"}
                      disabled={!canUpload}
                      onClick={() => onPickPicture("main")}
                    >
                      Replace
                    </AdminButton>
                    <AdminButton
                      size="xs"
                      variant="ghost"
                      onClick={() =>
                        setContent((c) => ({
                          ...c,
                          imageUrl: null,
                          imageWidth: null,
                          imageHeight: null,
                        }))
                      }
                    >
                      Remove
                    </AdminButton>
                  </div>
                )}
              </div>
            </div>
          ) : editable ? (
            <button
              type="button"
              disabled={!canUpload || pictureBusy !== null}
              onClick={() => onPickPicture("main")}
              className="flex h-20 items-center justify-center rounded-lg border border-dashed border-admin-border-strong text-sm font-semibold text-admin-muted transition-colors hover:border-russian-violet hover:text-russian-violet disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pictureBusy === "main" ? "Adding the picture..." : "+ Add a picture"}
            </button>
          ) : (
            <p className="text-sm text-admin-muted">No picture</p>
          )}
          {editable && !canUpload && (
            <p className="text-sm text-admin-muted">
              Picture uploads are off until BLOB_READ_WRITE_TOKEN is set.
            </p>
          )}
          {enabled.map((p) => (
            <AppPicture
              key={p}
              platform={p}
              content={content}
              setTarget={setTarget}
              editable={editable}
              canUpload={canUpload}
              busy={pictureBusy === p}
              onPick={() => onPickPicture(p)}
            />
          ))}
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile(file);
            }}
          />
        </div>

        <AdminField label="Link (optional)" htmlFor={`${fieldId}-link`}>
          <AdminInput
            id={`${fieldId}-link`}
            value={content.linkUrl}
            onChange={(e) => setContent((c) => ({ ...c, linkUrl: e.target.value }))}
            disabled={!editable}
            placeholder="https://"
            inputMode="url"
          />
        </AdminField>

        {enabled.includes("google") && (
          <fieldset className="flex flex-col gap-4 rounded-lg border border-admin-border px-3 py-3">
            <legend className="px-1 text-sm font-bold text-admin-text">Google options</legend>
            <div role="radiogroup" aria-label="Google post type" className="flex flex-wrap gap-2">
              {(
                [
                  ["STANDARD", "Update"],
                  ["OFFER", "Offer"],
                ] as const
              ).map(([type, label]) => {
                const checked =
                  type === "STANDARD"
                    ? content.googleType === "STANDARD"
                    : content.googleType !== "STANDARD";
                return (
                  <label
                    key={type}
                    className={cn(
                      "inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors",
                      editable && "cursor-pointer",
                      checked
                        ? "border-russian-violet bg-russian-violet/10 text-russian-violet"
                        : "border-admin-border-strong text-admin-muted hover:border-russian-violet/50",
                    )}
                  >
                    <input
                      type="radio"
                      name={`${fieldId}-google-type`}
                      checked={checked}
                      disabled={!editable}
                      onChange={() => setContent((c) => ({ ...c, googleType: type }))}
                      className="size-4 accent-russian-violet"
                    />
                    {label}
                  </label>
                );
              })}
            </div>

            {content.googleType === "STANDARD" ? (
              <AdminField label="Button" htmlFor={`${fieldId}-google-cta`}>
                <AdminSelect
                  id={`${fieldId}-google-cta`}
                  value={content.googleCta}
                  onChange={(e) =>
                    setContent((c) => ({
                      ...c,
                      googleCta: e.target.value as PostContent["googleCta"],
                    }))
                  }
                  disabled={!editable}
                >
                  <option value="">No button</option>
                  <option value="BOOK">Book (goes to the Link)</option>
                  <option value="CALL">Call now (rings your profile&apos;s number)</option>
                  <option value="LEARN_MORE">Learn more (goes to the Link)</option>
                </AdminSelect>
              </AdminField>
            ) : (
              <>
                <AdminField label="Offer title" htmlFor={`${fieldId}-google-title`}>
                  <AdminInput
                    id={`${fieldId}-google-title`}
                    value={content.googleTitle}
                    onChange={(e) => setContent((c) => ({ ...c, googleTitle: e.target.value }))}
                    disabled={!editable}
                    maxLength={100}
                  />
                </AdminField>
                <div className="grid gap-4 sm:grid-cols-2">
                  <AdminField label="Starts" htmlFor={`${fieldId}-offer-start`}>
                    <AdminInput
                      id={`${fieldId}-offer-start`}
                      type="date"
                      value={content.offerStart}
                      onChange={(e) => setContent((c) => ({ ...c, offerStart: e.target.value }))}
                      disabled={!editable}
                    />
                  </AdminField>
                  <AdminField label="Last day" htmlFor={`${fieldId}-offer-end`}>
                    <AdminInput
                      id={`${fieldId}-offer-end`}
                      type="date"
                      value={content.offerEnd}
                      onChange={(e) => setContent((c) => ({ ...c, offerEnd: e.target.value }))}
                      disabled={!editable}
                    />
                  </AdminField>
                </div>
                <AdminField label="Coupon code (optional)" htmlFor={`${fieldId}-coupon`}>
                  <AdminInput
                    id={`${fieldId}-coupon`}
                    value={content.couponCode}
                    onChange={(e) => setContent((c) => ({ ...c, couponCode: e.target.value }))}
                    disabled={!editable}
                    maxLength={50}
                  />
                </AdminField>
                <p className="text-sm text-admin-muted">
                  The Link above becomes the offer&apos;s &quot;Redeem online&quot; link.
                </p>
              </>
            )}
          </fieldset>
        )}

        {enabled.length > 0 && (
          <details className="group rounded-lg border border-admin-border" open={overridesOpen}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-bold text-admin-text">
              Different text for one app
              <FaChevronDown
                aria-hidden
                className="size-3 text-admin-muted transition-[rotate] group-open:rotate-180"
              />
            </summary>
            <div className="flex flex-col gap-4 border-t border-admin-border px-3 py-3">
              <p className="text-sm text-admin-muted">Leave a box empty to use the post above.</p>
              {enabled.map((p) => {
                const target = content.targets.find((t) => t.platform === p);
                if (!target) return null;
                return (
                  <div key={p} className="flex flex-col gap-1">
                    <div className="flex items-end justify-between gap-2">
                      <label htmlFor={`override-${p}`} className={ADMIN_LABEL_CLS}>
                        {PLATFORM_LABEL[p]}
                      </label>
                      {editable && (
                        <InsertMenu
                          groups={insertGroups}
                          onInsert={(text, line) => insertAt(p, text, line)}
                          align="right"
                        />
                      )}
                    </div>
                    <AdminTextarea
                      ref={(el) => {
                        overrideRefs.current[p] = el;
                      }}
                      id={`override-${p}`}
                      value={target.textOverride}
                      onChange={(e) => setTarget(p, { textOverride: e.target.value })}
                      disabled={!editable}
                      rows={5}
                      className="leading-relaxed"
                    />
                  </div>
                );
              })}
            </div>
          </details>
        )}
      </div>
    </Card>
  );
}

// The shape each app shows whole, for the cut-off notes.
const FIT_WORDS: Record<SocialPlatformKey, string> = {
  facebook: "between 4:5 portrait and 1.91:1 landscape",
  instagram: "between 4:5 portrait and 1.91:1 landscape",
  google: "at 4:3 landscape, like 1200 x 900",
};

/**
 * One app's picture row under Picture. Shows the app's own picture when it has one,
 * and, when the picture it would get doesn't fit its shape, why and what to do: add a
 * picture for that app, or OK the cut (Facebook and Google only; Instagram refuses the
 * shape outright). Renders nothing while the post's picture fits the app.
 * @param props - Component props.
 * @param props.platform - The app.
 * @param props.content - Current field values.
 * @param props.setTarget - Updates the app's picture or crop OK.
 * @param props.editable - Whether the post can still be changed.
 * @param props.canUpload - Whether image uploads are configured.
 * @param props.busy - Whether this app's picture is uploading.
 * @param props.onPick - Opens the file picker for this app's picture.
 * @returns Row element, or null.
 */
function AppPicture({
  platform,
  content,
  setTarget,
  editable,
  canUpload,
  busy,
  onPick,
}: {
  platform: SocialPlatformKey;
  content: PostContent;
  setTarget: (platform: string, patch: Partial<PostContent["targets"][number]>) => void;
  editable: boolean;
  canUpload: boolean;
  busy: boolean;
  onPick: () => void;
}): React.ReactElement | null {
  const fieldId = useId();
  const target = content.targets.find((t) => t.platform === platform);
  const picture = pictureFor(content, platform);
  if (!target || !picture) return null;
  const label = PLATFORM_LABEL[platform];
  const cut =
    picture.width && picture.height ? cropOf(platform, picture.width, picture.height) : null;
  const approved = cut !== null && target.cropApprovedFor === picture.url;
  if (!target.imageUrl && !cut) return null;

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border p-3",
        cut && !approved ? "border-amber-300 bg-amber-50" : "border-admin-border",
      )}
    >
      {target.imageUrl && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={target.imageUrl}
            alt={target.imageAlt}
            className="h-20 w-auto self-start rounded-md border border-admin-border"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <AdminField label={`${label}'s own picture: description`} htmlFor={`${fieldId}-alt`}>
              <AdminInput
                id={`${fieldId}-alt`}
                value={target.imageAlt}
                onChange={(e) => setTarget(platform, { imageAlt: e.target.value })}
                disabled={!editable}
                maxLength={300}
              />
            </AdminField>
            {editable && (
              <div className="flex flex-wrap gap-2">
                <AdminButton
                  size="xs"
                  variant="secondary"
                  busy={busy}
                  disabled={!canUpload}
                  onClick={onPick}
                >
                  Replace
                </AdminButton>
                <AdminButton
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    setTarget(platform, {
                      imageUrl: null,
                      imageAlt: "",
                      imageWidth: null,
                      imageHeight: null,
                    })
                  }
                >
                  Use the main picture
                </AdminButton>
              </div>
            )}
          </div>
        </div>
      )}

      {cut && (
        <>
          <p className="text-sm text-admin-text">
            {platform === "instagram" ? (
              <>
                Instagram only takes pictures {FIT_WORDS.instagram}, so it won&apos;t take this one.
              </>
            ) : approved ? (
              <>
                You&apos;ve OK&apos;d {label} cutting off the {cut} of this picture.
              </>
            ) : (
              <>
                {label} shows pictures {FIT_WORDS[platform]}, so it would cut off the {cut} of this
                one. Check its preview, then add a picture for {label} or OK the cut.
              </>
            )}
          </p>
          {editable && (
            <div className="flex flex-wrap gap-2">
              <AdminButton
                size="xs"
                variant="secondary"
                busy={busy}
                disabled={!canUpload}
                onClick={onPick}
              >
                {target.imageUrl ? `Replace ${label}'s picture` : `Add a picture for ${label}`}
              </AdminButton>
              {platform !== "instagram" &&
                (approved ? (
                  <AdminButton
                    size="xs"
                    variant="ghost"
                    onClick={() => setTarget(platform, { cropApprovedFor: null })}
                  >
                    Undo the OK
                  </AdminButton>
                ) : (
                  <AdminButton
                    size="xs"
                    variant="ghost"
                    onClick={() => setTarget(platform, { cropApprovedFor: picture.url })}
                  >
                    OK, cut it off
                  </AdminButton>
                ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
