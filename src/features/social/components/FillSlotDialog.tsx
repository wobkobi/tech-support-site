"use client";
// src/features/social/components/FillSlotDialog.tsx
// Fill this time: picks the content item (and caption) for a schedule's open time, making the
// posting the schedule would have made, on the schedule's apps.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminSelect } from "@/features/admin/components/ui/AdminSelect";
import { Modal } from "@/features/admin/components/ui/Modal";
import { useToast } from "@/features/admin/components/ui/Toast";
import { callApi } from "@/features/mailing/lib/api-client";
import type { CalendarEntry, CalendarItem, CalendarSchedule } from "@/features/social/lib/calendar";
import { SOCIAL_CONTENT_PATH } from "@/features/social/lib/links";
import { clampCaption } from "@/features/social/lib/postings-core";
import { PLATFORM_LABEL } from "@/features/social/lib/validate";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import Link from "next/link";
import type React from "react";
import { useId, useState } from "react";

/** How long a caption's preview runs in the picker. */
const SNIPPET = 60;

/**
 * Fill this time dialog.
 * @param props - Component props.
 * @param props.entry - The open time.
 * @param props.items - Every content item.
 * @param props.schedule - The schedule it belongs to.
 * @param props.onDone - Called once the posting is made.
 * @param props.onClose - Dismisses it.
 * @returns The dialog.
 */
export function FillSlotDialog({
  entry,
  items,
  schedule,
  onDone,
  onClose,
}: {
  entry: CalendarEntry;
  items: CalendarItem[];
  schedule: CalendarSchedule | undefined;
  onDone: () => void;
  onClose: () => void;
}): React.ReactElement {
  const { toast } = useToast();
  const id = useId();
  const usable = items.filter((i) => !i.spent);
  // The schedule's own items first, in its order, then everything else A to Z.
  const ownIds = schedule?.itemIds ?? [];
  const own = ownIds.flatMap((itemId) => usable.filter((i) => i.id === itemId));
  const others = usable.filter((i) => !ownIds.includes(i.id));
  const [itemId, setItemId] = useState(own[0]?.id ?? others[0]?.id ?? "");
  const item = usable.find((i) => i.id === itemId);
  const [caption, setCaption] = useState(item?.next ?? 0);
  const [busy, setBusy] = useState(false);
  const choices = (item?.captions ?? []).flatMap((text, i) =>
    text.trim() ? [{ i, text: text.trim() }] : [],
  );

  /**
   * Switches item, starting on its next caption.
   * @param next - The item's id.
   */
  function pickItem(next: string): void {
    setItemId(next);
    const picked = usable.find((i) => i.id === next);
    setCaption(picked ? clampCaption(picked.captions, picked.next) : 0);
  }

  /** Makes the posting in the schedule's time. */
  async function submit(): Promise<void> {
    if (!item) return;
    setBusy(true);
    const res = await callApi(`/api/admin/social/content/${item.id}/postings`, "POST", {
      when: entry.at,
      captionIndex: caption,
      queueId: entry.queueId,
    });
    setBusy(false);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return;
    }
    toast(`${item.name} is lined up for ${formatDateTimeShort(entry.at)}.`, { tone: "success" });
    onDone();
  }

  /**
   * One item's option.
   * @param i - The item.
   * @returns The option.
   */
  const option = (i: CalendarItem): React.ReactElement => (
    <option key={i.id} value={i.id}>
      {i.name}
    </option>
  );

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title="Fill this time"
      description={`${schedule?.name ?? entry.name}, ${formatDateTimeShort(entry.at)}, on ${entry.platforms
        .map((p) => PLATFORM_LABEL[p])
        .join(", ")}.`}
      footer={
        <>
          <AdminButton variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </AdminButton>
          <AdminButton
            busy={busy}
            disabled={!item || choices.length === 0}
            onClick={() => void submit()}
          >
            Line it up
          </AdminButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {entry.later && (
          <p className="text-sm text-admin-text-secondary">
            The schedule fills this time on its own nearer the day. Fill it now to choose what goes
            out.
          </p>
        )}
        {usable.length === 0 ? (
          <p className="text-sm text-admin-text-secondary">
            There&apos;s no content that can go out. Add some in{" "}
            <Link
              href={SOCIAL_CONTENT_PATH}
              className="font-semibold text-russian-violet underline"
            >
              Content
            </Link>
            .
          </p>
        ) : (
          <AdminField label="Content" htmlFor={`${id}-item`}>
            <AdminSelect
              id={`${id}-item`}
              value={itemId}
              onChange={(e) => pickItem(e.target.value)}
            >
              {own.length > 0 && others.length > 0 ? (
                <>
                  <optgroup label="In this schedule">{own.map(option)}</optgroup>
                  <optgroup label="Other content">{others.map(option)}</optgroup>
                </>
              ) : (
                [...own, ...others].map(option)
              )}
            </AdminSelect>
          </AdminField>
        )}
        {item && choices.length > 1 && (
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
                  {`Caption ${i + 1}${i === item.next ? " (next in turn)" : ""}: ${
                    text.length > SNIPPET ? `${text.slice(0, SNIPPET).trimEnd()}...` : text
                  }`}
                </option>
              ))}
            </AdminSelect>
          </AdminField>
        )}
        {item && choices.length === 0 && (
          <p className="text-sm text-admin-muted">This item has no caption yet.</p>
        )}
      </div>
    </Modal>
  );
}
