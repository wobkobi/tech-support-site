// src/features/social/lib/facebook.ts
// Publishes to and deletes from the Facebook Page. One picture goes to /photos, which takes no
// link field, so the link ends the caption; several go up unpublished and join one /feed post;
// text posts go to /feed with a link card. Reels and video stories open an upload session that
// Meta fills by fetching the video from Blob; the cover photo is an unpublished photo set on the
// Page.

import {
  StillProcessingError,
  type PlatformAdapter,
  type PublishInput,
  type PublishResult,
} from "@/features/social/lib/adapter";
import {
  GraphError,
  accountVisible,
  deleteObject,
  graph,
  isUnsure,
  metaConfig,
  rupload,
} from "@/features/social/lib/meta-graph";

// Facebook processes a short reel in a minute or two. Past this the target stays pending with
// the video id, and the cron checks on it again.
const POLL_EVERY_MS = 3_000;
const VIDEO_WAIT_MS = 30_000;

const UNSURE_POST =
  "Facebook didn't answer, and the post isn't on the Page yet. Check the Page before pressing Retry, as it may still show up.";
const UNSURE_STORY =
  "Facebook didn't answer, so the story may have gone up. Check the Page's stories before pressing Retry.";

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
 * A caption with the link on the end, for posts that take no link field.
 * @param text - Filled text.
 * @param linkUrl - The post's link, if any.
 * @returns The caption.
 */
export function facebookCaption(text: string, linkUrl: string | null): string {
  return linkUrl ? `${text}\n\n${linkUrl}`.trim() : text;
}

/**
 * A picture's description as Facebook reads it to screen readers, in place of the one it
 * guesses itself.
 * @param alt - The picture's description, if any.
 * @returns `alt_text_custom`, or nothing when there's none.
 */
export function facebookAlt(alt: string | null): Record<string, string> {
  const text = alt?.trim();
  return text ? { alt_text_custom: text } : {};
}

/**
 * The /feed parameters that join unpublished photos into one post.
 * @param caption - From {@link facebookCaption}.
 * @param photoIds - The unpublished photos, in order.
 * @returns Form parameters; Graph reads attached_media as JSON.
 */
export function albumParams(caption: string, photoIds: string[]): Record<string, string> {
  return {
    message: caption,
    attached_media: JSON.stringify(photoIds.map((id) => ({ media_fbid: id }))),
  };
}

/**
 * The parameters that close a reel's upload session and publish it once processed.
 * @param videoId - The session's video id.
 * @param caption - From {@link facebookCaption}.
 * @returns Form parameters.
 */
export function reelFinishParams(videoId: string, caption: string): Record<string, string> {
  return {
    upload_phase: "finish",
    video_id: videoId,
    video_state: "PUBLISHED",
    description: caption,
  };
}

/**
 * Looks up a post's public link; null on failure, since the post itself already went up.
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
 * Finds a Page post whose answer was lost: the newest since it was sent, with the same words.
 * @param page - Page id.
 * @param message - The words it was sent with.
 * @param since - When it was sent, in ms.
 * @returns Where it lives, or null when it isn't there or the Page can't be read.
 */
async function findOnPage(
  page: string,
  message: string,
  since: number,
): Promise<PublishResult | null> {
  try {
    const res = await graph<{
      data?: { id: string; message?: string; created_time?: string; permalink_url?: string }[];
    }>(`/${page}/posts`, "GET", { fields: "id,message,created_time,permalink_url", limit: "10" });
    // A minute's slack for the two clocks.
    const match = (res.data ?? []).find(
      (p) =>
        (!p.created_time || Date.parse(p.created_time) >= since - 60_000) &&
        (p.message ?? "").trim() === message.trim(),
    );
    return match ? { externalId: match.id, permalink: match.permalink_url ?? null } : null;
  } catch {
    return null;
  }
}

/**
 * Makes a post that goes up in one call. When Meta doesn't answer it may be up anyway, so the
 * Page is checked first, and a miss says to look before Retry.
 * @param page - Page id.
 * @param message - The words it goes up with, to find it by.
 * @param send - Makes the post and gives its Page post id.
 * @returns The post id and its permalink.
 */
