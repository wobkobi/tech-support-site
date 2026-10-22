"use client";
// src/features/social/components/PostWriteForm.tsx
// The composer's form card. The composer owns every value and handler; this only lays them out.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminCheckbox } from "@/features/admin/components/ui/AdminCheckbox";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { AdminSelect } from "@/features/admin/components/ui/AdminSelect";
import { AdminTextarea } from "@/features/admin/components/ui/AdminTextarea";
import { Card } from "@/features/admin/components/ui/Card";
import { ADMIN_LABEL_CLS } from "@/features/admin/components/ui/field-classes";
import { InsertMenu, type InsertGroup } from "@/features/admin/components/ui/InsertMenu";
import { isRenderUrl } from "@/features/social-design/lib/pictures";
import type { PostContent } from "@/features/social/components/PostComposer";
import { TagPicker } from "@/features/social/components/TagPicker";
import type { PostDesign } from "@/features/social/lib/open-post";
import type { SocialTagRow, TagColour } from "@/features/social/lib/tags";
import {
  GOOGLE_CTA_LABEL,
  PLATFORM_LABEL,
  SOCIAL_PLATFORMS,
  charCount,
  cropOf,
  pictureFor,
  type GooglePostCta,
  type GooglePostType,
  type SocialPlatformKey,
} from "@/features/social/lib/validate";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useId } from "react";
import { FaArrowRotateLeft, FaChevronDown, FaPalette, FaWandMagicSparkles } from "react-icons/fa6";

/** Google's post kinds, as the radio buttons name them. */
const GOOGLE_KINDS: readonly [GooglePostType, string][] = [
  ["STANDARD", "Update"],
  ["OFFER", "Offer"],
  ["EVENT", "Event"],
];

/** Google's buttons in the order the menu lists them; Call now can't go on an event. */
const GOOGLE_BUTTONS: readonly GooglePostCta[] = [
  "BOOK",
  "ORDER",
  "SHOP",
  "LEARN_MORE",
  "SIGN_UP",
  "CALL",
];

/** The times an event gets when All day is unticked. */
const EVENT_DEFAULT_TIMES = { start: "09:00", end: "17:00" } as const;

/**
 * Whether a picture is a photo that Add my logo can mark, rather than a Post maker picture.
 * @param url - Picture address.
 * @returns True for an uploaded photo.
 */
