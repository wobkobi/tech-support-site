// src/app/areas/loading.tsx

import { PageLoadingShell } from "@/shared/components/PageLoadingShell";
import type React from "react";

/**
 * Areas page route-loading spinner.
 * @returns Loading element.
 */
export default function AreasLoading(): React.ReactElement {
  return <PageLoadingShell label="areas page" />;
}