async function postOnce(
  page: string,
  message: string,
  send: () => Promise<string>,
): Promise<PublishResult> {
  const sent = Date.now();
  let postId: string;
  try {
    postId = await send();
  } catch (error) {
    if (!isUnsure(error)) throw error;
    const found = await findOnPage(page, message, sent);
    if (found) return found;
    throw new Error(UNSURE_POST);
  }
  return { externalId: postId, permalink: await permalinkOf(postId) };
}

/**
 * Swaps an unsure failure for a warning to look before Retry, for posts that can't be looked up.
 * @param call - The call that puts it up.
 * @param warning - What to say when Meta didn't answer.
 * @returns What the call gave.
 */
async function warnIfUnsure<T>(call: Promise<T>, warning: string): Promise<T> {
  try {
    return await call;
  } catch (error) {
    throw isUnsure(error) ? new Error(warning) : error;
  }
}

/**
 * Uploads a picture without posting it, for an album, a story or the cover.
 * @param page - Page id.
 * @param url - Public picture address.
 * @param alt - The picture's description, for an album picture.
 * @returns The photo id.
 */
async function unpublishedPhoto(
  page: string,
  url: string,
  alt: string | null = null,
): Promise<string> {
  const res = await graph<{ id: string }>(`/${page}/photos`, "POST", {
    url,
    published: "false",
    ...facebookAlt(alt),
  });
  return res.id;
}

interface VideoStatus {
  status?: {
    video_status?: string;
    processing_phase?: { status?: string; error?: { message?: string } };
    publishing_phase?: { status?: string };
  };
  permalink_url?: string;
}

/**
 * Waits for a reel to finish processing and go up.
 * @param videoId - The reel's video id.
 * @returns The video id and its link.
 */
async function waitForReel(videoId: string): Promise<PublishResult> {
  const deadline = Date.now() + VIDEO_WAIT_MS;
  for (;;) {
    const res = await graph<VideoStatus>(`/${videoId}`, "GET", {
      fields: "status,permalink_url",
    });
    const s = res.status;
    if (
      s?.video_status === "error" ||
      s?.processing_phase?.status === "error" ||
      s?.publishing_phase?.status === "error"
    ) {
      const detail = s.processing_phase?.error?.message;
      throw new Error(
        `Facebook couldn't process the video${detail ? ` (${detail})` : ""}. Export it as MP4 (H.264) and try again.`,
      );
    }
    if (s?.publishing_phase?.status === "complete") {
      const link = res.permalink_url ?? null;
      return {
        externalId: videoId,
        permalink: link?.startsWith("/") ? `https://www.facebook.com${link}` : link,
      };
    }
    if (Date.now() > deadline) {
      throw new StillProcessingError("Facebook is still processing the video.", videoId);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_EVERY_MS));
  }
}

/**
 * Posts a reel, or checks on one an earlier run handed over.
 * @param page - Page id.
 * @param input - Filled caption and video.
 * @returns The video id and its link.
 */
async function publishReel(page: string, input: PublishInput): Promise<PublishResult> {
  if (input.containerId) return waitForReel(input.containerId);
  if (!input.video) throw new Error("A reel needs a video.");
  const start = await graph<{ video_id: string }>(`/${page}/video_reels`, "POST", {
    upload_phase: "start",
  });
  await rupload(start.video_id, input.video.url);
  try {
    await graph(
      `/${page}/video_reels`,
      "POST",
      reelFinishParams(start.video_id, facebookCaption(input.text, input.linkUrl)),
    );
  } catch (error) {
    // It may have been taken, so the next pass checks the video instead of starting again.
    if (!isUnsure(error)) throw error;
    throw new StillProcessingError(
      "Facebook didn't answer in time, so the reel is checked again in a few minutes.",
      start.video_id,
    );
  }
  return waitForReel(start.video_id);
}

/**
 * Posts a story: a picture, or a video of up to 60 seconds. Stories have no caption or link.
 * @param page - Page id.
 * @param input - The story's picture or video.
 * @returns The story's post id; stories have no lasting link.
 */
