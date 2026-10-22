"use client";
// src/features/social/components/ScheduleEditor.tsx
// One schedule: name, colour, apps, weekly times, the order and gap it picks content by, and the
// content it takes turns through, beside what its next slots hold. Saving lines posts up
// straight away; Line up posts now and Line up again fill or redo it on demand.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminCheckbox } from "@/features/admin/components/ui/AdminCheckbox";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import { StickyActionBar } from "@/features/admin/components/ui/StickyActionBar";
import { StickyRail } from "@/features/admin/components/ui/StickyRail";
import { useToast } from "@/features/admin/components/ui/Toast";
import { useUnsavedChangesWarning } from "@/features/admin/hooks/use-unsaved-changes-warning";
import { callApi } from "@/features/mailing/lib/api-client";
import { ScheduleItems } from "@/features/social/components/ScheduleItems";
import { ScheduleUpcoming } from "@/features/social/components/ScheduleUpcoming";
import { SlotGrid } from "@/features/social/components/SlotGrid";
import { TagColourPicker } from "@/features/social/components/TagPicker";
import { SOCIAL_SCHEDULES_PATH } from "@/features/social/lib/links";
import {
  MAX_QUEUE_NAME,
  MIN_GAP_RANGE,
  QUEUE_ORDERS,
  QUEUE_ORDER_HINT,
  QUEUE_ORDER_LABEL,
  describeSlots,
} from "@/features/social/lib/queue-slots";
import {
  NEW_QUEUE,
  fillSummary,
  type FillSummaryInput,
  type QueueInput,
  type QueueRow,
} from "@/features/social/lib/queues";
import type { QueueEditorData } from "@/features/social/lib/queues.server";
import { PLATFORM_LABEL, SOCIAL_PLATFORMS } from "@/features/social/lib/validate";
import { cn } from "@/shared/lib/cn";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type React from "react";
import { useId, useState } from "react";
import { FaArrowLeft } from "react-icons/fa6";

/** Fields the editor saves; pausing saves on its own. */
type Draft = Omit<QueueInput, "paused">;

/** The confirm dialogs the editor can show. */
type Confirming = "apps" | "pause" | "redo" | "delete" | null;

/** A save or fill reply. */
interface Saved {
  schedule: QueueRow;
  cleared: number;
  fill: FillSummaryInput | null;
}

/**
 * The editable fields of a saved schedule.
 * @param row - The schedule.
 * @returns Its draft.
 */
function draftOf(row: QueueRow): Draft {
  return {
    name: row.name,
    colour: row.colour,
    platforms: row.platforms,
    slots: row.slots,
    order: row.order,
    minGapDays: row.minGapDays,
    itemIds: row.itemIds,
  };
}

/**
 * The fields that differ between two drafts, for a sparse save.
 * @param from - The saved draft.
 * @param to - The edited draft.
 * @returns Only the changed fields.
 */
function changedFields(from: Draft, to: Draft): Partial<Draft> {
  const out: Partial<Draft> = {};
  for (const key of Object.keys(to) as (keyof Draft)[]) {
    if (JSON.stringify(from[key]) !== JSON.stringify(to[key])) {
      (out as Record<string, unknown>)[key] = to[key];
    }
  }
  return out;
}

/**
 * Schedule editor.
 * @param props - Component props.
 * @param props.data - The schedule (null row for a new one), the content, and its next slots.
 * @param props.fillDays - How many days ahead schedules line posts up.
 * @param props.defaultMinute - The time a new slot starts at.
 * @returns Editor element.
 */
