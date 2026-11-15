// src/app/services/software/loading.tsx

import { PageLoadingShell } from "@/shared/components/PageLoadingShell";
import type React from "react";

/**
 * Software page route-loading spinner.
 * @returns Loading element.
 */
export default function SoftwareLoading(): React.ReactElement {
  return <PageLoadingShell label="software page" />;
}
