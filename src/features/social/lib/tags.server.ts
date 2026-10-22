// src/features/social/lib/tags.server.ts
// Server-only: post tags with how many posts carry each, and adding, renaming and deleting them.
// Tagging a post never counts as editing it, so posts keep their updatedAt.

import { writePostMeta } from "@/features/social/lib/post-meta.server";
import {
  MAX_TAG_NAME,
  byTagName,
  isTagColour,
  nextTagColour,
  tagKey,
  tagName,
  type SocialTagRow,
} from "@/features/social/lib/tags";
import { isUniqueConflict } from "@/shared/lib/api-response";
import { prisma } from "@/shared/lib/prisma";
import type { SocialTag } from "@prisma/client";

/** What adding or changing a tag came to. */
export type TagWriteResult =
  | { ok: true; tag: SocialTagRow; created: boolean }
  | { ok: false; status: 400 | 404 | 409; error: string };

/**
 * A stored tag as the admin sees it. An unknown colour shows grey.
 * @param tag - Tag as stored.
 * @param count - Posts carrying it.
 * @returns The row.
 */
function toTagRow(tag: SocialTag, count: number): SocialTagRow {
  return {
    id: tag.id,
    name: tag.name,
    colour: isTagColour(tag.colour) ? tag.colour : "grey",
    count,
  };
}

/**
 * A tag with its post count.
 * @param tag - Tag as stored.
 * @returns The row.
 */
async function withCount(tag: SocialTag): Promise<SocialTagRow> {
  return toTagRow(tag, await prisma.socialPost.count({ where: { tagIds: { has: tag.id } } }));
}

/**
 * Every tag, A-Z, with how many posts and presets carry it.
 * @returns The tags.
 */
export async function listTags(): Promise<SocialTagRow[]> {
  const [tags, posts] = await Promise.all([
    prisma.socialTag.findMany(),
    prisma.socialPost.findMany({ select: { tagIds: true } }),
  ]);
  const counts = new Map<string, number>();
  for (const p of posts) {
    for (const id of p.tagIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return tags.map((t) => toTagRow(t, counts.get(t.id) ?? 0)).sort(byTagName);
}

/**
 * Keeps only the ids of tags that still exist, in the order given.
 * @param ids - Tag ids from a request.
 * @returns The ids that exist.
 */
export async function knownTagIds(ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const found = await prisma.socialTag.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true },
  });
  const known = new Set(found.map((t) => t.id));
  return ids.filter((id) => known.has(id));
}

/**
 * Checks a tag name as typed.
 * @param raw - Raw value.
 * @returns The tidied name, or an error message.
 */
function checkName(raw: unknown): string | { error: string } {
  const name = typeof raw === "string" ? tagName(raw) : "";
  if (!name) return { error: "Give the tag a name." };
  if (name.length > MAX_TAG_NAME) {
    return { error: `Tag names can be ${MAX_TAG_NAME} characters at most.` };
  }
  return name;
}

/**
 * Adds a tag, or hands back the one that already has the name, so typing "tips" when "Tips"
 * exists picks that one. A new tag without a colour gets the next unused swatch.
 * @param input - Request fields.
 * @param input.name - Name as typed.
 * @param input.colour - Swatch key, or undefined to pick one.
 * @returns The tag, with created false when it already existed.
 */
export async function addTag(input: { name: unknown; colour?: unknown }): Promise<TagWriteResult> {
  const name = checkName(input.name);
  if (typeof name !== "string") return { ok: false, status: 400, error: name.error };
  if (input.colour !== undefined && !isTagColour(input.colour)) {
    return { ok: false, status: 400, error: "That colour isn't one of the choices." };
  }
  const key = tagKey(name);
  const existing = await prisma.socialTag.findUnique({ where: { key } });
  if (existing) return { ok: true, tag: await withCount(existing), created: false };

  const colour =
    input.colour ??
    nextTagColour(
      (await prisma.socialTag.findMany({ select: { colour: true } })).map((t) => t.colour),
    );
  try {
    const created = await prisma.socialTag.create({ data: { name, key, colour } });
    return { ok: true, tag: toTagRow(created, 0), created: true };
  } catch (error) {
    // Two adds of the same name at once: the other one won, so use it.
    if (!isUniqueConflict(error)) throw error;
    const winner = await prisma.socialTag.findUnique({ where: { key } });
    if (!winner) throw error;
    return { ok: true, tag: await withCount(winner), created: false };
  }
}

/**
 * Renames or recolours a tag. A name another tag has is refused.
 * @param id - Tag id.
 * @param input - Request fields; each is optional.
 * @param input.name - New name.
 * @param input.colour - New swatch key.
 * @returns The tag, or an error.
 */
export async function changeTag(
  id: string,
  input: { name?: unknown; colour?: unknown },
): Promise<TagWriteResult> {
  const data: { name?: string; key?: string; colour?: string } = {};
  if (input.name !== undefined) {
    const name = checkName(input.name);
    if (typeof name !== "string") return { ok: false, status: 400, error: name.error };
    data.name = name;
    data.key = tagKey(name);
  }
  if (input.colour !== undefined) {
    if (!isTagColour(input.colour)) {
      return { ok: false, status: 400, error: "That colour isn't one of the choices." };
    }
    data.colour = input.colour;
  }
  if (!data.name && !data.colour) return { ok: false, status: 400, error: "Nothing to change." };

  /**
   * The refusal for a name another tag already has.
   * @param name - The other tag's name.
   * @returns A 409 result.
   */
  const taken = (name: string): TagWriteResult => ({
    ok: false,
    status: 409,
    error: `There's already a tag called ${name}.`,
  });
  if (data.key) {
    const clash = await prisma.socialTag.findUnique({ where: { key: data.key } });
    if (clash && clash.id !== id) return taken(clash.name);
  }
  try {
    const updated = await prisma.socialTag.update({ where: { id }, data });
    return { ok: true, tag: await withCount(updated), created: false };
  } catch (error) {
    if (isUniqueConflict(error)) return taken(data.name ?? "that name");
    const exists = await prisma.socialTag.count({ where: { id } });
    if (!exists) return { ok: false, status: 404, error: "Tag not found." };
    throw error;
  }
}

/**
 * Deletes a tag and takes it off every post. The tag goes first, so a post tagged meanwhile
 * can't pick it back up: tag writes keep only tags that still exist.
 * @param id - Tag id.
 * @returns False when the tag was already gone.
 */
export async function deleteTag(id: string): Promise<boolean> {
  const deleted = await prisma.socialTag.deleteMany({ where: { id } });
  if (deleted.count === 0) return false;
  const tagged = await prisma.socialPost.findMany({
    where: { tagIds: { has: id } },
    select: { id: true },
  });
  for (const post of tagged) {
    await writePostMeta(post.id, (p) => ({ tagIds: p.tagIds.filter((t) => t !== id) }));
  }
  return true;
}
