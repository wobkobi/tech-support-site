// src/shared/components/PromoBanner.tsx
/**
 * @description Server wrapper - fetches the active promo, hands it to the client banner.
 */

import { getActivePromo } from "@/features/business/lib/promos";
import { PromoBannerClient } from "@/shared/components/PromoBannerClient";
import type React from "react";

/**
 * Renders the client banner for the active promo, or null when none.
 * @returns Banner or null.
 */
export async function PromoBanner(): Promise<React.ReactElement | null> {
  const promo = await getActivePromo();
  if (!promo) return null;
  return <PromoBannerClient promo={promo} />;
}
