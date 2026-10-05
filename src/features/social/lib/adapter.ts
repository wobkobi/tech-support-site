// src/features/social/lib/adapter.ts
// The shape every platform adapter shares, so the publisher and the connections
// check loop over platforms instead of branching on their names.

/** What an adapter needs to publish: final text, already filled in. */
export interface PublishInput {
  text: string;
  imageUrl: string | null;
  imageAlt: string | null;
  linkUrl: string | null;
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
 * Thrown when a platform accepted the post but hasn't finished processing it in
 * time. The target stays pending and the cron picks it up again later.
 */
export class StillProcessingError extends Error {
  /**
   * Creates the error.
   * @param message - What is still processing, for the target's error field.
   */
  constructor(message: string) {
    super(message);
    this.name = "StillProcessingError";
  }
}
