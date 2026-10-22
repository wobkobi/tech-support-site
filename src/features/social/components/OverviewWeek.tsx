"use client";
// src/features/social/components/OverviewWeek.tsx
// The Overview's next seven days, today first: each day's posts and open schedule times, with
// links through to the calendar. An open time opens its day there, where Fill this time is.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import { CalendarChip } from "@/features/social/components/CalendarChip";
import {
  entriesByDay,
  shortDay,
  type CalendarEntry,
  type ColourContext,
} from "@/features/social/lib/calendar";
import { calendarHref } from "@/features/social/lib/links";
import { addDaysToDateKey } from "@/shared/lib/timezone-utils";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type React from "react";

/**
 * Next seven days.
 * @param props - Component props.
 * @param props.today - Today's key.
 * @param props.entries - Posts and open times over the seven days.
 * @param props.ctx - Schedule and tag names, for the chips' details.
 * @returns Card element.
 */
export function OverviewWeek({
  today,
  entries,
  ctx,
}: {
  today: string;
  entries: CalendarEntry[];
  ctx: ColourContext;
}): React.ReactElement {
  const router = useRouter();
  const byDay = entriesByDay(entries);
  const days = Array.from({ length: 7 }, (_, i) => addDaysToDateKey(today, i));

  /**
   * The calendar's day view for a day.
   * @param key - The day.
   * @returns Its address.
   */
  const dayHref = (key: string): string =>
    calendarHref({ view: "day", date: key, colour: "status" });

  return (
    <Card>
      <CardHeader
        title="The next 7 days"
        actions={
          <AdminButton
            size="xs"
            variant="outline"
            href={calendarHref({ view: "week", colour: "status" })}
          >
            Open the calendar
          </AdminButton>
        }
      />
      <ol className="flex flex-col gap-3 lg:grid lg:grid-cols-7 lg:gap-2">
        {days.map((key, i) => {
          const list = byDay.get(key) ?? [];
          return (
            <li
              key={key}
              className="flex min-w-0 gap-3 border-b border-admin-border pb-3 last:border-b-0 last:pb-0 lg:flex-col lg:gap-1.5 lg:border-b-0 lg:pb-0"
            >
              <Link
                href={dayHref(key)}
                className="w-20 shrink-0 text-sm font-semibold text-admin-text no-underline hover:underline lg:w-auto"
              >
                {i === 0 ? "Today" : i === 1 ? "Tomorrow" : shortDay(key)}
              </Link>
              {list.length === 0 ? (
                <p className="text-sm text-admin-muted">Nothing yet</p>
              ) : (
                <ul className="flex min-w-0 flex-1 flex-col gap-1">
                  {list.map((e) => (
                    <li key={e.id} className="min-w-0">
                      <CalendarChip
                        entry={e}
                        mode="status"
                        ctx={ctx}
                        onOpenSlot={() => router.push(dayHref(key))}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
