"use client";
// src/features/social/components/ContentSchedules.tsx
// The schedules a content item is in, ticked on its page. Saving lines its postings up in the
// ticked ones straight away and takes it, with its lined-up postings, out of the rest.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Card } from "@/features/admin/components/ui/Card";
import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import { useToast } from "@/features/admin/components/ui/Toast";
import { callApi } from "@/features/mailing/lib/api-client";
import { SOCIAL_SCHEDULES_PATH } from "@/features/social/lib/links";
import { fillSummary, type FillSummaryInput, type ItemQueue } from "@/features/social/lib/queues";
import { TAG_COLOURS } from "@/features/social/lib/tags";
import { cn } from "@/shared/lib/cn";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";

/**
 * Schedules card.
 * @param props - Component props.
 * @param props.itemId - The content item.
 * @param props.schedules - Every schedule, marking the ones it's in.
 * @param props.recycle - Whether the item recycles, which decides if schedules post it again.
 * @returns Card element.
 */
export function ContentSchedules({
  itemId,
  schedules,
  recycle,
}: {
  itemId: string;
  schedules: ItemQueue[];
  recycle: boolean;
}): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const saved = schedules.filter((s) => s.member).map((s) => s.id);
  const savedKey = saved.join();
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set(saved));
  // Start again from the saved ticks when a refresh brings new ones.
  const [shownKey, setShownKey] = useState(savedKey);
  if (savedKey !== shownKey) {
    setShownKey(savedKey);
    setTicked(new Set(saved));
  }
  const [busy, setBusy] = useState(false);
  const changed = schedules.some((s) => s.member !== ticked.has(s.id));

  /**
   * Ticks or unticks one schedule.
   * @param id - The schedule.
   * @param on - Ticked or not.
   */
  function tick(id: string, on: boolean): void {
    setTicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /** Saves the ticks and reports what changed in the lined-up posts. */
  async function save(): Promise<void> {
    setBusy(true);
    const res = await callApi<{
      added: number;
      removed: number;
      cleared: number;
      fill: FillSummaryInput | null;
    }>(`/api/admin/social/content/${itemId}/schedules`, "PUT", { queueIds: [...ticked] });
    setBusy(false);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return;
    }
    toast(["Schedules saved.", fillSummary(res.cleared, res.fill)].join(" ").trim(), {
      tone: "success",
    });
    router.refresh();
  }

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div>
          <h3 className="text-base font-bold text-admin-text">Schedules</h3>
          <p className="text-sm text-admin-muted">
            {recycle
              ? "Schedules post it for you at set times, taking turns with their other content."
              : "Schedules post it for you at set times. With recycling off, they post it once."}
          </p>
        </div>
        {schedules.length === 0 ? (
          <p className="text-admin-muted">
            No schedules yet.{" "}
            <Link
              href={`${SOCIAL_SCHEDULES_PATH}/new`}
              className="font-semibold text-russian-violet-700 underline underline-offset-2"
            >
              Make one
            </Link>{" "}
            to post your content on set days and times.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {schedules.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2">
                <label className="flex min-w-0 items-center gap-2 text-admin-text">
                  <input
                    type="checkbox"
                    checked={ticked.has(s.id)}
                    onChange={(e) => tick(s.id, e.target.checked)}
                    disabled={busy}
                    className="size-4 shrink-0 accent-russian-violet"
                  />
                  <span
                    aria-hidden
                    className={cn("size-2.5 shrink-0 rounded-full", TAG_COLOURS[s.colour].dot)}
                  />
                  <span className="truncate">{s.name}</span>
                </label>
                {s.paused && <StatusPill tone="neutral">Paused</StatusPill>}
                <Link
                  href={`${SOCIAL_SCHEDULES_PATH}/${s.id}`}
                  className="ml-auto font-semibold text-russian-violet underline-offset-2 hover:underline"
                >
                  Open
                </Link>
              </li>
            ))}
          </ul>
        )}
        {changed && (
          <div className="flex flex-wrap items-center gap-2">
            <AdminButton size="sm" busy={busy} onClick={() => void save()}>
              Save schedules
            </AdminButton>
            <AdminButton
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setTicked(new Set(saved))}
            >
              Undo
            </AdminButton>
          </div>
        )}
      </div>
    </Card>
  );
}
