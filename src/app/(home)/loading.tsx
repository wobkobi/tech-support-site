// src/app/(home)/loading.tsx

import { PageLoadingShell } from "@/shared/components/PageLoadingShell";
import type React from "react";

/**
 * Home page route-loading spinner.
 * @returns Loading element.
 */
export default function HomeLoading(): React.ReactElement {
  return <PageLoadingShell label="home page" />;
}
