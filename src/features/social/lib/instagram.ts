// src/features/social/lib/instagram.ts
// Publishes to and deletes from Instagram. Publishing makes a container from public URLs (a JPEG,
// several for a carousel, or a video), waits for processing, then publishes it. A container still
// processing is saved on the target, so the cron's next pass checks it instead of uploading again.
// Deleting needs instagram_manage_contents.

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
} from "@/features/social/lib/meta-graph";

// Picture containers are usually FINISHED within seconds; videos take minutes. Past these the
// target stays pending with its container, and the cron checks on it again.
const POLL_EVERY_MS = 2_000;
const PICTURE_WAIT_MS = 60_000;
const VIDEO_WAIT_MS = 30_000;

/** Graph parameters for the containers one post needs. */
export interface InstagramContainers {
  /** Carousel items, made first; their ids go in the main container's `children`. */
  children: Record<string, string>[];
  main: Record<string, string>;
  /** What's being processed, for the messages. */
  what: "picture" | "pictures" | "video";
}

/**
 * A picture's description as Instagram reads it to screen readers. Only single pictures and
 * carousel items take one; reels and stories don't.
 * @param alt - The picture's description, if any.
 * @returns `alt_text` (Instagram's 1000-character cap), or nothing when there's none.
 */
function altText(alt: string | null): Record<string, string> {
  const text = alt?.trim();
  return text ? { alt_text: text.slice(0, 1000) } : {};
}

/**
 * The containers a post needs, by kind: one picture, a carousel of several, a reel, or a story.
 * Stories take no caption; links aren't clickable in captions, so the link is left off.
 * @param input - Filled caption and media.
 * @returns The container parameters.
 */
export function instagramContainers(input: PublishInput): InstagramContainers {
  if (input.format === "cover") throw new Error("Instagram doesn't have a cover photo.");
  if (input.format === "reel") {
    if (!input.video) throw new Error("A reel needs a video.");
    return {
      children: [],
      main: {
        media_type: "REELS",
        video_url: input.video.url,
        caption: input.text,
        share_to_feed: "true",
        ...(input.video.coverUrl ? { cover_url: input.video.coverUrl } : {}),
      },
      what: "video",
    };
  }
  if (input.format === "story") {
    if (input.video) {
      return {
        children: [],
        main: { media_type: "STORIES", video_url: input.video.url },
        what: "video",
      };
    }
    if (!input.imageUrl) throw new Error("A story needs a picture or a video.");
    return {
      children: [],
      main: { media_type: "STORIES", image_url: input.imageUrl },
      what: "picture",
    };
  }
  if (!input.imageUrl) throw new Error("Instagram needs a picture.");
  if (input.images.length > 1) {
    return {
      children: input.images.map((p) => ({
        image_url: p.url,
        is_carousel_item: "true",
        ...altText(p.alt),
      })),
      main: { media_type: "CAROUSEL", caption: input.text },
      what: "pictures",
    };
  }
  return {
    children: [],
    main: { image_url: input.imageUrl, caption: input.text, ...altText(input.imageAlt) },
    what: "picture",
  };
}

/**
 * The Instagram account id, or a thrown error when it's unset.
 * @returns IG user id.
 */
function igId(): string {
  const id = metaConfig().igAccountId;
  if (!id) throw new Error("INSTAGRAM_ACCOUNT_ID isn't set.");
  return id;
}

/**
 * Waits for a container to finish processing.
 * @param containerId - Container id.
 * @param waitMs - How long to wait before leaving it to the cron.
 * @param what - What's processing, for the messages.
 * @param resumable - Whether the container is worth checking later (false for carousel items).
 * @returns FINISHED, or PUBLISHED when an earlier run already published it.
 */
async function waitUntilFinished(
  containerId: string,
  waitMs: number,
  what: InstagramContainers["what"],
  resumable: boolean,
): Promise<"FINISHED" | "PUBLISHED"> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const { status_code: status } = await graph<{ status_code?: string }>(
      `/${containerId}`,
      "GET",
      { fields: "status_code" },
    );
    if (status === "FINISHED" || status === "PUBLISHED") return status;
    if (status === "ERROR") {
      throw new Error(
        what === "video"
          ? "Instagram couldn't process the video. Export it as MP4 (H.264) and try again."
          : `Instagram couldn't process the ${what}. Try a different one.`,
      );
    }
    if (status === "EXPIRED") throw new Error("Instagram's upload expired. Try again.");
    if (Date.now() > deadline) {
      throw new StillProcessingError(
        `Instagram is still processing the ${what}.`,
        resumable ? containerId : null,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_EVERY_MS));
  }
}

/**
 * Refuses before uploading when the account has used its posts for the last 24 hours. A failed
 * check doesn't block: Instagram refuses for itself if the limit really is used up.
 * @param account - IG user id.
 */
async function checkQuota(account: string): Promise<void> {
  let used: number | undefined;
  let total: number | undefined;
  try {
    const res = await graph<{
      data?: { quota_usage?: number; config?: { quota_total?: number } }[];
    }>(`/${account}/content_publishing_limit`, "GET", { fields: "quota_usage,config" });
    used = res.data?.[0]?.quota_usage;
    total = res.data?.[0]?.config?.quota_total;
  } catch {
    return;
  }
  if (typeof used === "number" && typeof total === "number" && used >= total) {
    throw new Error(
      `Instagram allows ${total} posts in 24 hours, and they're used up. Retry once the oldest of them is a day old.`,
    );
  }
}

