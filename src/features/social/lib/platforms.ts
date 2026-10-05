// src/features/social/lib/platforms.ts
// Registry of platform adapters, keyed like the post's targets. Server-only: the
// adapters call the Graph API with the Page token.

import type { PlatformAdapter } from "@/features/social/lib/adapter";
import { facebook } from "@/features/social/lib/facebook";
import { instagram } from "@/features/social/lib/instagram";
import type { SocialPlatformKey } from "@/features/social/lib/validate";

export const PLATFORMS: Record<SocialPlatformKey, PlatformAdapter> = { facebook, instagram };
