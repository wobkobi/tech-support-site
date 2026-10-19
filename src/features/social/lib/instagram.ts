// src/features/social/lib/instagram.ts
// Publishes to and deletes from Instagram. Publishing creates a container from a public JPEG URL,
// waits for processing, then publishes it. Deleting needs instagram_manage_contents.

import {
  StillProcessingError,
  type PlatformAdapter,
  type PublishInput,
  type PublishResult,
} from "@/features/social/lib/adapter";
import { GraphError, deleteObject, graph, metaConfig } from "@/features/social/lib/meta-graph";

// Containers for a single image are usually FINISHED within seconds. Past this the
// target stays pending and the cron's stuck-run pass tries again.
const POLL_EVERY_MS = 2_000;
const POLL_FOR_MS = 60_000;

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
 * Waits for a media container to finish processing.
 * @param containerId - Container id from the /media call.
 */
async function waitUntilFinished(containerId: string): Promise<void> {
  const deadline = Date.now() + POLL_FOR_MS;
  for (;;) {
    const { status_code: status } = await graph<{ status_code?: string }>(
      `/${containerId}`,
      "GET",
      { fields: "status_code" },
    );
    if (status === "FINISHED") return;
    if (status === "ERROR" || status === "EXPIRED") {
      throw new Error(
        status === "ERROR"
          ? "Instagram couldn't process the picture. Try a different one."
          : "Instagram's upload expired. Try again.",
      );
    }
    if (Date.now() > deadline) {
      throw new StillProcessingError("Instagram is still processing the picture.");
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_EVERY_MS));
  }
}

/**
 * Posts a picture with its caption. Caption links aren't clickable, so the link is left off.
 * @param input - Filled caption and picture.
 * @returns The media id and its permalink.
 */
async function publish(input: PublishInput): Promise<PublishResult> {
  if (!input.imageUrl) throw new Error("Instagram needs a picture.");
  const account = igId();
  const container = await graph<{ id: string }>(`/${account}/media`, "POST", {
    image_url: input.imageUrl,
    caption: input.text,
  });
  await waitUntilFinished(container.id);
  const media = await graph<{ id: string }>(`/${account}/media_publish`, "POST", {
    creation_id: container.id,
  });
  let permalink: string | null = null;
  try {
    const res = await graph<{ permalink?: string }>(`/${media.id}`, "GET", {
      fields: "permalink",
    });
    permalink = res.permalink ?? null;
  } catch {
    // Already published; a missing link isn't worth failing the post over.
  }
  return { externalId: media.id, permalink };
}

/**
 * Deletes a published post, naming the one permission needed since older tokens may lack it.
 * @param mediaId - Media id saved when it was posted.
 */
async function remove(mediaId: string): Promise<void> {
  try {
    await deleteObject(mediaId, async () => {
      await graph(`/${igId()}`, "GET", { fields: "id" });
      return true;
    });
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