/**
 * A published media's public link; null on failure, since it's already up.
 * @param mediaId - Media id.
 * @returns The permalink, or null.
 */
async function permalinkOf(mediaId: string): Promise<string | null> {
  try {
    const res = await graph<{ permalink?: string }>(`/${mediaId}`, "GET", {
      fields: "permalink",
    });
    return res.permalink ?? null;
  } catch {
    return null;
  }
}

/**
 * Finds what an earlier run published from a container whose answer was lost: the newest media
 * since the container was made, with the same caption (stories have none, so any story counts).
 * @param account - IG user id.
 * @param input - The post.
 * @returns Where it lives.
 */
async function findPublished(account: string, input: PublishInput): Promise<PublishResult> {
  const story = input.format === "story";
  const res = await graph<{
    data?: { id: string; caption?: string; timestamp?: string; permalink?: string }[];
  }>(`/${account}/${story ? "stories" : "media"}`, "GET", {
    fields: "id,caption,timestamp,permalink",
    limit: "10",
  });
  // A minute's slack for the two clocks.
  const since = (input.containerCreatedAt?.getTime() ?? 0) - 60_000;
  const match = (res.data ?? []).find(
    (m) =>
      (!m.timestamp || new Date(m.timestamp).getTime() >= since) &&
      (story || (m.caption ?? "").trim() === input.text.trim()),
  );
  if (!match) {
    throw new Error(
      "Instagram says it went up, but it couldn't be found. Check Instagram before posting it again.",
    );
  }
  return { externalId: match.id, permalink: match.permalink ?? null };
}

/**
 * Publishes a finished container.
 * @param account - IG user id.
 * @param containerId - Container id.
 * @returns The media id and its permalink.
 */
async function publishContainer(account: string, containerId: string): Promise<PublishResult> {
  let media: { id: string };
  try {
    media = await graph<{ id: string }>(`/${account}/media_publish`, "POST", {
      creation_id: containerId,
    });
  } catch (error) {
    // It may have gone up, so the next pass reads the container, which says PUBLISHED if it did.
    if (isUnsure(error)) {
      throw new StillProcessingError(
        "Instagram didn't answer in time, so it's checked again in a few minutes.",
        containerId,
      );
    }
    throw error;
  }
  return { externalId: media.id, permalink: await permalinkOf(media.id) };
}

/**
 * Posts a picture, carousel, reel or story, or carries on with the container an earlier run left
 * processing.
 * @param input - Filled caption and media.
 * @returns The media id and its permalink.
 */
async function publish(input: PublishInput): Promise<PublishResult> {
  const account = igId();
  const plan = instagramContainers(input);
  const waitMs = plan.what === "video" ? VIDEO_WAIT_MS : PICTURE_WAIT_MS;

  let containerId = input.containerId;
  if (!containerId) {
    await checkQuota(account);
    const children: string[] = [];
    for (const params of plan.children) {
      const child = await graph<{ id: string }>(`/${account}/media`, "POST", params);
      await waitUntilFinished(child.id, PICTURE_WAIT_MS, "pictures", false);
      children.push(child.id);
    }
    const main = await graph<{ id: string }>(`/${account}/media`, "POST", {
      ...plan.main,
      ...(children.length > 0 ? { children: children.join(",") } : {}),
    });
    containerId = main.id;
  }
  const status = await waitUntilFinished(containerId, waitMs, plan.what, true);
  if (status === "PUBLISHED") return findPublished(account, input);
  return publishContainer(account, containerId);
}

/**
 * Deletes a published post, naming the one permission needed since older tokens may lack it.
 * @param mediaId - Media id saved when it was posted.
 */
async function remove(mediaId: string): Promise<void> {
  try {
    await deleteObject(mediaId, () => accountVisible("instagram"));
  } catch (error) {
    const code = error instanceof GraphError ? error.code : null;
    if (code === 10 || (code !== null && code >= 200 && code < 300)) {
      throw new GraphError(
        "Taking Instagram posts down needs the instagram_manage_contents permission. Add it in Graph API Explorer and regenerate the Page token.",
        code,
      );
    }
    throw error;
  }
}

export const instagram: PlatformAdapter = {
  /**
   * Env vars posting to this Instagram account still needs.
   * @returns Missing variable names.
   */
  missingEnv() {
    const { igAccountId, token } = metaConfig();
    return [!igAccountId && "INSTAGRAM_ACCOUNT_ID", !token && "META_PAGE_ACCESS_TOKEN"].filter(
      (v): v is string => Boolean(v),
    );
  },
  publish,
  remove,
  /**
   * Reads the Instagram account's name to prove the token works.
   * @returns The name, or the reason the check failed.
   */
  async checkConnection() {
    try {
      const res = await graph<{ username: string }>(`/${igId()}`, "GET", { fields: "username" });
      return { ok: true, label: `@${res.username}` };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Check failed." };
    }
  },
};
