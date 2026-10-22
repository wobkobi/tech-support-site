"use client";
// src/features/social/components/TagManager.tsx
// Manage tags: rename a tag, change its colour, or delete it. Deleting takes it off every post
// and preset; the posts themselves stay.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { EmptyState } from "@/features/admin/components/ui/EmptyState";
import { Modal } from "@/features/admin/components/ui/Modal";
import { useToast } from "@/features/admin/components/ui/Toast";
import { callApi } from "@/features/mailing/lib/api-client";
import { TagChip, TagColourPicker } from "@/features/social/components/TagPicker";
import {
  MAX_TAG_NAME,
  tagName,
  type SocialTagRow,
  type TagColour,
} from "@/features/social/lib/tags";
import type React from "react";
import { useState } from "react";

/** How many posts and presets carry a tag. */
export interface TagUse {
  posts: number;
  presets: number;
}

/**
 * Where a tag is used, as words.
 * @param usage - Its post and preset counts.
 * @returns Like "On 3 posts and 1 preset", or "Not on anything yet".
 */
function usageLine(usage: TagUse): string {
  const parts = [
    usage.posts > 0 && `${usage.posts} ${usage.posts === 1 ? "post" : "posts"}`,
    usage.presets > 0 && `${usage.presets} ${usage.presets === 1 ? "preset" : "presets"}`,
  ].filter(Boolean);
  return parts.length > 0 ? `On ${parts.join(" and ")}` : "Not on anything yet";
}

/**
 * Manage tags dialog.
 * @param props - Component props.
 * @param props.open - Whether it's showing.
 * @param props.onClose - Closes it.
 * @param props.tags - Every tag.
 * @param props.usageOf - How many posts and presets carry a tag.
 * @param props.onChanged - Called with a renamed or recoloured tag.
 * @param props.onDeleted - Called with a deleted tag's id.
 * @returns Dialog element.
 */
export function TagManager({
  open,
  onClose,
  tags,
  usageOf,
  onChanged,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  tags: SocialTagRow[];
  usageOf: (id: string) => TagUse;
  onChanged: (tag: SocialTagRow) => void;
  onDeleted: (id: string) => void;
}): React.ReactElement {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Manage tags"
      description="Tags sort your posts. Only you see them; they never go out with a post."
      footer={
        <div className="flex justify-end">
          <AdminButton variant="secondary" onClick={onClose}>
            Done
          </AdminButton>
        </div>
      }
    >
      {tags.length === 0 ? (
        <EmptyState title="No tags yet. Add one from a post's Tags box." />
      ) : (
        <ul className="flex flex-col divide-y divide-admin-border">
          {tags.map((t) => (
            <TagRow
              key={t.id}
              tag={t}
              usage={usageOf(t.id)}
              onChanged={onChanged}
              onDeleted={onDeleted}
            />
          ))}
        </ul>
      )}
    </Modal>
  );
}

/**
 * One tag in the dialog. The name saves when the box loses focus or on Enter; a colour saves
 * when it's clicked.
 * @param props - Component props.
 * @param props.tag - The tag.
 * @param props.usage - Its post and preset counts.
 * @param props.onChanged - Called with the tag once saved.
 * @param props.onDeleted - Called with its id once deleted.
 * @returns Row element.
 */
function TagRow({
  tag,
  usage,
  onChanged,
  onDeleted,
}: {
  tag: SocialTagRow;
  usage: TagUse;
  onChanged: (tag: SocialTagRow) => void;
  onDeleted: (id: string) => void;
}): React.ReactElement {
  const { toast } = useToast();
  const [name, setName] = useState(tag.name);
  const [busy, setBusy] = useState<"name" | "colour" | "delete" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const fieldId = `tag-${tag.id}-name`;

  /**
   * Saves a rename or a new colour.
   * @param patch - The change.
   * @param patch.name - New name.
   * @param patch.colour - New colour.
   */
  async function change(patch: { name?: string; colour?: TagColour }): Promise<void> {
    setBusy(patch.name !== undefined ? "name" : "colour");
    const res = await callApi<{ tag: SocialTagRow }>(
      `/api/admin/social/tags/${tag.id}`,
      "PATCH",
      patch,
    );
    setBusy(null);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      setName(tag.name);
      return;
    }
    setName(res.tag.name);
    onChanged(res.tag);
  }

  /** Saves the name box when it differs from the saved name. */
  function commitName(): void {
    const next = tagName(name);
    if (!next || next === tag.name) {
      setName(tag.name);
      return;
    }
    void change({ name: next });
  }

  /** Deletes the tag. */
  async function remove(): Promise<void> {
    setBusy("delete");
    const res = await callApi(`/api/admin/social/tags/${tag.id}`, "DELETE");
    setBusy(null);
    setConfirming(false);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return;
    }
    onDeleted(tag.id);
    toast(`Deleted the ${tag.name} tag.`, { tone: "success" });
  }

  const total = usage.posts + usage.presets;
  return (
    <li className="flex flex-col gap-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TagChip tag={{ name: name || tag.name, colour: tag.colour }} />
        <span className="text-sm text-admin-muted">{usageLine(usage)}</span>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={fieldId} className="text-sm font-semibold text-admin-text">
            Name
          </label>
          <AdminInput
            id={fieldId}
            value={name}
            maxLength={MAX_TAG_NAME}
            disabled={busy === "name"}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitName();
              } else if (e.key === "Escape") {
                setName(tag.name);
              }
            }}
          />
        </div>
        <TagColourPicker
          label={`Colour for ${tag.name}`}
          value={tag.colour}
          disabled={busy === "colour"}
          onChange={(colour) => {
            if (colour !== tag.colour) void change({ colour });
          }}
        />
      </div>
      {confirming ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-coquelicot-200 bg-coquelicot-50 px-3 py-2 text-sm text-admin-text"
        >
          <span className="flex-1">
            {total > 0
              ? `Delete ${tag.name}? It comes off ${total === 1 ? "the one post" : `all ${total} posts`} it's on. The posts stay.`
              : `Delete ${tag.name}?`}
          </span>
          <AdminButton
            size="xs"
            variant="danger"
            busy={busy === "delete"}
            onClick={() => void remove()}
          >
            Delete
          </AdminButton>
          <AdminButton size="xs" variant="ghost" onClick={() => setConfirming(false)}>
            Keep it
          </AdminButton>
        </div>
      ) : (
        <AdminButton
          size="xs"
          variant="ghost"
          className="self-start"
          onClick={() => setConfirming(true)}
        >
          Delete tag
        </AdminButton>
      )}
    </li>
  );
}
