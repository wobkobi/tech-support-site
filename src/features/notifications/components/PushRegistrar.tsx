"use client";
// src/features/notifications/components/PushRegistrar.tsx
/**
 * @description Registers the operator push service worker for the admin shell.
 * Renders nothing. Registration is separate from subscription: the worker is
 * always installed, but no notification is sent until a device is subscribed
 * on /admin/notifications.
 */

import { useEffect } from "react";

/**
 * Registers `/sw.js` once on mount, ignoring browsers without service worker
 * support.
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