function takesLogo(url: string): boolean {
  return !isRenderUrl(url);
}

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
 * @param props.overridesOpen - Whether "Different text for one app" is open.
 * @param props.onOverridesOpen - Called when it's opened or closed by hand.
 * @param props.design - Post maker design the picture came from, or null.
 * @param props.onDesign - Saves and opens the post maker for this post.
 * @param props.onWriteWithAi - Opens Write with AI; null when no AI key is set.
 * @param props.onUndoAi - Takes back Write with AI's last change; null when there's none to undo.
 * @param props.onLogo - Adds the logo to a photo or takes it off.
 * @param props.tags - Every tag there is.
 * @param props.tagIds - Ids of the post's tags.
 * @param props.onTagsChange - Saves the post's new tags.
 * @param props.onCreateTag - Adds a tag from the picker.
 * @param props.captions - A content item's caption switcher, shown above the words.
 * @param props.bodyLabel - The words box's label.
 * @param props.overridesHint - What an empty app box falls back to.
 * @param props.overridesNote - Shown instead of "Different text for one app" when it doesn't apply.
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
  onOverridesOpen,
  design,
  onDesign,
  onWriteWithAi,
  onUndoAi,
  onLogo,
  tags,
  tagIds,
  onTagsChange,
  onCreateTag,
  captions,
  bodyLabel = "Post",
  overridesHint = "Leave a box empty to use the post above.",
  overridesNote = null,
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
  onOverridesOpen: (open: boolean) => void;
  design: PostDesign | null;
  onDesign: () => void;
  onWriteWithAi: (() => void) | null;
  onUndoAi: (() => void) | null;
  onLogo: (forWhat: "main" | SocialPlatformKey, on: boolean) => void;
  tags: SocialTagRow[];
  tagIds: string[];
  onTagsChange: (ids: string[]) => void;
  onCreateTag: (name: string, colour: TagColour) => Promise<SocialTagRow | null>;
  captions?: React.ReactNode;
  bodyLabel?: string;
  overridesHint?: string;
  overridesNote?: string | null;
}): React.ReactElement {
  const fieldId = useId();
  const bodyCount = charCount(content.body);
  const event = content.googleType === "EVENT";
  const allDay = !content.eventStartTime && !content.eventEndTime;
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

        <TagPicker tags={tags} value={tagIds} onChange={onTagsChange} onCreate={onCreateTag} />

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
          {captions && <div className="mb-2">{captions}</div>}
          <div className="flex items-end justify-between gap-2">
            <label htmlFor="post-body" className={ADMIN_LABEL_CLS}>
              {bodyLabel}
            </label>
            {editable && (
              <div className="flex items-center gap-2">
                {onWriteWithAi && (
                  <AdminButton size="xs" variant="secondary" onClick={onWriteWithAi}>
                    <FaWandMagicSparkles aria-hidden /> Write with AI
                  </AdminButton>
                )}
                <InsertMenu
                  groups={insertGroups}
                  onInsert={(text, line) => insertAt("body", text, line)}
                  align="right"
                />
              </div>
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
            {onUndoAi ? (
              <AdminButton size="xs" variant="ghost" onClick={onUndoAi}>
                <FaArrowRotateLeft aria-hidden /> Undo Write with AI
              </AdminButton>
            ) : (
              <span className="text-admin-muted">
                Plain text: **bold** shows as typed. Emoji count as two, as the apps count them. Add
                has links, contact details, symbols and promo wording.
              </span>
            )}
            <span
              className={cn(
                "ml-auto shrink-0 tabular-nums",
                strictest !== null && bodyCount > strictest ? "text-red-700" : "text-admin-muted",
              )}
            >
              {bodyCount.toLocaleString()}
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
                  <div className="flex flex-wrap items-center gap-2">
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
                          imageOriginalUrl: null,
                          imageWidth: null,
                          imageHeight: null,
                        }))
                      }
                    >
                      Remove
                    </AdminButton>
                    {takesLogo(content.imageUrl) && (
                      <AdminCheckbox
                        checked={content.imageOriginalUrl !== null}
                        onChange={(on) => onLogo("main", on)}
                        label="Add my logo"
                        disabled={pictureBusy !== null || (!canUpload && !content.imageOriginalUrl)}
                        className="ml-1"
                      />
                    )}
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
              anyBusy={pictureBusy !== null}
              onPick={() => onPickPicture(p)}
              onLogo={(on) => onLogo(p, on)}
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
              {GOOGLE_KINDS.map(([type, label]) => {
                const checked = content.googleType === type;
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
                      onChange={() =>
                        setContent((c) => ({
                          ...c,
                          googleType: type,
                          // Call now can't go on an event.
                          googleCta: type === "EVENT" && c.googleCta === "CALL" ? "" : c.googleCta,
                        }))
                      }
                      className="size-4 accent-russian-violet"
                    />
                    {label}
                  </label>
                );
              })}
            </div>

            {content.googleType !== "STANDARD" && (
              <>
                <AdminField
                  label={event ? "Event title" : "Offer title"}
                  htmlFor={`${fieldId}-google-title`}
                >
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
                  <AdminField label={event ? "Ends" : "Last day"} htmlFor={`${fieldId}-offer-end`}>
                    <AdminInput
                      id={`${fieldId}-offer-end`}
                      type="date"
                      value={content.offerEnd}
                      onChange={(e) => setContent((c) => ({ ...c, offerEnd: e.target.value }))}
                      disabled={!editable}
                    />
                  </AdminField>
                </div>
              </>
            )}

            {event && (
              <>
                <AdminCheckbox
                  checked={allDay}
                  onChange={(on) =>
                    setContent((c) => ({
                      ...c,
                      eventStartTime: on ? "" : EVENT_DEFAULT_TIMES.start,
                      eventEndTime: on ? "" : EVENT_DEFAULT_TIMES.end,
                    }))
                  }
                  label="All day"
                  disabled={!editable}
                />
                {!allDay && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <AdminField label="Starts at" htmlFor={`${fieldId}-event-start-time`}>
                      <AdminInput
                        id={`${fieldId}-event-start-time`}
                        type="time"
                        step={300}
                        value={content.eventStartTime}
                        onChange={(e) =>
                          setContent((c) => ({ ...c, eventStartTime: e.target.value }))
                        }
                        disabled={!editable}
                      />
                    </AdminField>
                    <AdminField label="Ends at" htmlFor={`${fieldId}-event-end-time`}>
                      <AdminInput
                        id={`${fieldId}-event-end-time`}
                        type="time"
                        step={300}
                        value={content.eventEndTime}
                        onChange={(e) =>
                          setContent((c) => ({ ...c, eventEndTime: e.target.value }))
                        }
                        disabled={!editable}
                      />
                    </AdminField>
                  </div>
                )}
                <p className="text-sm text-admin-muted">
                  New Zealand time. On a multi-day event the start time is on the first day and the
                  end time on the last.
                </p>
              </>
            )}

            {content.googleType === "OFFER" && (
              <>
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

            {content.googleType !== "OFFER" && (
              <>
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
                    {GOOGLE_BUTTONS.filter((b) => !(event && b === "CALL")).map((b) => (
                      <option key={b} value={b}>
                        {b === "CALL"
                          ? `${GOOGLE_CTA_LABEL[b]} (rings your profile's number)`
                          : GOOGLE_CTA_LABEL[b]}
                      </option>
                    ))}
                  </AdminSelect>
                </AdminField>
                {content.googleCta !== "" && content.googleCta !== "CALL" && (
                  <AdminField
                    label="Google button link (optional)"
                    htmlFor={`${fieldId}-google-url`}
                  >
                    <AdminInput
                      id={`${fieldId}-google-url`}
                      value={content.googleUrl}
                      onChange={(e) => setContent((c) => ({ ...c, googleUrl: e.target.value }))}
                      disabled={!editable}
                      placeholder="Leave empty to use the Link above"
                      inputMode="url"
                    />
                  </AdminField>
                )}
              </>
            )}
          </fieldset>
        )}

        {enabled.length > 0 && overridesNote && (
          <p className="rounded-lg border border-admin-border px-3 py-2.5 text-sm text-admin-muted">
            {overridesNote}
          </p>
        )}
        {enabled.length > 0 && !overridesNote && (
          <details
            className="group rounded-lg border border-admin-border"
            open={overridesOpen}
            onToggle={(e) => onOverridesOpen(e.currentTarget.open)}
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-bold text-admin-text">
              Different text for one app
              <FaChevronDown
                aria-hidden
                className="size-3 text-admin-muted transition-[rotate] group-open:rotate-180"
              />
            </summary>
            <div className="flex flex-col gap-4 border-t border-admin-border px-3 py-3">
              <p className="text-sm text-admin-muted">{overridesHint}</p>
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
 * One app's picture row: its own picture, or why the shared picture doesn't fit and what to do
 * (add one, or OK the cut on Facebook and Google). Renders nothing when it fits.
 * @param props - Component props.
 * @param props.platform - The app.
 * @param props.content - Current field values.
 * @param props.setTarget - Updates the app's picture or crop OK.
 * @param props.editable - Whether the post can still be changed.
 * @param props.canUpload - Whether image uploads are configured.
 * @param props.busy - Whether this app's picture is uploading.
 * @param props.anyBusy - Whether any picture is uploading.
 * @param props.onPick - Opens the file picker for this app's picture.
 * @param props.onLogo - Adds the logo to this app's own photo or takes it off.
 * @returns Row element, or null.
 */
function AppPicture({
  platform,
  content,
  setTarget,
  editable,
  canUpload,
  busy,
  anyBusy,
  onPick,
  onLogo,
}: {
  platform: SocialPlatformKey;
  content: PostContent;
  setTarget: (platform: string, patch: Partial<PostContent["targets"][number]>) => void;
  editable: boolean;
  canUpload: boolean;
  busy: boolean;
  anyBusy: boolean;
  onPick: () => void;
  onLogo: (on: boolean) => void;
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
              <div className="flex flex-wrap items-center gap-2">
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
                      imageOriginalUrl: null,
                    })
                  }
                >
                  Use the main picture
                </AdminButton>
                {takesLogo(target.imageUrl) && (
                  <AdminCheckbox
                    checked={target.imageOriginalUrl !== null}
                    onChange={onLogo}
                    label="Add my logo"
                    disabled={anyBusy || (!canUpload && !target.imageOriginalUrl)}
                    className="ml-1"
                  />
                )}
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
