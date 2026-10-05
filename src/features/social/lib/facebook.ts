// src/features/social/lib/facebook.ts
// Publishes to the business Facebook Page, and takes posts down again. A post with a
// picture goes to /photos, which takes no link field, so the link is added to the end
// of the caption; a text post goes to /feed with the link attached as a preview card.
// Deleting needs no permission beyond pages_manage_posts, which posting already uses.

import type { PlatformAdapter, PublishInput, PublishResult } from "@/features/social/lib/adapter";
import { deleteObject, graph, metaConfig } from "@/features/social/lib/meta-graph";

/**
 * The page id, or a thrown error when it's unset.
 * @returns Page id.
 */
function pageId(): string {
  const id = metaConfig().pageId;
  if (!id) throw new Error("META_PAGE_ID isn't set.");
  return id;
}

/**
 * Looks up a post's public link. A failure here doesn't undo the post, so it
 * comes back as null rather than throwing.
 * @param postId - Page post id ("{page}_{post}").
 * @returns The permalink, or null.
 */
async function permalinkOf(postId: string): Promise<string | null> {
  try {
    const res = await graph<{ permalink_url?: string }>(`/${postId}`, "GET", {
      fields: "permalink_url",
    });
    return res.permalink_url ?? null;
  } catch {
    return null;
  }
}

/**
 * Posts to the Page.
 * @param input - Filled text, picture and link.
 * @returns The Page post id and its permalink.
 */
async function publish(input: PublishInput): Promise<PublishResult> {
  const page = pageId();
  if (input.imageUrl) {
    const caption = input.linkUrl ? `${input.text}\n\n${input.linkUrl}` : input.text;
    // /photos returns the photo id and the Page post id; the permalink belongs to
    // the post, so it's looked up by post_id.
    const res = await graph<{ id: string; post_id?: string }>(`/${page}/photos`, "POST", {
      url: input.imageUrl,
      caption,
    });
    const postId = res.post_id ?? res.id;
    return { externalId: postId, permalink: await permalinkOf(postId) };
  }
  const res = await graph<{ id: string }>(`/${page}/feed`, "POST", {
    message: input.text,
    ...(input.linkUrl ? { link: input.linkUrl } : {}),
  });
  return { externalId: res.id, permalink: await permalinkOf(res.id) };
}

export const facebook: PlatformAdapter = {
  /**
   * Env vars posting to this Page still needs.
   * @returns Missing variable names.
   */
  missingEnv() {
    const { pageId: page, token } = metaConfig();
    return [!page && "META_PAGE_ID", !token && "META_PAGE_ACCESS_TOKEN"].filter((v): v is string =>
      Boolean(v),
    );
  },
  publish,
  /**
   * Deletes a Page post. Page post ids are "{page}_{post}", so a post from a different
   * Page never counts as already deleted.
   * @param postId - Page post id saved when it was posted.
   */
  async remove(postId) {
    const page = pageId();
    await deleteObject(postId, async () => {
      if (!postId.startsWith(`${page}_`)) return false;
      const me = await graph<{ id: string }>("/me", "GET", { fields: "id" });
      return me.id === page;
    });
  },
  /**
   * Proves the token is this Page's own token. `/me` answers as whoever the token
   * belongs to, so a user token (which can read the Page but not post as it) comes
   * back with the person's id instead of the Page's.
   * @returns The Page name, or the reason the check failed.
   */
  async checkConnection() {
    try {
      const me = await graph<{ id: string; name: string }>("/me", "GET", { fields: "id,name" });
      if (me.id !== pageId()) {
        return {
          ok: false,
          error: `META_PAGE_ACCESS_TOKEN belongs to ${me.name}, not the Page. Use the access_token from me/accounts.`,
        };
      }
      return { ok: true, label: me.name };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Check failed." };
    }
  },
};
