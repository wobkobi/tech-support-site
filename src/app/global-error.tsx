// src/app/global-error.tsx
/**
 * @file global-error.tsx
 * @description
 * Global error handling component. Displays a fallback UI when the app crashes.
 */

"use client";
/**
 * Global error boundary UI.
 * @returns A simple message indicating the app has crashed.
 */
export default function GlobalError(): React.ReactElement {
  return (
    <html>
      <body>App crashed</body>
    </html>
  );
}
