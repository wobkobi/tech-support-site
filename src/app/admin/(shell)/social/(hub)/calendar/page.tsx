// src/app/admin/(shell)/social/(hub)/calendar/page.tsx
// Admin Social calendar tab: `?view=month|week|day|grid`, `?date=YYYY-MM-DD` and
// `?colour=status|schedule|app|tag`, each with a default when left out.

import { CalendarView } from "@/features/social/components/CalendarView";
import {
  atMinute,
  readColourMode,
  readDayKey,
  readView,
  viewDays,
} from "@/features/social/lib/calendar";
import {
  loadCalendarEntries,
  loadCalendarItems,
  loadCalendarSchedules,
  loadInstagramGrid,
} from "@/features/social/lib/calendar-data.server";
import { listTags } from "@/features/social/lib/tags.server";
import { requireAdminAuth } from "@/shared/lib/auth";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { addDaysToDateKey, nzDateKey } from "@/shared/lib/timezone-utils";
import type { Metadata } from "next";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Social calendar - Admin",
  robots: { index: false, follow: false },
};

/**
 * Admin Social calendar page.
 * @param props - Page props.
 * @param props.searchParams - `view`, `date` and `colour`.
 * @returns Calendar page element.
 */
export default async function AdminSocialCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string | string[];
    date?: string | string[];
    colour?: string | string[];
  }>;
}): Promise<React.ReactElement> {
  await requireAdminAuth();
  const params = await searchParams;
  const now = new Date();
  const today = nzDateKey(now);
  const view = readView(params.view);
  const dayKey = readDayKey(params.date, today);
  const colour = readColourMode(params.colour);
  const { from, to } = viewDays(view, dayKey);
  const { social } = await getSettings();

  const [entries, grid, items, schedules, tags] = await Promise.all([
    view === "grid"
      ? []
      : loadCalendarEntries(
          atMinute(from, 0),
          atMinute(addDaysToDateKey(to, 1), 0),
          now,
          social.schedules.fillDays,
        ),
    view === "grid" ? loadInstagramGrid() : [],
    loadCalendarItems(now),
    loadCalendarSchedules(),
    listTags(),
  ]);

  return (
    <CalendarView
      view={view}
      dayKey={dayKey}
      today={today}
      colour={colour}
      entries={entries}
      grid={grid}
      items={items}
      schedules={schedules}
      tags={tags}
      defaultMinute={social.schedules.defaultMinute}
      now={now.toISOString()}
    />
  );
}
