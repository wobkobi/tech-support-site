// src/features/social/lib/meta-token.server.ts
// Reads the Meta token's permissions and expiry from debug_token. With META_APP_ID and
// META_APP_SECRET set it asks as the app; without them the Page token inspects itself, which
// Meta allows for a token that still works.

import { graph, GraphError, metaConfig } from "@/features/social/lib/meta-graph";
import {
  tokenInfoOf,
  type DebugTokenData,
  type MetaTokenInfo,
} from "@/features/social/lib/permissions";

/**
 * The Meta token's details.
 * @returns Its details, or null when there's no token.
 */
export async function inspectToken(): Promise<MetaTokenInfo | null> {
  const { token, appToken } = metaConfig();
  if (!token) return null;
  try {
    const res = await graph<{ data?: DebugTokenData }>(
      "/debug_token",
      "GET",
      { input_token: token },
      appToken ?? token,
    );
    return tokenInfoOf(res.data ?? {});
  } catch (error) {
    // Inspecting itself, a dead token fails the call (190) instead of answering is_valid false.
    if (!appToken && error instanceof GraphError && error.code === 190) {
      return { ...tokenInfoOf({}), error: error.message };
    }
    throw error;
  }
}
