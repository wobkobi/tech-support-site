// src/app/api/admin/social/video-upload/route.ts
// Hands the browser a short-lived token to upload a reel's or story's video, or a video's cover
// frame, straight to the public Blob store: a video is too big to pass through a function. Meta
// fetches the video from there when it posts.

import { VIDEO_MAX_BYTES, VIDEO_PREFIX, VIDEO_TYPES } from "@/features/social/lib/media";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { canUploadImages } from "@/shared/lib/image-upload";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";

// A cover frame is a JPEG the browser draws from the video.
const COVER_MAX_BYTES = 5 * 1024 * 1024;

/**
 * What the upload token allows for a path: a cover frame (cover-*.jpg) is a JPEG up to 5 MB,
 * anything else an MP4 or MOV up to 250 MB.
 * @param pathname - The path the browser asked to upload to.
 * @returns The token's limits.
 */
function tokenRules(pathname: string): Promise<{
  allowedContentTypes: string[];
  maximumSizeInBytes: number;
  addRandomSuffix: boolean;
}> {
  if (!pathname.startsWith(VIDEO_PREFIX)) {
    return Promise.reject(new Error("Videos go under social/video/."));
  }
  const cover = /^cover-[\w-]*\.jpe?g$/i.test(pathname.slice(VIDEO_PREFIX.length));
  return Promise.resolve({
    allowedContentTypes: cover ? ["image/jpeg"] : [...VIDEO_TYPES],
    maximumSizeInBytes: cover ? COVER_MAX_BYTES : VIDEO_MAX_BYTES,
    // A post keeps pointing at its video, so two files called "clip.mp4" mustn't collide.
    addRandomSuffix: true,
  });
}

/**
 * POST /api/admin/social/video-upload - the token step of a Blob client upload. The path must sit
 * under social/video/: a video (MP4 or MOV, up to 250 MB) or a cover frame (a JPEG named
 * cover-*.jpg). Upload-completed callbacks aren't used, as they never reach localhost.
 * @param request - Incoming request from `upload()` in the browser.
 * @returns JSON for the Blob client.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  if (!canUploadImages()) {
    return errorResponse("Uploads are off until BLOB_READ_WRITE_TOKEN is set.", 503);
  }
  const body = (await request.json().catch(() => null)) as HandleUploadBody | null;
  if (!body) return errorResponse("Expected a JSON body.", 400);

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: tokenRules,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[social/video-upload] Error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Couldn't start the upload.",
      400,
    );
  }
}
