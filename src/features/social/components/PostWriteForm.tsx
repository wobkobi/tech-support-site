"use client";
// src/features/social/components/PostWriteForm.tsx
// The composer's form card: name, linked promo, which apps it posts to, the post text with
// its Add menu and counter, the picture, the link and per-app text. The composer owns
// every value and handler; this file only lays them out.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { AdminTextarea } from "@/features/admin/components/ui/AdminTextarea";
import { Card } from "@/features/admin/components/ui/Card";
import { ADMIN_LABEL_CLS } from "@/features/admin/components/ui/field-classes";
import { InsertMenu, type InsertGroup } from "@/features/admin/components/ui/InsertMenu";
import { COMPACT_BUTTON_CLS } from "@/features/business/components/calculator/calculator-classes";
import type { PostContent } from "@/features/social/components/PostComposer";
import {
  PLATFORM_LABEL,
  SOCIAL_PLATFORMS,
  type SocialPlatformKey,
} from "@/features/social/lib/validate";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useId } from "react";
import { FaChevronDown } from "react-icons/fa6";

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
 * @param props.imageBusy - Whether a picture is uploading.
 * @param props.fileRef - Hidden file input behind the picture buttons.
 * @param props.onFile - Uploads a picked picture.
 * @param props.enabled - Apps the post goes to.
 * @param props.overridesOpen - Whether "Different text for one app" starts open.
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
  imageBusy,
  fileRef,
  onFile,
  enabled,
  overridesOpen,
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
  imageBusy: boolean;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onFile: (file: File) => void;
  enabled: SocialPlatformKey[];
  overridesOpen: boolean;
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
              <AdminButton
                size="xs"
                variant="ghost"
                className={COMPACT_BUTTON_CLS}
                busy={unlinking}
                onClick={onUnlink}
              >
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
          <span className={cn(ADMIN_LABEL_CLS, "mb-0")}>Picture</span>
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
                      className={COMPACT_BUTTON_CLS}
                      busy={imageBusy}
                      disabled={!canUpload}
                      onClick={() => fileRef.current?.click()}
                    >
                      Replace
                    </AdminButton>
                    <AdminButton
                      size="xs"
                      variant="ghost"
                      className={COMPACT_BUTTON_CLS}
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
              disabled={!canUpload || imageBusy}
              onClick={() => fileRef.current?.click()}
              className="flex h-20 items-center justify-center rounded-lg border border-dashed border-admin-border-strong text-sm font-semibold text-admin-muted transition-colors hover:border-russian-violet hover:text-russian-violet disabled:cursor-not-allowed disabled:opacity-60"
            >
              {imageBusy ? "Adding the picture..." : "+ Add a picture"}
            </button>
          ) : (
            <p className="text-sm text-admin-muted">No picture</p>
          )}
          {editable && !canUpload && (
            <p className="text-sm text-admin-muted">
              Picture uploads are off until BLOB_READ_WRITE_TOKEN is set.
            </p>
          )}
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
