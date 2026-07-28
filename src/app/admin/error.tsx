// src/app/admin/error.tsx
/**
 * @description Admin-segment error boundary. Operator-facing, so it keeps the
 * technical details block for debugging.
 */

"use client";

import { ErrorPageShell } from "@/shared/components/ErrorPageShell";
import type React from "react";
import { FaGauge } from "react-icons/fa6";

/**
 * Error boundary UI for the admin segment.
 * @param props - Component props.
 * @param props.error - Thrown error instance.
 * @param props.reset - Callback to re-render the segment.
 * @returns The error page element.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}): React.ReactElement {
  return (
    <ErrorPageShell
      title="An admin page hit an error"
      body={
        <>
          Retry the action below. If it keeps failing, check the technical details and the server
          logs.
        </>
      }
      error={error}
      onReset={reset}
      secondary={{
        href: "/admin",
        label: "Back to dashboard",
        icon: <FaGauge className="h-5 w-5" aria-hidden />,
      }}
      showMessage
      detailsSummary="Technical details"
    />
  );
}
