"use client";
// src/features/social/components/SocialChecklist.tsx
// The Overview's set-up list: what's left to get Social running, each step with a link to do it
// and a Skip for the ones you don't need. The Overview hides it once everything left is done.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import type { Checklist, ChecklistKey } from "@/features/social/lib/checklist";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useState } from "react";
import { FaCircleCheck, FaRegCircle } from "react-icons/fa6";

/**
 * Set-up list.
 * @param props - Component props.
 * @param props.list - The steps and counts.
 * @param props.busyKey - The step whose Skip or Put back is saving.
 * @param props.onSkip - Skips a step, or puts it back.
 * @returns Card element.
 */
export function SocialChecklist({
  list,
  busyKey,
  onSkip,
}: {
  list: Checklist;
  busyKey: ChecklistKey | null;
  onSkip: (key: ChecklistKey, skip: boolean) => void;
}): React.ReactElement {
  const [showSkipped, setShowSkipped] = useState(false);
  const shown = list.steps.filter((s) => !s.skipped);
  const skipped = list.steps.filter((s) => s.skipped);
  const percent = list.total === 0 ? 100 : Math.round((list.done / list.total) * 100);

  return (
    <Card>
      <CardHeader
        title="Get Social set up"
        description={`${list.done} of ${list.total} done`}
        actions={
          skipped.length > 0 ? (
            <AdminButton size="xs" variant="ghost" onClick={() => setShowSkipped((v) => !v)}>
              {showSkipped ? "Hide skipped" : `Skipped (${skipped.length})`}
            </AdminButton>
          ) : undefined
        }
      />
      <div
        role="progressbar"
        aria-label="Set-up done"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="mb-4 h-2 overflow-hidden rounded-full bg-admin-bg"
      >
        <div className="h-full rounded-full bg-moonstone-600" style={{ width: `${percent}%` }} />
      </div>
      <ul className="grid gap-3 md:grid-cols-2">
        {shown.map((s) => (
          <li
            key={s.key}
            className={cn(
              "flex items-start gap-3 rounded-md border border-admin-border p-3",
              s.done && "bg-admin-bg",
            )}
          >
            {s.done ? (
              <FaCircleCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-moonstone-600" />
            ) : (
              <FaRegCircle aria-hidden className="mt-0.5 size-5 shrink-0 text-admin-muted" />
            )}
            <div className="min-w-0 flex-1">
              <p className={cn("font-semibold", s.done ? "text-admin-muted" : "text-admin-text")}>
                <span className="sr-only">{s.done ? "Done: " : "To do: "}</span>
                {s.title}
              </p>
              {!s.done && (
                <>
                  <p className="mt-0.5 text-sm text-admin-muted">{s.detail}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <AdminButton size="xs" variant="outline" href={s.href}>
                      {s.action}
                    </AdminButton>
                    <AdminButton
                      size="xs"
                      variant="ghost"
                      busy={busyKey === s.key}
                      onClick={() => onSkip(s.key, true)}
                    >
                      Skip
                    </AdminButton>
                  </div>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {showSkipped && skipped.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2 border-t border-admin-border pt-4">
          {skipped.map((s) => (
            <li key={s.key} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-admin-muted">{s.title}</span>
              <AdminButton
                size="xs"
                variant="secondary"
                busy={busyKey === s.key}
                onClick={() => onSkip(s.key, false)}
              >
                Put back
              </AdminButton>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
