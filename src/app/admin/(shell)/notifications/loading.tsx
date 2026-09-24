import type React from "react";

/**
 * Loading skeleton for the notifications page - header plus the device setup card.
 * @returns The skeleton element.
 */
export default function NotificationsLoading(): React.ReactElement {
  return (
    <div aria-hidden>
      <div className="mb-2 h-8 w-48 animate-pulse rounded bg-admin-border" />
      <div className="mb-6 h-5 w-full max-w-2xl animate-pulse rounded bg-admin-border" />
      <div className="h-48 max-w-2xl animate-pulse rounded-xl bg-admin-border" />
    </div>
  );
}
