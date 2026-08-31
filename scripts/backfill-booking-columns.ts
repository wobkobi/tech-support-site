// scripts/backfill-booking-columns.ts
// Fills the meetingType and duration columns on bookings that only ever stated
// those values inside their notes text: every manual booking created before the
// admin route started writing the columns, plus any row predating them.
// Reads and writes the live database, so it needs .env.local.
// Run with: npm run backfill:booking-columns:dry      (writes nothing)
//           npm run backfill:booking-columns:apply    (writes)
//
// Two scripts rather than one plus a flag: PowerShell 5.1 strips a bare `--`
// before npm sees it, so a dry run would read exactly like a successful apply.

import { meetingTypeFromNotes } from "@/features/booking/lib/booking";
import { prisma } from "@/shared/lib/prisma";
import { resolveSettings, SETTINGS_KEY_PREFIX } from "@/shared/lib/settings/get-settings";
import type { SettingsGroup } from "@/shared/lib/settings/types";

const apply = process.argv.slice(2).includes("--apply");

/**
 * Resolves the short-job length without the unstable_cache wrapper: getSettings
 * needs a Next request context and throws "incrementalCache missing" outside the
 * server. Merges through the exported pure resolveSettings, as the eval harness
 * does, so the settings merge stays one implementation.
 * @returns The configured short-job duration in minutes.
 */
async function shortJobMinutes(): Promise<number> {
  const rows = await prisma.setting.findMany({
    where: { key: { startsWith: SETTINGS_KEY_PREFIX } },
  });
  const overrides: Partial<Record<SettingsGroup, unknown>> = {};
  for (const row of rows) {
    const group = row.key.slice(SETTINGS_KEY_PREFIX.length) as SettingsGroup;
    try {
      overrides[group] = JSON.parse(row.value);
    } catch {
      // Leave the group on its default if the stored JSON is unparseable.
    }
  }
  return resolveSettings(overrides).availability.durations.short;
}

/** One booking that can gain at least one column value. */
interface Fillable {
  id: string;
  name: string;
  startAt: Date;
  meetingType: "in_person" | "remote" | null;
  duration: "short" | "long" | null;
  minutes: number;
}

/**
 * Backfills the structured columns from each booking's notes text and length.
 * @returns Promise that resolves when the report (and any writes) are done.
 */
async function main(): Promise<void> {
  const shortMins = await shortJobMinutes();

  // `meetingType: null` alone finds nothing on rows written before the column
  // existed - MongoDB stores no key at all and Prisma compiles a bare null to
  // "exists AND is null". The isSet arm is what catches the absent-key shape,
  // which is the majority of what this script exists to fix.
  const candidates = await prisma.booking.findMany({
    where: {
      OR: [
        { meetingType: null },
        { meetingType: { isSet: false } },
        { duration: null },
        { duration: { isSet: false } },
      ],
    },
    select: {
      id: true,
      name: true,
      notes: true,
      startAt: true,
      endAt: true,
      meetingType: true,
      duration: true,
    },
    orderBy: { startAt: "desc" },
  });

  const fillable: Fillable[] = [];
  const unresolved: { id: string; name: string }[] = [];

  for (const b of candidates) {
    const minutes = Math.round((b.endAt.getTime() - b.startAt.getTime()) / 60_000);
    // Meeting type comes from the notes; duration from the reserved length,
    // which is authoritative and needs no parsing. A booking at or under the
    // configured short length is a short job, anything longer is a long one.
    const meetingType = b.meetingType ?? meetingTypeFromNotes(b.notes);
    const duration = b.duration ?? (minutes <= shortMins ? "short" : "long");

    if (!b.meetingType && meetingType === null) {
      // Notes state neither, so there is nothing honest to write. Left alone
      // rather than guessed at from the presence of an address: a remote job
      // booked for someone whose address is on file would be mislabelled.
      unresolved.push({ id: b.id, name: b.name });
      if (b.duration) continue;
    }
    if (meetingType === b.meetingType && duration === b.duration) continue;
    fillable.push({ id: b.id, name: b.name, startAt: b.startAt, meetingType, duration, minutes });
  }

  console.log(
    `${apply ? "Applying" : "Dry run"} - ${candidates.length} booking(s) missing at least one column.\n`,
  );

  for (const f of fillable) {
    const bits = [
      f.meetingType ? `meetingType=${f.meetingType}` : null,
      f.duration ? `duration=${f.duration} (${f.minutes} min)` : null,
    ].filter(Boolean);
    console.log(`${f.name}  (${f.id})  ${f.startAt.toISOString().slice(0, 10)}`);
    console.log(`  ${bits.join("  ")}`);
  }

  if (apply) {
    let written = 0;
    for (const f of fillable) {
      await prisma.booking.update({
        where: { id: f.id },
        data: {
          ...(f.meetingType ? { meetingType: f.meetingType } : {}),
          ...(f.duration ? { duration: f.duration } : {}),
        },
      });
      written++;
    }
    console.log(`\n${written} booking(s) updated.`);
  } else if (fillable.length > 0) {
    console.log(`\n${fillable.length} booking(s) would be updated - re-run the apply script.`);
  } else {
    console.log("Nothing to backfill.");
  }

  if (unresolved.length > 0) {
    console.log(
      `\n${unresolved.length} booking(s) state no meeting type in their notes, so meetingType is left null:`,
    );
    for (const u of unresolved) console.log(`  ${u.name}  (${u.id})`);
    console.log("  the detail page still falls back to the notes text for these.");
  }
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
