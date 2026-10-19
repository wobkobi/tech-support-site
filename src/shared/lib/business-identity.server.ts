// src/shared/lib/business-identity.server.ts
// Server-only live business identity (defaults merged with settings). Constants in
// business-identity.ts stay the client-safe defaults.

import { getSettings } from "@/shared/lib/settings/get-settings";
import type { IdentitySettings } from "@/shared/lib/settings/types";
import "server-only";

/**
 * Resolves the live business identity.
 * @returns The current identity settings (defaults merged with any DB override).
 */
export async function getIdentity(): Promise<IdentitySettings> {
  return (await getSettings()).identity;
}
