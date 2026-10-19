"use client";
// src/features/notifications/components/PushRegistrar.tsx
// Registers the operator push service worker for the admin shell. Nothing is sent until
// a device subscribes on /admin/notifications.

import { useEffect } from "react";

/**
 * Registers `/sw.js` once on mount, ignoring browsers without service workers.
 * @returns Null - this component renders no markup.
 */
export function PushRegistrar(): null {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err: unknown) => {
      console.error("[push] service worker registration failed", err);
    });
  }, []);

  return null;
}