export function ScheduleEditor({
  data,
  fillDays,
  defaultMinute,
}: {
  data: QueueEditorData;
  fillDays: number;
  defaultMinute: number;
}): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const nameId = useId();
  const gapId = useId();
  const row = data.row;
  const [saved, setSaved] = useState<Draft>(() =>
    row
      ? draftOf(row)
      : {
          ...draftOf({ ...NEW_QUEUE, id: "" }),
          slots: [1, 3, 5].map((weekday) => ({ weekday, minute: defaultMinute })),
        },
  );
  const [draft, setDraft] = useState<Draft>(saved);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const changes = changedFields(saved, draft);
  const dirty = !row || Object.keys(changes).length > 0;
  const paused = row?.paused ?? false;
  useUnsavedChangesWarning(row !== null && dirty);

  /**
   * Changes part of the draft.
   * @param patch - The fields to change.
   */
  function edit(patch: Partial<Draft>): void {
    setDraft((d) => ({ ...d, ...patch }));
  }

  /**
   * Toasts what a save or fill did and reloads the page's data.
   * @param head - What happened.
   * @param res - The reply.
   * @param res.cleared - Lined-up posts taken off.
   * @param res.fill - The fill that followed.
   */
  function report(head: string, res: { cleared: number; fill: FillSummaryInput | null }): void {
    toast([head, fillSummary(res.cleared, res.fill)].join(" ").trim(), { tone: "success" });
    router.refresh();
  }

  /** Saves the draft, asking first when changing the apps would take off lined-up posts. */
  async function save(): Promise<void> {
    if (!draft.name.trim()) {
      toast("Give the schedule a name.", { tone: "error" });
      return;
    }
    if (row && changes.platforms && data.linedUp > 0 && confirming !== "apps") {
      setConfirming("apps");
      return;
    }
    setBusy("save");
    const res = row
      ? await callApi<Saved>(`/api/admin/social/schedules/${row.id}`, "PATCH", changes)
      : await callApi<Saved>("/api/admin/social/schedules", "POST", { ...draft });
    setBusy(null);
    setConfirming(null);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return;
    }
    const next = draftOf(res.schedule);
    setSaved(next);
    setDraft(next);
    if (!row) {
      toast(["Schedule made.", fillSummary(res.cleared, res.fill)].join(" ").trim(), {
        tone: "success",
      });
      router.replace(`${SOCIAL_SCHEDULES_PATH}/${res.schedule.id}`);
      return;
    }
    report("Saved.", res);
  }

  /**
   * Pauses or restarts the schedule.
   * @param to - Paused or running.
   */
  async function setPaused(to: boolean): Promise<void> {
    if (!row) return;
    setBusy("pause");
    const res = await callApi<Saved>(`/api/admin/social/schedules/${row.id}`, "PATCH", {
      paused: to,
    });
    setBusy(null);
    setConfirming(null);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return;
    }
    report(to ? "Paused." : "Running again.", res);
  }

  /**
   * Fills the empty slots now, or clears and picks again.
   * @param redo - Clear the lined-up posts first.
   */
  async function lineUp(redo: boolean): Promise<void> {
    if (!row) return;
    setBusy(redo ? "redo" : "fill");
    const res = await callApi<{ cleared: number; fill: FillSummaryInput }>(
      `/api/admin/social/schedules/${row.id}/fill`,
      "POST",
      { redo },
    );
    setBusy(null);
    setConfirming(null);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return;
    }
    if (!redo && res.fill.made === 0 && res.fill.queues.every((q) => q.empty === 0)) {
      toast(`Nothing new to line up: every time in the next ${fillDays} days has a post.`, {
        tone: "success",
      });
      router.refresh();
      return;
    }
    report(redo ? "Lined up again." : "Done.", res);
  }

  /** Deletes the schedule and goes back to the list. */
  async function remove(): Promise<void> {
    if (!row) return;
    setBusy("delete");
    const res = await callApi<{ cleared: number }>(
      `/api/admin/social/schedules/${row.id}`,
      "DELETE",
    );
    setBusy(null);
    if (!res.ok) {
      setConfirming(null);
      toast(res.error, { tone: "error" });
      return;
    }
    toast(
      res.cleared > 0
        ? `Deleted ${row.name} and its ${res.cleared === 1 ? "1 lined-up post" : `${res.cleared} lined-up posts`}.`
        : `Deleted ${row.name}.`,
      { tone: "success" },
    );
    router.push(SOCIAL_SCHEDULES_PATH);
  }

  const lined = data.linedUp === 1 ? "1 lined-up post" : `${data.linedUp} lined-up posts`;
  const working = busy !== null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Link
            href={SOCIAL_SCHEDULES_PATH}
            className="inline-flex w-fit items-center gap-1.5 text-sm text-admin-muted hover:text-admin-text"
          >
            <FaArrowLeft aria-hidden /> All schedules
          </Link>
          <h2 className="flex flex-wrap items-center gap-2 text-xl font-bold text-admin-text">
            <span className="wrap-break-word">{row ? row.name : "New schedule"}</span>
            {paused && <StatusPill tone="neutral">Paused</StatusPill>}
          </h2>
          {row && (
            <p className="text-admin-muted">
              {describeSlots(row.slots)}. {data.linedUp === 0 ? "Nothing lined up." : `${lined}.`}
            </p>
          )}
        </div>
        {row && (
          <div className="flex flex-wrap gap-2">
            {paused ? (
              <AdminButton
                variant="secondary"
                busy={busy === "pause"}
                disabled={working}
                onClick={() => void setPaused(false)}
              >
                Turn back on
              </AdminButton>
            ) : (
              <AdminButton
                variant="secondary"
                disabled={working}
                onClick={() => (data.linedUp > 0 ? setConfirming("pause") : void setPaused(true))}
              >
                Pause
              </AdminButton>
            )}
            {!paused && (
              <AdminButton
                variant="ghost"
                busy={busy === "redo"}
                disabled={working || dirty || data.linedUp === 0}
                title={dirty ? "Save your changes first" : undefined}
                onClick={() => setConfirming("redo")}
              >
                Line up again
              </AdminButton>
            )}
            <AdminButton
              variant="ghost"
              disabled={working}
              onClick={() => setConfirming("delete")}
              className="text-coquelicot-700"
            >
              Delete
            </AdminButton>
          </div>
        )}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <div className="flex flex-col gap-6">
            <section className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
              <AdminField label="Name" htmlFor={nameId} required>
                <AdminInput
                  id={nameId}
                  value={draft.name}
                  maxLength={MAX_QUEUE_NAME}
                  placeholder="Tech tips"
                  disabled={working}
                  onChange={(e) => edit({ name: e.target.value })}
                />
              </AdminField>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-semibold text-admin-text">Colour</span>
                <TagColourPicker
                  label="Schedule colour"
                  value={draft.colour}
                  disabled={working}
                  onChange={(colour) => edit({ colour })}
                />
              </div>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-base font-bold text-admin-text">Post to</h3>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {SOCIAL_PLATFORMS.map((p) => (
                  <AdminCheckbox
                    key={p}
                    label={PLATFORM_LABEL[p]}
                    checked={draft.platforms.includes(p)}
                    disabled={
                      working || (draft.platforms.length === 1 && draft.platforms.includes(p))
                    }
                    onChange={(on) =>
                      edit({
                        platforms: SOCIAL_PLATFORMS.filter((x) =>
                          x === p ? on : draft.platforms.includes(x),
                        ),
                      })
                    }
                  />
                ))}
              </div>
              <p className="text-sm text-admin-muted">
                Each post still only goes to the apps its content item is switched on for, so an
                item with no picture skips Instagram.
              </p>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-base font-bold text-admin-text">When</h3>
              <SlotGrid
                slots={draft.slots}
                onChange={(slots) => edit({ slots })}
                defaultMinute={defaultMinute}
                disabled={working}
              />
            </section>

            <section className="flex flex-col gap-3">
              <h3 className="text-base font-bold text-admin-text">What goes next</h3>
              <div role="radiogroup" aria-label="Order" className="flex flex-col gap-2">
                {QUEUE_ORDERS.map((o) => (
                  <label
                    key={o}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-lg border p-3",
                      draft.order === o
                        ? "border-russian-violet bg-russian-violet-50"
                        : "border-admin-border hover:bg-admin-bg",
                    )}
                  >
                    <input
                      type="radio"
                      name="queue-order"
                      value={o}
                      checked={draft.order === o}
                      disabled={working}
                      onChange={() => edit({ order: o })}
                      className="mt-1 size-4 shrink-0 accent-russian-violet"
                    />
                    <span>
                      <span className="block font-semibold text-admin-text">
                        {QUEUE_ORDER_LABEL[o]}
                      </span>
                      <span className="block text-sm text-admin-muted">{QUEUE_ORDER_HINT[o]}</span>
                    </span>
                  </label>
                ))}
              </div>
              <AdminField
                label="Don't repeat a post within"
                htmlFor={gapId}
                hint="Days between two postings of the same item, from any schedule or by hand. 0 lets it go out again as soon as its turn comes."
              >
                <div className="flex items-center gap-2">
                  <AdminInput
                    id={gapId}
                    type="number"
                    inputMode="numeric"
                    min={MIN_GAP_RANGE.min}
                    max={MIN_GAP_RANGE.max}
                    step={1}
                    value={draft.minGapDays}
                    disabled={working}
                    onChange={(e) => {
                      const n = Math.round(Number(e.target.value));
                      if (Number.isFinite(n)) {
                        edit({
                          minGapDays: Math.min(MIN_GAP_RANGE.max, Math.max(MIN_GAP_RANGE.min, n)),
                        });
                      }
                    }}
                    className="w-24"
                  />
                  <span className="text-admin-muted">days</span>
                </div>
              </AdminField>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-base font-bold text-admin-text">Content</h3>
              <ScheduleItems
                itemIds={draft.itemIds}
                onChange={(itemIds) => edit({ itemIds })}
                content={data.content}
                platforms={draft.platforms}
                numbered={draft.order === "in_order"}
                disabled={working}
              />
            </section>
          </div>

          <StickyActionBar stickOnPhone>
            <AdminButton
              busy={busy === "save"}
              disabled={working || !dirty}
              onClick={() => void save()}
            >
              {row ? "Save" : "Make schedule"}
            </AdminButton>
            {row && dirty && (
              <AdminButton variant="ghost" disabled={working} onClick={() => setDraft(saved)}>
                Undo changes
              </AdminButton>
            )}
            {row && !paused && !dirty && (
              <AdminButton
                variant="secondary"
                busy={busy === "fill"}
                disabled={working}
                onClick={() => void lineUp(false)}
              >
                Line up posts now
              </AdminButton>
            )}
            {/* Phones keep the bar to one row: only the unsaved note shows there. */}
            <span className={cn("text-sm text-admin-muted", !dirty && "max-sm:hidden")}>
              {!row
                ? `Posts are lined up ${fillDays} days ahead once it's made.`
                : dirty
                  ? "Unsaved changes."
                  : paused
                    ? "Paused: nothing is lined up."
                    : `Lines up posts ${fillDays} days ahead, topped up every hour.`}
            </span>
          </StickyActionBar>
        </Card>

        <StickyRail>
          <Card>
            <CardHeader
              title="Coming up"
              description={row ? "The next times and what goes out." : undefined}
            />
            {row ? (
              <ScheduleUpcoming slots={data.upcoming} dirty={dirty} />
            ) : (
              <p className="text-admin-muted">Make the schedule to see what goes out when.</p>
            )}
          </Card>
        </StickyRail>
      </div>

      <ConfirmDialog
        open={confirming === "apps"}
        title="Change the apps?"
        body={`The ${lined} are taken off and lined up again for the new apps. Posts you edited by hand stay.`}
        confirmLabel="Save"
        busy={busy === "save"}
        onConfirm={() => void save()}
        onCancel={() => setConfirming(null)}
      />
      <ConfirmDialog
        open={confirming === "pause"}
        title="Pause this schedule?"
        body={`The ${lined} are taken off. Posts you edited by hand stay. Turn it back on and it lines posts up again.`}
        confirmLabel="Pause"
        busy={busy === "pause"}
        onConfirm={() => void setPaused(true)}
        onCancel={() => setConfirming(null)}
      />
      <ConfirmDialog
        open={confirming === "redo"}
        title="Line up again?"
        body={`The ${lined} are taken off and picked again with the order and gap as they are now. Posts you edited by hand stay.`}
        confirmLabel="Line up again"
        busy={busy === "redo"}
        onConfirm={() => void lineUp(true)}
        onCancel={() => setConfirming(null)}
      />
      <ConfirmDialog
        open={confirming === "delete"}
        title={`Delete ${row?.name ?? "this schedule"}?`}
        body={
          data.linedUp > 0
            ? `Its ${lined} go too. Posts that already went out, and ones you edited by hand, stay.`
            : "Posts that already went out stay. This can't be undone."
        }
        confirmLabel="Delete"
        tone="danger"
        busy={busy === "delete"}
        onConfirm={() => void remove()}
        onCancel={() => setConfirming(null)}
      />
    </div>
  );
}
