"use client";
// src/features/social-design/components/PicturesPanel.tsx
// The Pictures dialog: whether the stored pictures match the design, Update pictures
// (with a retry per failed size), downloads of any size as JPEG or PNG at 1x or 2x,
// the paid-ad switch, the words that go into the post, and Use in post.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { ADMIN_INPUT_CLS } from "@/features/admin/components/ui/field-classes";
import { Modal } from "@/features/admin/components/ui/Modal";
import { useToast } from "@/features/admin/components/ui/Toast";
import { downloadBlob, type PictureType } from "@/features/social-design/components/canvas/export";
import { Check, Segmented } from "@/features/social-design/components/editor-fields";
import type { Pictures } from "@/features/social-design/components/use-pictures";
import type { DesignDoc } from "@/features/social-design/lib/doc";
import { FORMATS, type FormatKey } from "@/features/social-design/lib/formats";
import { autoAltText, pictureFileName } from "@/features/social-design/lib/pictures";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useId, useState } from "react";
import { FaDownload, FaRotate } from "react-icons/fa6";

const TYPES: Record<"jpg" | "png", PictureType> = { jpg: "image/jpeg", png: "image/png" };

/**
 * Why Use in post can't run, or null when it can.
 * @param doc - Design.
 * @param canUpload - Whether Blob uploads are set up.
 * @param isTemplate - Whether the design is a template.
 * @returns Reason, or null.
 */
function useBlocker(doc: DesignDoc, canUpload: boolean, isTemplate: boolean): string | null {
  if (isTemplate) return "Templates don't go into posts. Start a design from this one first.";
  if (!canUpload) {
    return "Pictures can't be stored until Blob uploads are set up (BLOB_READ_WRITE_TOKEN). Downloads still work.";
  }
  if (!doc.formats.includes("feed-4x5")) {
    return "Add the 4:5 size first: it's the picture Facebook and Instagram use.";
  }
  return null;
}

/**
 * The Pictures dialog.
 * @param props - Component props.
 * @param props.open - Whether it's showing.
 * @param props.onClose - Closes it.
 * @param props.doc - Design as shown.
 * @param props.current - Reads the latest design, for downloads.
 * @param props.name - Design name, for file names.
 * @param props.pictures - Stored pictures and their actions.
 * @param props.canUpload - Whether Blob uploads are set up.
 * @param props.isTemplate - Whether the design is a template.
 * @param props.using - Whether Use in post is running.
 * @param props.onUse - Hands the pictures to a post.
 * @param props.onDoc - Changes the caption, picture description or paid-ad switch.
 * @returns Dialog element.
 */
