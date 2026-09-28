// src/app/about/loading.tsx

import { PageLoadingShell } from "@/shared/components/PageLoadingShell";
import type React from "react";

/**
 * About page route-loading spinner.
 * @returns Loading element.
 */
export default function AboutLoading(): React.ReactElement {
  return <PageLoadingShell label="about page" />;
}
