// src/features/social/lib/profile-photo.server.ts
// Keeps the Business Profile's picture the same as the connected Google account's: at most once
// a day the sync-social cron reads the account's picture and sends it when it isn't the one last
// sent. A picture changed by hand on Google stays until the account's picture changes.

import { google, readAccountPhoto, setProfilePhoto } from "@/features/social/lib/google-business";
import { prisma } from "@/shared/lib/prisma";

const STATE_KEY = "social:profilePhoto";
/** How often the account's picture is read. */
const CHECK_EVERY_MS = 24 * 60 * 60_000;

/** The sync's record. */
interface PhotoState {
  /** When the account's picture was last read, ISO. */
  checkedAt: string | null;
  /** The key of the picture last sent to the profile. */
  sentKey: string | null;
}

/** How a run went. */
export type PhotoSyncResult = "not-connected" | "not-due" | "no-picture" | "unchanged" | "updated";

/**
 * Reads the sync's record.
 * @returns The state, empty when there's none or it can't be read.
 */
async function loadState(): Promise<PhotoState> {
  const row = await prisma.setting.findFirst({
    where: { key: STATE_KEY },
    select: { value: true },
  });
  try {
    const raw = JSON.parse(row?.value ?? "{}") as Partial<PhotoState>;
    return {
      checkedAt: typeof raw.checkedAt === "string" ? raw.checkedAt : null,
      sentKey: typeof raw.sentKey === "string" ? raw.sentKey : null,
    };
  } catch {
    return { checkedAt: null, sentKey: null };
  }
}

/**
 * Copies the account's picture to the profile when it's due a check and has changed.
 * @param now - Now.
 * @returns How it went. Throws when Google refuses, after noting the check so it waits a day.
 */
export async function syncProfilePhoto(now: Date): Promise<PhotoSyncResult> {
  if (google.missingEnv().length > 0) return "not-connected";
  const state = await loadState();
  const last = state.checkedAt ? Date.parse(state.checkedAt) : NaN;
  if (now.getTime() - last < CHECK_EVERY_MS) return "not-due";

  // Stamped before the read, so a token without the permission is tried daily, not every run.
  state.checkedAt = now.toISOString();
  try {
    const photo = await readAccountPhoto();
    if (!photo) return "no-picture";
    if (photo.key === state.sentKey) return "unchanged";
    await setProfilePhoto(photo.url);
    state.sentKey = photo.key;
    return "updated";
  } finally {
    const value = JSON.stringify(state);
    await prisma.setting.upsert({
      where: { key: STATE_KEY },
      create: { key: STATE_KEY, value },
      update: { value },
    });
  }
}