export function PicturesPanel({
  open,
  onClose,
  doc,
  current,
  name,
  pictures,
  canUpload,
  isTemplate,
  using,
  onUse,
  onDoc,
}: {
  open: boolean;
  onClose: () => void;
  doc: DesignDoc;
  current: () => DesignDoc;
  name: string;
  pictures: Pictures;
  canUpload: boolean;
  isTemplate: boolean;
  using: boolean;
  onUse: () => void;
  onDoc: (change: Partial<Pick<DesignDoc, "caption" | "altText" | "paidAd">>, tag: string) => void;
}): React.ReactElement | null {
  const { toast } = useToast();
  const id = useId();
  const [ext, setExt] = useState<"jpg" | "png">("jpg");
  const [scale, setScale] = useState<"1" | "2">(doc.paidAd ? "2" : "1");
  const [downloading, setDownloading] = useState<FormatKey | "all" | null>(null);
  const { state, renders, progress, failed } = pictures;
  const blocker = useBlocker(doc, canUpload, isTemplate);
  const busy = progress !== null;

  /**
   * Draws and downloads sizes one after another, straight from the design: nothing is
   * stored, so this works with uploads off.
   * @param formats - Sizes to download.
   * @param which - What the busy spinner shows on.
   */
  async function download(formats: FormatKey[], which: FormatKey | "all"): Promise<void> {
    setDownloading(which);
    const snapshot = current();
    const n = Number(scale);
    try {
      for (const f of formats) {
        const blob = await pictures.exportPicture({
          doc: snapshot,
          format: f,
          scale: n,
          type: TYPES[ext],
        });
        downloadBlob(blob, pictureFileName(name, f, n, ext));
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't draw the picture.", {
        tone: "error",
      });
    } finally {
      setDownloading(null);
    }
  }

  /**
   * Redraws and stores the out-of-date sizes.
   * @param only - Just these sizes, for a retry.
   */
  async function update(only?: FormatKey[]): Promise<void> {
    const ok = await pictures.update(only);
    if (ok) toast("Pictures updated.");
  }

  const statusLine =
    state.status === "none"
      ? "No pictures stored yet. Update pictures draws every size and stores it, ready for a post."
      : state.status === "current"
        ? "Pictures are up to date."
        : `Pictures are out of date: ${state.outdated.map((f) => FORMATS[f].label).join(", ")}.`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Pictures"
      description="Every size drawn at its exact pixel size."
      size="lg"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {blocker && <p className="mr-auto text-sm text-admin-text-secondary">{blocker}</p>}
          <AdminButton variant="outline" onClick={onClose}>
            Close
          </AdminButton>
          <AdminButton
            busy={using}
            disabled={blocker !== null || busy}
            onClick={onUse}
            title="Store any out-of-date pictures, then put the 4:5 picture on Facebook and Instagram and the 4:3 one on Google. Updates the linked draft, or starts a new one."
          >
            Use in post
          </AdminButton>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <section
          aria-label="Stored pictures"
          className={cn(
            "flex flex-col gap-2 rounded-lg border px-3 py-2.5",
            state.status === "stale"
              ? "border-mustard-400 bg-mustard-50"
              : "border-admin-border bg-admin-bg",
          )}
        >
          <div className="flex flex-wrap items-center gap-3">
            <p role="status" className="text-sm text-admin-text">
              {busy
                ? `Drawing ${FORMATS[progress.format].label} (${progress.step} of ${progress.total})...`
                : statusLine}
            </p>
            {state.status !== "current" && (
              <AdminButton
                size="xs"
                className="ml-auto"
                busy={busy}
                disabled={!canUpload || isTemplate}
                onClick={() => void update()}
              >
                <FaRotate aria-hidden className="size-3" /> Update pictures
              </AdminButton>
            )}
          </div>
          {failed.map((f) => (
            <div
              key={f.format}
              className="flex flex-wrap items-center gap-2 text-sm text-coquelicot-700"
            >
              {FORMATS[f.format].label} wasn&apos;t stored: {f.error}
              <AdminButton
                size="xs"
                variant="outline"
                disabled={busy}
                onClick={() => void update([f.format])}
              >
                Try {FORMATS[f.format].label} again
              </AdminButton>
            </div>
          ))}
        </section>

        <section aria-labelledby={`${id}-sizes`} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-4">
            <h3 id={`${id}-sizes`} className="mr-auto text-sm font-semibold text-admin-text">
              Download
            </h3>
            <Segmented
              label="File"
              value={ext}
              onChange={setExt}
              options={[
                { value: "jpg", label: "JPEG" },
                { value: "png", label: "PNG", title: "Sharper words; bigger file" },
              ]}
            />
            <Segmented
              label="Size"
              value={scale}
              onChange={setScale}
              options={[
                { value: "1", label: "1x" },
                { value: "2", label: "2x", title: "Twice the pixels, for paid ads" },
              ]}
            />
            <AdminButton
              variant="outline"
              busy={downloading === "all"}
              disabled={downloading !== null}
              onClick={() => void download(doc.formats, "all")}
            >
              <FaDownload aria-hidden className="size-3" /> Download all
            </AdminButton>
          </div>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {doc.formats.map((f) => {
              const render = renders.find((r) => r.format === f);
              const outOfDate = state.outdated.includes(f);
              const n = Number(scale);
              return (
                <li
                  key={f}
                  className="flex flex-col gap-1.5 rounded-md border border-admin-border bg-admin-surface p-2"
                >
                  <div className="flex h-28 items-center justify-center overflow-hidden rounded bg-seasalt-200/60">
                    {render ? (
                      // eslint-disable-next-line @next/next/no-img-element -- stored Blob picture shown small; next/image adds nothing here.
                      <img
                        src={render.url}
                        alt=""
                        className={cn("max-h-full max-w-full", outOfDate && "opacity-50")}
                      />
                    ) : (
                      <span className="text-sm text-admin-muted">Not stored yet</span>
                    )}
                  </div>
                  <p className="text-sm font-semibold text-admin-text">{FORMATS[f].label}</p>
                  <p className="text-sm text-admin-muted">
                    {FORMATS[f].width * n} × {FORMATS[f].height * n}
                    {render && outOfDate && " - out of date"}
                  </p>
                  <AdminButton
                    size="xs"
                    variant="outline"
                    busy={downloading === f}
                    disabled={downloading !== null}
                    onClick={() => void download([f], f)}
                  >
                    <FaDownload aria-hidden className="size-3" /> Download
                  </AdminButton>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby={`${id}-ad`} className="flex flex-col gap-1">
          <h3 id={`${id}-ad`} className="text-sm font-semibold text-admin-text">
            Paid ad
          </h3>
          <Check
            label="This is a paid ad"
            checked={doc.paidAd}
            onChange={(on) => {
              onDoc({ paidAd: on }, "paid-ad");
              setScale(on ? "2" : "1");
            }}
          />
          <p className="text-sm text-admin-text-secondary">
            Leaves contact details off the pictures (the ad&apos;s own button does that job) and
            downloads at 2x.
          </p>
        </section>

        <section aria-labelledby={`${id}-post`} className="flex flex-col gap-3">
          <h3 id={`${id}-post`} className="text-sm font-semibold text-admin-text">
            For the post
          </h3>
          <label className="flex flex-col gap-1 text-sm text-admin-text">
            Post words
            <textarea
              value={doc.caption}
              maxLength={2200}
              rows={4}
              onChange={(e) => onDoc({ caption: e.target.value }, "caption")}
              className={ADMIN_INPUT_CLS}
            />
            <span className="text-admin-text-secondary">
              Go into the post only when it has no words yet.
            </span>
          </label>
          <label className="flex flex-col gap-1 text-sm text-admin-text">
            Picture description
            <textarea
              value={doc.altText}
              maxLength={300}
              rows={2}
              placeholder={autoAltText(doc) || "Say what the picture shows."}
              onChange={(e) => onDoc({ altText: e.target.value }, "alt-text")}
              className={ADMIN_INPUT_CLS}
            />
            <span className="text-admin-text-secondary">
              Read out by screen readers. Left empty, the headline and short line are used.
            </span>
          </label>
        </section>
      </div>
    </Modal>
  );
}
