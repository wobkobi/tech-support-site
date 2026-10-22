// src/features/social/lib/adapter.ts
// The shape every platform adapter shares, so the publisher and the connections
// check loop over platforms instead of branching on their names.

import type { SocialFormatKey } from "@/features/social/lib/media";
import type { GooglePostCta, GooglePostType } from "@/features/social/lib/validate";

/**
 * Google-only post settings; the other adapters ignore them. Dates are YYYY-MM-DD, times NZ
 * "HH:MM" (null for an all-day event).
 */
export interface GoogleFields {
  type: GooglePostType;
  cta: GooglePostCta | null;
  /** The button's own link; null to use the post's Link. */
  url: string | null;
  title: string | null;
  start: string | null;
  end: string | null;
  startTime: string | null;
  endTime: string | null;
  couponCode: string | null;
}

/** A picture as an adapter sends it. */
export interface PublishPicture {
  url: string;
  alt: string | null;
}

/** A video as an adapter sends it. */
export interface PublishVideo {
  url: string;
  coverUrl: string | null;
}

/** What an adapter needs to publish: final text, already filled in. */
export interface PublishInput {
  format: SocialFormatKey;
  text: string;
  /** Picture 1: the app's own when it has one. */
  imageUrl: string | null;
  imageAlt: string | null;
  /** Every picture in order, picture 1 included; more than one makes a carousel. */
  images: PublishPicture[];
  video: PublishVideo | null;
  linkUrl: string | null;
  google: GoogleFields;
  /** What an earlier run left processing, to check instead of uploading again. */
  containerId: string | null;
  containerCreatedAt: Date | null;
}

/** Where the published post lives. */
export interface PublishResult {
  externalId: string;
  permalink: string | null;
}

/** Whether a platform's credentials work, and which account they reach. */
export type ConnectionStatus = { ok: true; label: string } | { ok: false; error: string };

export interface PlatformAdapter {
  /** Env vars this platform still needs; empty when it's set up. */
  missingEnv(): string[];
  publish(input: PublishInput): Promise<PublishResult>;
  /** Deletes a published post by its externalId. Already deleted counts as done. */
  remove(externalId: string): Promise<void>;
  checkConnection(): Promise<ConnectionStatus>;
}

/**
 * Thrown when a platform accepted the post but hasn't finished processing it in time. The target
 * stays pending with the container saved, and the cron checks on it again later.
 */
export class StillProcessingError extends Error {
  /** What the platform is processing, for the next run to check. */
  readonly containerId: string | null;
  /**
   * Creates the error.
   * @param message - What is still processing, for the target's error field.
   * @param containerId - The platform's id for it, or null when there's nothing to check.
   */
  constructor(message: string, containerId: string | null = null) {
    super(message);
    this.name = "StillProcessingError";
    this.containerId = containerId;
  }
}
