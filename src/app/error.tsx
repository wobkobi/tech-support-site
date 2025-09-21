// src/app/error.tsx
/**
 * @file error.tsx
 * @description
 * Custom error page. Catches runtime errors and displays a message.
 */
"use client";

/**
 *
 * @param root0 root0
 * @param root0.error Error object
 * @returns A simple message indicating something went wrong.
 */
export default function Error({ error }: { error: Error }): React.ReactElement {
  return <p>Something went wrong: {error.message}</p>;
}