async function publishStory(page: string, input: PublishInput): Promise<PublishResult> {
  if (input.video) {
    const start = await graph<{ video_id: string }>(`/${page}/video_stories`, "POST", {
      upload_phase: "start",
    });
    await rupload(start.video_id, input.video.url);
    const res = await warnIfUnsure(
      graph<{ post_id?: string }>(`/${page}/video_stories`, "POST", {
        upload_phase: "finish",
        video_id: start.video_id,
      }),
      UNSURE_STORY,
    );
    return { externalId: res.post_id ?? start.video_id, permalink: null };
  }
  if (!input.imageUrl) throw new Error("A story needs a picture or a video.");
  const photoId = await unpublishedPhoto(page, input.imageUrl);
  const res = await warnIfUnsure(
    graph<{ post_id?: string }>(`/${page}/photo_stories`, "POST", { photo_id: photoId }),
    UNSURE_STORY,
  );
  return { externalId: res.post_id ?? photoId, permalink: null };
}

/**
 * Makes the picture the Page's cover photo. Meta may refuse the app this, so the message says
 * how to do it by hand.
 * @param page - Page id.
 * @param input - The cover picture.
 * @returns The photo id and its link.
 */
async function publishCover(page: string, input: PublishInput): Promise<PublishResult> {
  if (!input.imageUrl) throw new Error("A cover photo needs a picture.");
  const photoId = await unpublishedPhoto(page, input.imageUrl);
  try {
    await graph(`/${page}`, "POST", { cover: photoId });
  } catch (error) {
    const code = error instanceof GraphError ? error.code : null;
    if (code === 10 || (code !== null && code >= 200 && code < 300)) {
      throw new GraphError(
        "Facebook didn't let the app change the cover photo (it needs the pages_manage_metadata permission). Open the picture, save it, and set it as the cover in Facebook.",
        code,
      );
    }
    throw error;
  }
  return { externalId: photoId, permalink: `https://www.facebook.com/photo/?fbid=${photoId}` };
}

/**
 * Posts to the Page.
 * @param input - Filled text, media and link.
 * @returns The Page post id and its permalink.
 */
async function publish(input: PublishInput): Promise<PublishResult> {
  const page = pageId();
  if (input.format === "reel") return publishReel(page, input);
  if (input.format === "story") return publishStory(page, input);
  if (input.format === "cover") return publishCover(page, input);

  const caption = facebookCaption(input.text, input.linkUrl);
  if (input.images.length > 1) {
    const ids: string[] = [];
    for (const picture of input.images) {
      ids.push(await unpublishedPhoto(page, picture.url, picture.alt));
    }
    return postOnce(page, caption, async () => {
      const res = await graph<{ id: string }>(`/${page}/feed`, "POST", albumParams(caption, ids));
      return res.id;
    });
  }
  const imageUrl = input.imageUrl;
  if (imageUrl) {
    // /photos returns the photo id and the Page post id; the permalink belongs to
    // the post, so it's looked up by post_id.
    return postOnce(page, caption, async () => {
      const res = await graph<{ id: string; post_id?: string }>(`/${page}/photos`, "POST", {
        url: imageUrl,
        caption,
        ...facebookAlt(input.imageAlt),
      });
      return res.post_id ?? res.id;
    });
  }
  return postOnce(page, input.text, async () => {
    const res = await graph<{ id: string }>(`/${page}/feed`, "POST", {
      message: input.text,
      ...(input.linkUrl ? { link: input.linkUrl } : {}),
    });
    return res.id;
  });
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
   * Deletes a Page post or reel. Post ids are "{page}_{post}", so another Page's post never
   * counts as deleted.
   * @param postId - Page post id, or a reel's video id, saved when it was posted.
   */
  async remove(postId) {
    const page = pageId();
    await deleteObject(
      postId,
      async () => postId.startsWith(`${page}_`) && (await accountVisible("facebook")),
    );
  },
  /**
   * Proves the token is this Page's own: `/me` on a user token answers with the person's id.
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
