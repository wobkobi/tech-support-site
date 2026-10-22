// src/features/social/lib/video-upload.ts
// Browser side of a reel's or story's video: opens it to read its size and length, draws cover
// frames, and uploads straight to the public Blob store with a token from the video-upload route
// (a video is too big to pass through a function).

import { VIDEO_PREFIX, VIDEO_TYPES } from "@/features/social/lib/media";
import { upload } from "@vercel/blob/client";

const UPLOAD_ROUTE = "/api/admin/social/video-upload";
/** Below this a single request is quicker than splitting the file into parts. */
const MULTIPART_FROM = 8 * 1024 * 1024;
/** Longest side of a cover frame; Instagram shows reel covers at 1080x1920. */
const COVER_EDGE = 1920;
const JPEG_QUALITY = 0.85;

/** A video's pixel size and length. */
export interface VideoMeta {
  width: number;
  height: number;
  durationMs: number;
}

/**
 * The video type of a file. Windows often leaves a .mov file's type blank, so the name decides.
 * @param file - File the operator picked.
 * @returns "video/mp4" or "video/quicktime", or null for anything else.
 */
export function videoTypeOf(file: File): (typeof VIDEO_TYPES)[number] | null {
  const type = file.type || (/\.mov$/i.test(file.name) ? "video/quicktime" : "");
  if (type)
    return (VIDEO_TYPES as readonly string[]).includes(type)
      ? (type as (typeof VIDEO_TYPES)[number])
      : null;
  return /\.mp4$/i.test(file.name) ? "video/mp4" : null;
}

/**
 * Opens a video far enough to draw its frames. A stored video needs crossOrigin, or the canvas
 * can't be read back for a cover frame.
 * @param src - A local object URL or the stored video's address.
 * @param cors - Whether to ask for it with CORS.
 * @returns The loaded video element, muted and paused.
 */
export function loadVideo(src: string, cors: boolean): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    if (cors) video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.addEventListener("loadeddata", () => resolve(video), { once: true });
    video.addEventListener(
      "error",
      () =>
        reject(
          new Error("This browser can't open that video. Export it as MP4 (H.264) and try again."),
        ),
      { once: true },
    );
    video.src = src;
  });
}

/**
 * Reads a loaded video's size and length.
 * @param video - Loaded video element.
 * @returns Its pixel size and length in milliseconds.
 */
export function videoMetaOf(video: HTMLVideoElement): VideoMeta {
  return {
    width: video.videoWidth,
    height: video.videoHeight,
    durationMs: Math.round(video.duration * 1000),
  };
}

/**
 * Draws one frame of a video as a JPEG for its cover.
 * @param video - Loaded video element.
 * @param atMs - Where in the video, in milliseconds.
 * @returns The frame as a JPEG file.
 */
export async function captureFrame(video: HTMLVideoElement, atMs: number): Promise<File> {
  const at = Math.min(Math.max(atMs / 1000, 0), Math.max(video.duration - 0.05, 0));
  if (Math.abs(video.currentTime - at) > 0.01) {
    await new Promise<void>((resolve) => {
      video.addEventListener("seeked", () => resolve(), { once: true });
      video.currentTime = at;
    });
  }
  const scale = Math.min(1, COVER_EDGE / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't draw the cover.");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  if (!blob) throw new Error("Couldn't draw the cover.");
  return new File([blob], "cover.jpg", { type: "image/jpeg" });
}

/**
 * Uploads a video to the Blob store.
 * @param file - MP4 or MOV the operator picked.
 * @param onProgress - Called with the share uploaded so far, 0 to 100.
 * @param signal - Cancels the upload.
 * @returns The stored video's address.
 */
export async function uploadVideo(
  file: File,
  onProgress: (percentage: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  const type = videoTypeOf(file);
  if (!type) throw new Error("Pick an MP4 or MOV video.");
  const result = await upload(
    `${VIDEO_PREFIX}video.${type === "video/quicktime" ? "mov" : "mp4"}`,
    file,
    {
      access: "public",
      handleUploadUrl: UPLOAD_ROUTE,
      contentType: type,
      multipart: file.size >= MULTIPART_FROM,
      /**
       * Passes on how much has gone up.
       * @param e - Progress from the Blob client.
       */
      onUploadProgress: (e) => {
        onProgress(e.percentage);
      },
      abortSignal: signal,
    },
  );
  return result.url;
}

/**
 * Uploads a cover frame beside the videos, so clean-up treats it like one.
 * @param frame - JPEG from {@link captureFrame}.
 * @returns The stored frame's address.
 */
export async function uploadCoverFrame(frame: File): Promise<string> {
  const result = await upload(`${VIDEO_PREFIX}cover-frame.jpg`, frame, {
    access: "public",
    handleUploadUrl: UPLOAD_ROUTE,
    contentType: "image/jpeg",
  });
  return result.url;
}
