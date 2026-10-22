"use client";
// src/features/social/components/PostingDialog.tsx
// Sends a content item out once: a posting made now or at a set time, with the caption picked.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { AdminSelect } from "@/features/admin/components/ui/AdminSelect";
import { Modal } from "@/features/admin/components/ui/Modal";
import { useToast } from "@/features/admin/components/ui/Toast";
import { callApi } from "@/features/mailing/lib/api-client";
import type { SocialPostRow, SocialTargetRow } from "@/features/social/lib/post-row";
import { PLATFORM_LABEL } from "@/features/social/lib/validate";
import { cn } from "@/shared/lib/cn";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import { fromNzInputValue, toNzInputValue } from "@/shared/lib/timezone-utils";
import type React from "react";
import { useId, useState } from "react";

/** How long a caption's preview runs in the picker. */
const SNIPPET = 60;

/**
 * The time the dialog starts on: the one asked for while it's still ahead, else the top of the
 * next hour.
 * @param wanted - ISO time asked for, if any.
 * @returns A datetime-local value in NZ time.
 */
function startTime(wanted: string | undefined): string {
  if (wanted && Date.parse(wanted) > Date.now() + 60_000) return toNzInputValue(new Date(wanted));
  const at = new Date(Date.now() + 60 * 60_000);
  at.setMinutes(0, 0, 0);
  return toNzInputValue(at);
}

/**
 * A summary of where a posting went when it was posted straight away.
 * @param targets - Its targets after posting.
 * @returns The toast text and tone.
 */
function postedSummary(targets: SocialTargetRow[]): {
  text: string;
  tone: "success" | "warning" | "error";
} {
  const live = targets.filter((t) => t.enabled && t.status !== "skipped");
  /**
   * A target's app name.
   * @param t - Target.
   * @returns Display name.
   */
  const label = (t: SocialTargetRow): string => PLATFORM_LABEL[t.platform] ?? t.platform;
  const posted = live.filter((t) => t.status === "posted").map(label);
  const failed = live.filter((t) => t.status === "failed").map(label);
  const waiting = live.filter((t) => t.status === "pending").map(label);
  const parts = [
    posted.length > 0 && `Posted to ${posted.join(" and ")}`,
    failed.length > 0 && `${failed.join(" and ")} failed - open the posting below to see why`,
    waiting.length > 0 && `${waiting.join(" and ")} is still processing and will finish shortly`,
  ].filter(Boolean);
  return {
    text: `${parts.join("; ")}.`,
    tone: failed.length > 0 ? (posted.length > 0 ? "warning" : "error") : "success",
  };
}

/**
 * Posting dialog.
 * @param props - Component props.
 * @param props.itemId - The content item.
 * @param props.captions - Its captions in order.
 * @param props.next - The caption next in turn.
 * @param props.start - Whether it opened from Post now or Schedule a posting.
 * @param props.at - ISO time to start the date and time on, such as the day it was dropped on.
 * @param props.beforeSubmit - Saves pending edits first; false stops the posting. Left out when
 * there's nothing to save.
 * @param props.onDone - Called with the posting once it's made.
 * @param props.onClose - Dismisses it.
 * @returns The dialog.
 */
export function PostingDialog({
  itemId,
  captions,
  next,
  start,
  at: startAt,
  beforeSubmit,
  onDone,
  onClose,
}: {
  itemId: string;
  captions: string[];
  next: number;
  start: "now" | "later";
  at?: string;
  beforeSubmit?: () => Promise<boolean>;
  onDone: (posting: SocialPostRow) => void;
  onClose: () => void;
}): React.ReactElement {
  const { toast } = useToast();
  const id = useId();
  const [when, setWhen] = useState(start);
  const [at, setAt] = useState(() => startTime(startAt));
  const [caption, setCaption] = useState(next);
  const [busy, setBusy] = useState(false);
  const choices = captions.flatMap((text, i) => (text.trim() ? [{ i, text: text.trim() }] : []));

  /** Saves, then makes the posting and reports how it went. */
  async function submit(): Promise<void> {
    let scheduledAt: Date | null = null;
    if (when === "later") {
      try {
        scheduledAt = fromNzInputValue(at);
      } catch {
        toast("Pick a date and time.", { tone: "error" });
        return;
      }
    }
    setBusy(true);
    if (beforeSubmit && !(await beforeSubmit())) {
      setBusy(false);
      return;
    }
    const res = await callApi<{
      posting: SocialPostRow;
      status?: string;
      targets?: SocialTargetRow[];
    }>(`/api/admin/social/content/${itemId}/postings`, "POST", {
      when: scheduledAt ? scheduledAt.toISOString() : "now",
      captionIndex: caption,
    });
    setBusy(false);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return;
    }
    if (res.targets) {
      const { text, tone } = postedSummary(res.targets);
      toast(text, { tone });
    } else {
      toast(
        `Posting scheduled for ${formatDateTimeShort(res.posting.scheduledAt ?? scheduledAt!.toISOString())}.`,
        { tone: "success" },
      );
    }
    onDone(res.posting);
  }

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title="Post this content"
      description="This makes a posting: a copy that goes out with the caption you pick. The content item stays as it is."
      footer={
        <>
          <AdminButton variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </AdminButton>
          <AdminButton busy={busy} disabled={choices.length === 0} onClick={() => void submit()}>
            {when === "now" ? "Post now" : "Schedule it"}
          </AdminButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold text-admin-text">When</legend>
          {(
            [
              {
                key: "now",
                label: "Post it now",
                hint: "It goes straight to every app it's on for.",
              },
              { key: "later", label: "At a set time", hint: "New Zealand time." },
            ] as const
          ).map((c) => (
            <label
              key={c.key}
              className={cn(
                "flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm",
                when === c.key
                  ? "border-russian-violet bg-admin-bg"
                  : "border-admin-border-strong bg-admin-surface",
              )}
            >
              <input
                type="radio"
                name={`${id}-when`}
                checked={when === c.key}
                onChange={() => setWhen(c.key)}
                className="mt-0.5 size-4 accent-russian-violet"
              />
              <span>
                <span className="block font-bold text-admin-text">{c.label}</span>
                <span className="text-admin-muted">{c.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {when === "later" && (
          <AdminField label="Date and time" htmlFor={`${id}-at`}>
            <AdminInput
              id={`${id}-at`}
              type="datetime-local"
              value={at}
              onChange={(e) => setAt(e.target.value)}
            />
          </AdminField>
        )}
        {choices.length > 1 ? (
          <AdminField
            label="Caption"
            htmlFor={`${id}-caption`}
            hint="Each posting takes the next caption unless you pick another."
          >
            <AdminSelect
              id={`${id}-caption`}
              value={caption}
              onChange={(e) => setCaption(Number(e.target.value))}
            >
              {choices.map(({ i, text }) => (
                <option key={i} value={i}>
                  {`Caption ${i + 1}${i === next ? " (next in turn)" : ""}: ${
                    text.length > SNIPPET ? `${text.slice(0, SNIPPET).trimEnd()}...` : text
                  }`}
                </option>
              ))}
            </AdminSelect>
          </AdminField>
        ) : choices.length === 0 ? (
          <p className="text-sm text-admin-muted">Write a caption first.</p>
        ) : null}
      </div>
    </Modal>
  );
}
