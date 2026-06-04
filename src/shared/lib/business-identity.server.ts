// src/shared/lib/business-identity.server.ts
/**
 * @file business-identity.server.ts
 * @description Server-only accessor for the live business identity (defaults +
 * settings override). The constants in `business-identity.ts` stay the defaults
 * (and remain client-safe); server consumers read `getIdentity()` so an operator
 * edit in the settings panel flows through to invoices, emails, SEO, and the
 * travel origin. Identity secrets (bank account, GST#) default from env, so this
 * is behaviour-preserving until the operator saves an override.
 */

import "server-only";
import { getSettings } from "@/shared/lib/settings/get-settings";
import type { IdentitySettings } from "@/shared/lib/settings/types";

/**
 * Resolves the live business identity.
 * @returns The current identity settings (defaults merged with any DB override).
 */
export async function getIdentity(): Promise<IdentitySettings> {
  return (await getSettings()).identity;
}
