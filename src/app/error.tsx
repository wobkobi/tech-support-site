// src/app/error.tsx
/**
 * @description Themed error boundary. Matches site styling.
 */

"use client";

import { ErrorPageShell } from "@/shared/components/ErrorPageShell";
import type React from "react";
import { useState } from "react";
import { FaHouse } from "react-icons/fa6";

const MESSAGES = [
  "Something broke. Which is ironic, given that fixing broken things is literally my job.",
  "The website has done the digital equivalent of tripping over nothing.",
  "An error occurred. No, turning your screen off and on won't help. But it won't hurt either.",
  "Something went wrong - and unlike your printer, it's not out of paper.",
  "Well, this is embarrassing. The website is having a moment.",
  "The code gremlins struck again. I'll sort them out.",
  "This error is more unexpected than a Windows update at 8am.",
  "Something crashed. It happens to the best of us. Even me, occasionally.",
  "The website tried its best. Its best wasn't quite enough today.",
  "An error so unexpected, even the error message is confused.",
  "Something went sideways. Not sure how, but here we are.",
  "The website has encountered a problem and needs to restart. Sound familiar?",
];

/**
 * Error boundary UI for the App Router.
 * @param props - Component props.
 * @param props.error - Thrown error instance.
 * @param props.reset - Callback to re-render the segment.
 * @returns The error page element.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}): React.ReactElement {
  const [quip] = useState(() => MESSAGES[Math.floor(Math.random() * MESSAGES.length)]);
  // Client-render exceptions aren't redacted by Next, so their message/stack
  // are only shown in development; production logs them to the console instead.
  const showDetails = process.env.NODE_ENV !== "production";

  return (
    <ErrorPageShell
      title="The website has encountered an error"
      body={quip}
      error={error}
      onReset={reset}
      secondary={{
        href: "/",
        label: "Go home",
        icon: <FaHouse className="h-5 w-5" aria-hidden />,
      }}
      showMessage={showDetails}
      detailsSummary={showDetails ? "Technical details (for the curious)" : undefined}
      logPrefix="[error boundary]:"
    />
  );
}
